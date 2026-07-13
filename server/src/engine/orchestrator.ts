import { db } from "../lib/db.js";
import { crearLimitador } from "../lib/pLimit.js";
import { generarPreguntas, type DocumentoKbInput } from "./generatorAgent.js";
import { juzgar } from "./judge.js";
import { scoreEstructuralConDetalle } from "./structuralScoring.js";
import { estimarCostoUsd } from "./mockModelEngine.js";
import { estrategiaScoringParaTipo, type TipoTarea } from "./taskTypes.js";

const CONCURRENCIA_MAXIMA = 4;
/** Timeout por llamada al probe del cliente. Sin esto, un sistema real lento o colgado
 * ocupa para siempre uno de los 4 cupos de concurrencia y la corrida nunca termina. */
const TIMEOUT_PROBE_MS = 60_000;

export interface DocumentoExistenteInsumo {
  input?: unknown;
  esperado: Record<string, unknown>;
  camposAmbiguos?: string[];
}

export interface InsumosCorrida {
  kbDocs?: DocumentoKbInput[];
  documentosExistentes?: DocumentoExistenteInsumo[];
}

/** Envoltura interna: para tareas estructurales, CasoPrueba.input guarda el documento junto a su ground truth. */
interface EnvolturaEstructural {
  documento: unknown;
  esperado: Record<string, unknown>;
  camposAmbiguos?: string[];
}

function esEnvolturaEstructural(v: unknown): v is EnvolturaEstructural {
  return typeof v === "object" && v !== null && "documento" in v && "esperado" in v;
}

interface CasoDeUsoParaCorrida {
  id: string;
  tipoTarea: string;
  probeUrl: string | null;
}

/**
 * Crea la corrida + sus casos de prueba (síncrono, sin llamadas al sistema
 * del cliente todavía) y dispara la ejecución real en segundo plano.
 * Retorna de inmediato con la corrida en estado "corriendo" para que la UI
 * empiece a hacer polling de progreso.
 */
export async function iniciarCorrida(
  casoDeUso: CasoDeUsoParaCorrida,
  modelos: string[],
  insumos: InsumosCorrida
): Promise<{ corridaId: string }> {
  if (!casoDeUso.probeUrl) {
    throw new Error("El caso de uso no tiene un probeUrl conectado.");
  }
  if (modelos.length < 2) {
    throw new Error("Se necesitan al menos 2 modelos para poder comparar.");
  }

  const requiereGenerador = estrategiaScoringParaTipo(casoDeUso.tipoTarea as TipoTarea) === "juez";

  const casosData = requiereGenerador
    ? generarPreguntas(insumos.kbDocs ?? [], 30).map((p) => ({
        input: JSON.stringify(p.pregunta),
        dificultad: p.dificultad,
        respuestaEsperadaProvisional: p.respuestaEsperadaProvisional,
        esSintetico: true,
        contextoFuente: JSON.stringify(p.documentosFuente),
      }))
    : (insumos.documentosExistentes ?? []).map((d) => ({
        input: JSON.stringify({ documento: d.input, esperado: d.esperado, camposAmbiguos: d.camposAmbiguos } satisfies EnvolturaEstructural),
        dificultad: null,
        respuestaEsperadaProvisional: null,
        esSintetico: false,
        contextoFuente: null,
      }));

  if (casosData.length === 0) {
    throw new Error(
      requiereGenerador
        ? "No se pudieron generar preguntas: agrega al menos un documento del knowledge base."
        : "Agrega al menos un documento existente con su respuesta esperada para poder evaluar."
    );
  }

  const corrida = await db.evaluacionCorrida.create({
    data: {
      casoDeUsoId: casoDeUso.id,
      modelosEvaluados: JSON.stringify(modelos),
      estado: "corriendo",
      numCasos: casosData.length,
      casosPrueba: { create: casosData },
    },
  });

  await db.casoDeUso.update({ where: { id: casoDeUso.id }, data: { estado: "conectado" } });

  // Fire-and-forget: la UI hace polling de progreso vía GET .../progreso.
  void ejecutarCorridaParaGobernanza(corrida.id, casoDeUso.probeUrl, modelos).catch(async (err) => {
    console.error(`[orchestrator] corrida ${corrida.id} falló:`, err);
    await db.evaluacionCorrida.update({ where: { id: corrida.id }, data: { estado: "error" } });
  });

  return { corridaId: corrida.id };
}

