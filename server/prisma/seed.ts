/**
 * Seed de "Fintech Andina": cliente ficticio para que el MVP se vea vivo al
 * abrir. Puebla un caso RAG con historial completo (30 preguntas × 5
 * modelos) y ~200 correcciones de juez calibradas, un caso de clasificación
 * (fraude) con scoring estructural, y 3 casos livianos más solo para que el
 * ledger de gobernanza (Módulo 4) tenga variedad de estados.
 *
 * Idempotente: borra todo lo de "Fintech Andina" antes de re-sembrar, así
 * `npm run db:seed` se puede correr las veces que sea necesario.
 */
import { PrismaClient } from "@prisma/client";
import { CATALOGO_MODELOS, type ModeloCatalogo } from "../src/engine/modelCatalog.js";
import { requiereGeneradorParaTipo, type TipoTarea } from "../src/engine/taskTypes.js";
import {
  PREGUNTAS_BOT_SOPORTE,
  crearRng,
  docsDeContexto,
  sintetizarRespuestaSeed,
  sintetizarScoresJuez,
  sintetizarConfianzaJuez,
  latenciaConJitter,
  costoEstimado,
  type PreguntaSeed,
} from "./seedData.js";

const db = new PrismaClient();
const rng = crearRng(42);

const HOY = new Date();
function diasAtras(n: number): Date {
  return new Date(HOY.getTime() - n * 24 * 60 * 60 * 1000);
}

async function limpiarFintechAndina() {
  const org = await db.organizacion.findFirst({ where: { nombre: "Fintech Andina" } });
  if (!org) return;
  const casos = await db.casoDeUso.findMany({ where: { organizacionId: org.id }, select: { id: true } });
  const casoIds = casos.map((c) => c.id);
  const corridas = await db.evaluacionCorrida.findMany({ where: { casoDeUsoId: { in: casoIds } }, select: { id: true } });
  const corridaIds = corridas.map((c) => c.id);
  const pruebas = await db.casoPrueba.findMany({ where: { evaluacionCorridaId: { in: corridaIds } }, select: { id: true } });
  const pruebaIds = pruebas.map((p) => p.id);

  await db.resultadoModelo.deleteMany({ where: { casoPruebaId: { in: pruebaIds } } });
  await db.casoPrueba.deleteMany({ where: { id: { in: pruebaIds } } });
  await db.evaluacionCorrida.deleteMany({ where: { id: { in: corridaIds } } });
  await db.correccionJuicio.deleteMany({ where: { casoDeUsoId: { in: casoIds } } });
  await db.eventoGobernanza.deleteMany({ where: { casoDeUsoId: { in: casoIds } } });
  await db.movimientoCreditos.deleteMany({ where: { organizacionId: org.id } });
  await db.casoDeUso.deleteMany({ where: { organizacionId: org.id } });
  await db.organizacion.delete({ where: { id: org.id } });
}

interface CasoRagOpts {
  casoDeUsoId: string;
  preguntas: PreguntaSeed[];
  modelos: ModeloCatalogo[];
  indicesBajaConfianza: number[];
  completadaHaceDias: number;
}

