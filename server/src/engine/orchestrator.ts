import { db } from "../lib/db.js";
import { crearLimitador } from "../lib/pLimit.js";
import { generarPreguntas, type DocumentoKbInput } from "./generatorAgent.js";
import { juzgar } from "./judge.js";
import { scoreEstructuralConDetalle } from "./structuralScoring.js";
import { estimarCostoUsd } from "./mockModelEngine.js";
import { estimarCostoCorrida, estimarCostoGeneracionDataset } from "./costEstimator.js";
import { aplicarMargen } from "./billing.js";
import { registrarConsumo, verificarSaldoSuficiente } from "./credits.js";
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
  organizacionId: string;
  tipoTarea: string;
  probeUrl: string | null;
}

/**
 * Genera el dataset (preguntas sintéticas vía LLM, o documentos existentes)
 * y crea la corrida + sus `CasoPrueba`. Queda en estado "pendiente" (el
 * default del schema) para que el usuario pueda revisar y editar las
 * preguntas y la respuesta esperada provisional antes de gastar la corrida
 * contra el panel de modelos — ver `confirmarYCorrer()`.
 *
 * El generador de preguntas (`generatorAgent.ts`) llama a un LLM real —
 * mismo gateway y mismo margen del 30% que cualquier otra llamada a modelo
 * en Vectora. Por eso esta función SÍ hace su propio pre-flight de créditos
 * (para el costo de generar, antes de llamar) y su propio registro de
 * consumo real (después, con el costo exacto que devolvió el gateway) —
 * separado del pre-flight de `confirmarYCorrer()`, que es para la corrida
 * de evaluación en sí. Los dos movimientos quedan ligados a la misma
 * `evaluacionCorridaId`, así el costo total de una corrida es la suma de
 * ambos (ver `credits.ts::registrarConsumo` y el recálculo de `costoRealUsd`
 * al final de `ejecutarCorridaParaGobernanza`).
 */
export async function generarDataset(
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

  let casosData: {
    input: string;
    dificultad: string | null;
    respuestaEsperadaProvisional: string | null;
    esSintetico: boolean;
    contextoFuente: string | null;
  }[];
  let costoGeneracion: { costoBaseUsd: number; tokensEntrada: number; tokensSalida: number } | null = null;

  if (requiereGenerador) {
    const kbDocs = insumos.kbDocs ?? [];
    const estimacionGeneracion = estimarCostoGeneracionDataset(kbDocs, 30);
    const { totalUsd: costoGeneracionConMargen } = aplicarMargen(estimacionGeneracion);
    const saldoAlcanzaGeneracion = await verificarSaldoSuficiente(casoDeUso.organizacionId, costoGeneracionConMargen);
    if (!saldoAlcanzaGeneracion) {
      throw new Error(
        `Créditos insuficientes para generar el dataset: costaría aprox. US$${costoGeneracionConMargen.toFixed(2)} (con margen incluido). Carga créditos antes de continuar.`
      );
    }

    const generado = await generarPreguntas(kbDocs, 30);
    casosData = generado.preguntas.map((p) => ({
      input: JSON.stringify(p.pregunta),
      dificultad: p.dificultad,
      respuestaEsperadaProvisional: p.respuestaEsperadaProvisional,
      esSintetico: true,
      contextoFuente: JSON.stringify(p.documentosFuente),
    }));
    costoGeneracion = { costoBaseUsd: generado.costoBaseUsd, tokensEntrada: generado.tokensEntrada, tokensSalida: generado.tokensSalida };
  } else {
    casosData = (insumos.documentosExistentes ?? []).map((d) => ({
      input: JSON.stringify({ documento: d.input, esperado: d.esperado, camposAmbiguos: d.camposAmbiguos } satisfies EnvolturaEstructural),
      dificultad: null,
      respuestaEsperadaProvisional: null,
      esSintetico: false,
      contextoFuente: null,
    }));
  }

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
      // Default "pendiente" del schema: dataset generado, esperando revisión humana.
      numCasos: casosData.length,
      casosPrueba: { create: casosData },
    },
  });

  if (costoGeneracion) {
    const { margenUsd } = aplicarMargen(costoGeneracion.costoBaseUsd);
    await registrarConsumo({
      organizacionId: casoDeUso.organizacionId,
      evaluacionCorridaId: corrida.id,
      costoBaseUsd: costoGeneracion.costoBaseUsd,
      margenUsd,
      descripcion: `Generación del dataset (gpt-4o-mini, 30 preguntas, ${costoGeneracion.tokensEntrada}+${costoGeneracion.tokensSalida} tokens)`,
    });
  }

  return { corridaId: corrida.id };
}

/**
 * Segunda fase: el usuario ya revisó (y opcionalmente editó) el dataset
 * generado por `generarDataset()`. Acá sí se hace el pre-flight de créditos
 * (estimación conservadora + margen, el gate preciso vive en routes/gateway.ts)
 * y recién acá se dispara la ejecución real contra el sistema del cliente.
 */