async function llamarProbe(
  probeUrl: string,
  body: { input: unknown; modelo: string; casoUsoId?: string; casoPruebaId?: string }
): Promise<{ ok: true; respuesta: unknown; contextoRecuperado?: unknown; latenciaMs: number } | { ok: false; error: string }> {
  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_PROBE_MS);
  try {
    const res = await fetch(`${probeUrl.replace(/\/$/, "")}/probe/ejecutar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controlador.signal,
    });
    const data = (await res.json()) as { ok: boolean; error?: string; respuesta?: unknown; contextoRecuperado?: unknown; latenciaMs?: number };
    if (!data.ok) return { ok: false, error: data.error ?? "El sistema del cliente devolvió un error." };
    return { ok: true, respuesta: data.respuesta, contextoRecuperado: data.contextoRecuperado, latenciaMs: data.latenciaMs ?? 0 };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `El sistema del cliente no respondió dentro de ${TIMEOUT_PROBE_MS / 1000}s (timeout).` };
    }
    return { ok: false, error: err instanceof Error ? err.message : "No se pudo contactar al sistema del cliente." };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function ejecutarCorridaParaGobernanza(corridaId: string, probeUrl: string, modelos: string[]): Promise<void> {
  const corrida = await db.evaluacionCorrida.findUniqueOrThrow({
    where: { id: corridaId },
    include: { casoDeUso: true, casosPrueba: true },
  });
  const requiereJuez = estrategiaScoringParaTipo(corrida.casoDeUso.tipoTarea as TipoTarea) === "juez";
  const limitar = crearLimitador(CONCURRENCIA_MAXIMA);

  const tareas: Promise<void>[] = [];
  for (const casoPrueba of corrida.casosPrueba) {
    for (const modelo of modelos) {
      tareas.push(
        limitar(async () => {
          const inputCrudo = JSON.parse(casoPrueba.input) as unknown;
          const envoltura = esEnvolturaEstructural(inputCrudo) ? inputCrudo : null;
          const inputParaProbe = envoltura ? envoltura.documento : inputCrudo;

          const resultado = await llamarProbe(probeUrl, {
            input: inputParaProbe,
            modelo,
            casoUsoId: corrida.casoDeUsoId,
            casoPruebaId: casoPrueba.id,
          });

          if (!resultado.ok) {
            await db.resultadoModelo.create({
              data: {
                casoPruebaId: casoPrueba.id,
                modelo,
                respuesta: JSON.stringify(`[error] ${resultado.error}`),
                latenciaMs: 0,
                costoEstimadoUsd: 0,
                scoreEstructural: requiereJuez ? null : 0,
                scorePromedio: requiereJuez ? 0 : null,
                confianzaJuez: requiereJuez ? 0.15 : null,
                veredictoJuez: requiereJuez ? "fallo" : null,
                razonamientoJuez: requiereJuez ? `El sistema del cliente devolvió un error, no se pudo juzgar: ${resultado.error}` : null,
                detalleEstructural: requiereJuez ? null : JSON.stringify({ error: resultado.error }),
              },
            });
            return;
          }

          const textoRespuesta = typeof resultado.respuesta === "string" ? resultado.respuesta : JSON.stringify(resultado.respuesta);
          const costoEstimadoUsd = estimarCostoUsd(modelo, inputParaProbe ? JSON.stringify(inputParaProbe) : "", textoRespuesta);

          if (requiereJuez) {
            const contexto = Array.isArray(resultado.contextoRecuperado)
              ? (resultado.contextoRecuperado as unknown[]).map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
              : resultado.contextoRecuperado
                ? [JSON.stringify(resultado.contextoRecuperado)]
                : [];

            const veredicto = juzgar({
              pregunta: typeof inputCrudo === "string" ? inputCrudo : JSON.stringify(inputCrudo),
              contextoRecuperado: contexto,
              respuesta: textoRespuesta,
              referenciaProvisional: casoPrueba.respuestaEsperadaProvisional ?? "",
            });

            await db.resultadoModelo.create({
              data: {
                casoPruebaId: casoPrueba.id,
                modelo,
                respuesta: JSON.stringify(resultado.respuesta),
                contextoRecuperado: resultado.contextoRecuperado ? JSON.stringify(resultado.contextoRecuperado) : null,
                latenciaMs: resultado.latenciaMs,
                costoEstimadoUsd,
                scoreGroundedness: veredicto.groundedness,
                scoreRelevancia: veredicto.relevancia,
                scoreCompletitud: veredicto.completitud,
                scorePromedio: veredicto.promedio,
                confianzaJuez: veredicto.confianza,
                veredictoJuez: veredicto.veredicto,
                razonamientoJuez: veredicto.razonamiento,
              },
            });
          } else {
            const detalle = envoltura
              ? scoreEstructuralConDetalle(resultado.respuesta, { camposEsperados: envoltura.esperado, camposAmbiguos: envoltura.camposAmbiguos })
              : { score: 0, campos: [], veredicto: "fallo" as const, razonamiento: "No se pudo interpretar el documento de entrada." };
            await db.resultadoModelo.create({
              data: {
                casoPruebaId: casoPrueba.id,
                modelo,
                respuesta: JSON.stringify(resultado.respuesta),
                latenciaMs: resultado.latenciaMs,
                costoEstimadoUsd,
                scoreEstructural: detalle.score,
                detalleEstructural: JSON.stringify(detalle),
              },
            });
          }
        })
      );
    }
  }

  await Promise.all(tareas);

  const resultados = await db.resultadoModelo.findMany({ where: { casoPrueba: { evaluacionCorridaId: corridaId } } });
  const costoRealUsd = Number(resultados.reduce((acc, r) => acc + r.costoEstimadoUsd, 0).toFixed(4));

  await db.evaluacionCorrida.update({
    where: { id: corridaId },
    data: { estado: "completado", completedAt: new Date(), costoRealUsd },
  });

  await db.movimientoCreditos.create({
    data: {
      organizacionId: (await db.casoDeUso.findUniqueOrThrow({ where: { id: corrida.casoDeUsoId } })).organizacionId,
      evaluacionCorridaId: corridaId,
      creditosConsumidos: 1,
      costoUsd: costoRealUsd,
      descripcion: `Corrida de evaluación (${corrida.casosPrueba.length} casos × ${modelos.length} modelos)`,
    },
  });

  await db.casoDeUso.update({ where: { id: corrida.casoDeUsoId }, data: { estado: "evaluado" } });
}

export interface ProgresoCorrida {
  estado: string;
  numCasos: number;
  numModelos: number;
  completados: number;
  porModelo: Record<string, number>;
}

export async function obtenerProgreso(corridaId: string): Promise<ProgresoCorrida> {
  const corrida = await db.evaluacionCorrida.findUniqueOrThrow({ where: { id: corridaId } });
  const modelos = JSON.parse(corrida.modelosEvaluados) as string[];
  const resultados = await db.resultadoModelo.findMany({
    where: { casoPrueba: { evaluacionCorridaId: corridaId } },
    select: { modelo: true },
  });

  const porModelo: Record<string, number> = {};
  for (const m of modelos) porModelo[m] = 0;
  for (const r of resultados) porModelo[r.modelo] = (porModelo[r.modelo] ?? 0) + 1;

  return {
    estado: corrida.estado,
    numCasos: corrida.numCasos,
    numModelos: modelos.length,
    completados: resultados.length,
    porModelo,
  };
}