async function sembrarEvaluacionRag(opts: CasoRagOpts) {
  const corrida = await db.evaluacionCorrida.create({
    data: {
      casoDeUsoId: opts.casoDeUsoId,
      modelosEvaluados: JSON.stringify(opts.modelos.map((m) => m.id)),
      estado: "completado",
      numCasos: opts.preguntas.length,
      costoEstimadoUsd: 0, // se recalcula abajo con el costo real sintetizado
      createdAt: diasAtras(opts.completadaHaceDias + 1),
      completedAt: diasAtras(opts.completadaHaceDias),
    },
  });

  let costoTotal = 0;

  for (let i = 0; i < opts.preguntas.length; i++) {
    const preg = opts.preguntas[i];
    if (!preg) continue;
    const docs = docsDeContexto(preg);
    const contextoTexto = docs.map((d) => d.contenido).join(" ");

    const casoPrueba = await db.casoPrueba.create({
      data: {
        evaluacionCorridaId: corrida.id,
        input: JSON.stringify(preg.pregunta),
        dificultad: preg.dificultad,
        respuestaEsperadaProvisional: preg.respuestaEsperadaProvisional,
        esSintetico: true,
        contextoFuente: docs.map((d) => d.id).join(","),
      },
    });

    for (let m = 0; m < opts.modelos.length; m++) {
      const modelo = opts.modelos[m];
      if (!modelo) continue;
      const { texto, acierto } = sintetizarRespuestaSeed(rng, modelo.tier, preg);
      const scores = sintetizarScoresJuez(rng, modelo.tier, acierto);
      const forzarBaja = opts.indicesBajaConfianza.includes(i) && m === i % opts.modelos.length;
      const confianza = sintetizarConfianzaJuez(rng, forzarBaja);
      const latencia = latenciaConJitter(rng, modelo.latenciaBaseMs);
      const costo = costoEstimado(modelo, contextoTexto + preg.pregunta, texto);
      costoTotal += costo;

      await db.resultadoModelo.create({
        data: {
          casoPruebaId: casoPrueba.id,
          modelo: modelo.id,
          respuesta: JSON.stringify(texto),
          contextoRecuperado: JSON.stringify(docs.map((d) => ({ id: d.id, titulo: d.titulo, contenido: d.contenido }))),
          latenciaMs: latencia,
          costoEstimadoUsd: costo,
          scoreGroundedness: scores.groundedness,
          scoreRelevancia: scores.relevancia,
          scoreCompletitud: scores.completitud,
          scorePromedio: scores.promedio,
          confianzaJuez: confianza,
          createdAt: diasAtras(opts.completadaHaceDias),
        },
      });
    }
  }

  await db.evaluacionCorrida.update({ where: { id: corrida.id }, data: { costoEstimadoUsd: Number(costoTotal.toFixed(4)), costoRealUsd: Number(costoTotal.toFixed(4)) } });
  return corrida;
}

interface CasoEstructuralOpts {
  casoDeUsoId: string;
  numCasos: number;
  modelos: ModeloCatalogo[];
  completadaHaceDias: number;
  dominioLabel: string;
}

async function sembrarEvaluacionEstructural(opts: CasoEstructuralOpts) {
  const corrida = await db.evaluacionCorrida.create({
    data: {
      casoDeUsoId: opts.casoDeUsoId,
      modelosEvaluados: JSON.stringify(opts.modelos.map((m) => m.id)),
      estado: "completado",
      numCasos: opts.numCasos,
      costoEstimadoUsd: 0,
      createdAt: diasAtras(opts.completadaHaceDias + 1),
      completedAt: diasAtras(opts.completadaHaceDias),
    },
  });

  let costoTotal = 0;
  const probScoreEstructural = { frontera: 0.97, intermedio: 0.9, barato: 0.78, open: 0.81 };

  for (let i = 0; i < opts.numCasos; i++) {
    const inputSintetico = { id: `doc-${opts.dominioLabel}-${i + 1}`, resumen: `Documento ${i + 1} de ${opts.dominioLabel}` };
    const casoPrueba = await db.casoPrueba.create({
      data: {
        evaluacionCorridaId: corrida.id,
        input: JSON.stringify(inputSintetico),
        esSintetico: false, // documento existente del cliente, no generado
      },
    });

    for (const modelo of opts.modelos) {
      const base = probScoreEstructural[modelo.tier];
      const scoreEstructural = Number(Math.max(0, Math.min(1, base + (rng() - 0.5) * 0.15)).toFixed(3));
      const respuestaTexto = JSON.stringify({ campo1: "valor-extraido", campo2: "valor-extraido-2" });
      const latencia = latenciaConJitter(rng, modelo.latenciaBaseMs);
      const costo = costoEstimado(modelo, JSON.stringify(inputSintetico), respuestaTexto);
      costoTotal += costo;

      await db.resultadoModelo.create({
        data: {
          casoPruebaId: casoPrueba.id,
          modelo: modelo.id,
          respuesta: respuestaTexto,
          latenciaMs: latencia,
          costoEstimadoUsd: costo,
          scoreEstructural,
          createdAt: diasAtras(opts.completadaHaceDias),
        },
      });
    }
  }

  await db.evaluacionCorrida.update({ where: { id: corrida.id }, data: { costoEstimadoUsd: Number(costoTotal.toFixed(4)), costoRealUsd: Number(costoTotal.toFixed(4)) } });
  return corrida;
}