export async function confirmarYCorrer(corridaId: string): Promise<void> {
  const corrida = await db.evaluacionCorrida.findUniqueOrThrow({
    where: { id: corridaId },
    include: { casoDeUso: true },
  });

  if (corrida.estado !== "pendiente") {
    throw new Error(`Esta corrida ya está en estado "${corrida.estado}" — no se puede confirmar dos veces.`);
  }
  if (!corrida.casoDeUso.probeUrl) {
    throw new Error("El caso de uso no tiene un probeUrl conectado.");
  }

  const modelos = JSON.parse(corrida.modelosEvaluados) as string[];
  const requiereGenerador = estrategiaScoringParaTipo(corrida.casoDeUso.tipoTarea as TipoTarea) === "juez";

  const estimacion = estimarCostoCorrida({
    modelos,
    numCasos: corrida.numCasos,
    tipoEstimacion: requiereGenerador ? "rag" : "estructural",
  });
  const { totalUsd: costoConMargen } = aplicarMargen(estimacion.costoTotalUsd);
  const saldoAlcanza = await verificarSaldoSuficiente(corrida.casoDeUso.organizacionId, costoConMargen);
  if (!saldoAlcanza) {
    throw new Error(
      `Créditos insuficientes: esta corrida costaría aprox. US$${costoConMargen.toFixed(2)} (con margen incluido). Carga créditos antes de correr.`
    );
  }

  await db.evaluacionCorrida.update({ where: { id: corridaId }, data: { estado: "corriendo" } });
  await db.casoDeUso.update({ where: { id: corrida.casoDeUso.id }, data: { estado: "conectado" } });

  const probeUrl = corrida.casoDeUso.probeUrl;

  // Fire-and-forget: la UI hace polling de progreso vía GET .../progreso.
  void ejecutarCorridaParaGobernanza(corridaId, probeUrl, modelos).catch(async (err) => {
    console.error(`[orchestrator] corrida ${corridaId} falló:`, err);
    await db.evaluacionCorrida.update({ where: { id: corridaId }, data: { estado: "error" } });
  });
}

/**
 * Edita la pregunta generada y/o la respuesta esperada provisional de un caso
 * de prueba, mientras la corrida sigue "pendiente" (antes de correr). Solo
 * aplica a casos sintéticos (RAG/conversacional, `esSintetico: true`) — para
 * extracción/clasificación el `input` es el documento real del cliente
 * envuelto junto a su ground truth, no una pregunta generada, y no es lo que
 * este flujo de revisión edita.
 */
export async function editarCasoPrueba(
  corridaId: string,
  casoPruebaId: string,
  cambios: { pregunta?: string; respuestaEsperadaProvisional?: string }
): Promise<void> {
  const corrida = await db.evaluacionCorrida.findUniqueOrThrow({ where: { id: corridaId } });
  if (corrida.estado !== "pendiente") {
    throw new Error(`No se puede editar: la corrida ya está en estado "${corrida.estado}".`);
  }

  const caso = await db.casoPrueba.findUniqueOrThrow({ where: { id: casoPruebaId } });
  if (caso.evaluacionCorridaId !== corridaId) {
    throw new Error("Ese caso de prueba no pertenece a esta corrida.");
  }
  if (!caso.esSintetico) {
    throw new Error("Este caso no es una pregunta generada — no se puede editar desde acá.");
  }

  const data: { input?: string; respuestaEsperadaProvisional?: string } = {};
  if (cambios.pregunta !== undefined) data.input = JSON.stringify(cambios.pregunta);
  if (cambios.respuestaEsperadaProvisional !== undefined) data.respuestaEsperadaProvisional = cambios.respuestaEsperadaProvisional;

  await db.casoPrueba.update({ where: { id: casoPruebaId }, data });
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

  // costoRealUsd = el total REAL cobrado por esta corrida — generación del dataset
  // (orchestrator.ts::generarDataset) + cada llamada de evaluación que pasó por el gateway
  // (routes/gateway.ts, ligada acá vía evaluacionCorridaId) — leído directo del ledger real
  // (MovimientoCreditos), no una heurística. Para corridas BYO-key (que no le cuestan nada a
  // Vectora) esto da 0 correctamente, ya que esas llamadas nunca pasan por el gateway.
  const movimientos = await db.movimientoCreditos.aggregate({
    where: { evaluacionCorridaId: corridaId, tipo: "consumo" },
    _sum: { montoUsd: true },
  });
  const costoRealUsd = Number((movimientos._sum.montoUsd ?? 0).toFixed(4));

  await db.evaluacionCorrida.update({
    where: { id: corridaId },
    data: { estado: "completado", completedAt: new Date(), costoRealUsd },
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