async function sembrarCorreccionesJuicio(casoDeUsoId: string, dominio: string, cantidad: number) {
  const filas = [];
  for (let i = 0; i < cantidad; i++) {
    const preg = PREGUNTAS_BOT_SOPORTE[i % PREGUNTAS_BOT_SOPORTE.length];
    if (!preg) continue;
    const docs = docsDeContexto(preg);
    const esCorregida = rng() < 0.15;
    const confidence = Number((0.3 + rng() * 0.35).toFixed(3)); // población histórica de baja confianza ya calibrada
    filas.push(
      db.correccionJuicio.create({
        data: {
          casoDeUsoId,
          dominio,
          question: preg.pregunta,
          context: docs.map((d) => d.contenido).join(" "),
          systemAnswer: esCorregida
            ? "No cuento con información suficiente en el contexto para responder con precisión."
            : preg.respuestaEsperadaProvisional,
          provisionalExpected: preg.respuestaEsperadaProvisional,
          judgeVerdict: JSON.stringify({ veredicto: esCorregida ? "insuficiente" : "correcta", groundedness: esCorregida ? 0.4 : 0.9 }),
          humanVerdict: esCorregida ? "corregida" : "correcta",
          correctedAnswer: esCorregida ? preg.respuestaEsperadaProvisional : null,
          confidence,
          timestamp: diasAtras(Math.floor(rng() * 90) + 1),
        },
      })
    );
  }
  await Promise.all(filas);
}

async function main() {
  await limpiarFintechAndina();

  const org = await db.organizacion.create({ data: { nombre: "Fintech Andina" } });

  const modeloFrontera = CATALOGO_MODELOS.find((m) => m.tier === "frontera")!;
  const modelosIntermedios = CATALOGO_MODELOS.filter((m) => m.tier === "intermedio");
  const modeloBarato = CATALOGO_MODELOS.find((m) => m.tier === "barato")!;
  const modeloOpen = CATALOGO_MODELOS.find((m) => m.tier === "open")!;
  const panelCompleto = [modeloFrontera, ...modelosIntermedios, modeloBarato, modeloOpen];

  // --- Caso 1: Bot de soporte (RAG) — historial completo + calibración ---
  const botSoporte = await db.casoDeUso.create({
    data: {
      organizacionId: org.id,
      nombre: "Bot de soporte",
      descripcion: "Asistente conversacional que responde consultas de soporte usando el knowledge base de políticas de Fintech Andina.",
      tipoTarea: "rag" satisfies TipoTarea,
      requiereGenerador: requiereGeneradorParaTipo("rag"),
      dominio: "soporte_fintech",
      probeUrl: "http://localhost:4501",
      estado: "evaluado",
      modeloProduccion: "gpt-4o",
      costoMensualProduccion: 842.5,
      volumenMensual: 38000,
    },
  });

  await sembrarEvaluacionRag({
    casoDeUsoId: botSoporte.id,
    preguntas: PREGUNTAS_BOT_SOPORTE,
    modelos: panelCompleto,
    indicesBajaConfianza: [2, 7, 13, 19, 25, 29],
    completadaHaceDias: 6,
  });

  await sembrarCorreccionesJuicio(botSoporte.id, "soporte_fintech", 200);

  await db.eventoGobernanza.createMany({
    data: [
      {
        casoDeUsoId: botSoporte.id,
        tipo: "reevaluacion_programada",
        descripcion: "Re-evaluación trimestral programada: gpt-4o sigue siendo el óptimo para este caso.",
        huboImpacto: false,
        detalle: JSON.stringify({ modeloAnterior: "gpt-4o", modeloSugerido: "gpt-4o" }),
        createdAt: diasAtras(45),
      },
      {
        casoDeUsoId: botSoporte.id,
        tipo: "nuevo_modelo",
        descripcion: "Salió Gemini 1.5 Flash: se re-corrieron los casos guardados, no supera a gpt-4o en groundedness para este dominio.",
        huboImpacto: false,
        detalle: JSON.stringify({ modeloNuevo: "gemini-1-5-flash" }),
        createdAt: diasAtras(20),
      },
      {
        casoDeUsoId: botSoporte.id,
        tipo: "nuevo_modelo",
        descripcion: "Salió Claude 3.5 Sonnet: ofrece 96% de la calidad de gpt-4o a un quinto del costo. Cambio sugerido.",
        huboImpacto: true,
        detalle: JSON.stringify({ modeloNuevo: "claude-3-5-sonnet", ahorroEstimadoPct: 78 }),
        createdAt: diasAtras(6),
      },
    ],
  });

  // --- Caso 2: Detección de fraude (clasificación, scoring estructural) ---
  const fraude = await db.casoDeUso.create({
    data: {
      organizacionId: org.id,
      nombre: "Detección de fraude",
      descripcion: "Clasifica transacciones existentes como fraudulentas o legítimas a partir de su patrón de gasto.",
      tipoTarea: "clasificacion" satisfies TipoTarea,
      requiereGenerador: requiereGeneradorParaTipo("clasificacion"),
      dominio: "riesgo_fraude",
      probeUrl: "http://localhost:4502",
      estado: "evaluado",
      modeloProduccion: "claude-3-5-sonnet",
      costoMensualProduccion: 310.2,
      volumenMensual: 52000,
    },
  });

  await sembrarEvaluacionEstructural({
    casoDeUsoId: fraude.id,
    numCasos: 10,
    modelos: panelCompleto,
    completadaHaceDias: 12,
    dominioLabel: "fraude",
  });

  await db.eventoGobernanza.create({
    data: {
      casoDeUsoId: fraude.id,
      tipo: "reevaluacion_programada",
      descripcion: "Re-evaluación mensual: claude-3-5-sonnet sigue siendo óptimo en costo/precisión.",
      huboImpacto: false,
      createdAt: diasAtras(12),
    },
  });

  // --- 3 casos livianos más, solo para variedad de estados en el ledger (Módulo 4) ---
  const facturas = await db.casoDeUso.create({
    data: {
      organizacionId: org.id,
      nombre: "Extracción de facturas",
      descripcion: "Extrae RUT, monto, fecha y folio de facturas recibidas por correo.",
      tipoTarea: "extraccion" satisfies TipoTarea,
      requiereGenerador: requiereGeneradorParaTipo("extraccion"),
      dominio: "finanzas_facturacion",
      estado: "evaluado",
      modeloProduccion: "gpt-4o-mini",
      costoMensualProduccion: 64.8,
      volumenMensual: 9000,
    },
  });
  await sembrarEvaluacionEstructural({ casoDeUsoId: facturas.id, numCasos: 5, modelos: panelCompleto, completadaHaceDias: 3, dominioLabel: "facturas" });

  const tickets = await db.casoDeUso.create({
    data: {
      organizacionId: org.id,
      nombre: "Clasificación de tickets",
      descripcion: "Clasifica tickets de soporte entrantes por categoría y urgencia.",
      tipoTarea: "clasificacion" satisfies TipoTarea,
      requiereGenerador: requiereGeneradorParaTipo("clasificacion"),
      dominio: "operaciones_tickets",
      estado: "evaluado",
      modeloProduccion: "gpt-4o-mini",
      costoMensualProduccion: 128.4,
      volumenMensual: 21000,
    },
  });
  await sembrarEvaluacionEstructural({ casoDeUsoId: tickets.id, numCasos: 5, modelos: panelCompleto, completadaHaceDias: 55, dominioLabel: "tickets" });

  const resumenLegal = await db.casoDeUso.create({
    data: {
      organizacionId: org.id,
      nombre: "Resumen legal",
      descripcion: "Genera resúmenes ejecutivos de contratos y términos y condiciones para el equipo legal.",
      tipoTarea: "generacion" satisfies TipoTarea,
      requiereGenerador: requiereGeneradorParaTipo("generacion"),
      dominio: "legal",
      estado: "evaluado",
      modeloProduccion: "gpt-4o",
      costoMensualProduccion: 205.0,
      volumenMensual: 1200,
    },
  });
  await sembrarEvaluacionEstructural({ casoDeUsoId: resumenLegal.id, numCasos: 5, modelos: panelCompleto, completadaHaceDias: 130, dominioLabel: "legal" });

  // --- Ledger de créditos: una fila por corrida sembrada ---
  const corridas = await db.evaluacionCorrida.findMany({ where: { casoDeUso: { organizacionId: org.id } } });
  for (const corrida of corridas) {
    await db.movimientoCreditos.create({
      data: {
        organizacionId: org.id,
        evaluacionCorridaId: corrida.id,
        creditosConsumidos: 1,
        costoUsd: corrida.costoRealUsd ?? 0,
        descripcion: `Corrida de evaluación (${corrida.numCasos} casos × ${(JSON.parse(corrida.modelosEvaluados) as string[]).length} modelos)`,
        createdAt: corrida.completedAt ?? corrida.createdAt,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seed completo: organización "${org.nombre}" con ${5} casos de uso.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
