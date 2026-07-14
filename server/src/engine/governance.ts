import { db } from "../lib/db.js";
import { generarReporte } from "./report.js";
import { buscarModelo, CATALOGO_MODELOS } from "./modelCatalog.js";
import { ejecutarCorridaParaGobernanza } from "./orchestrator.js";
import { estimarCostoCorrida } from "./costEstimator.js";
import { aplicarMargen } from "./billing.js";
import { verificarSaldoSuficiente } from "./credits.js";
import { estrategiaScoringParaTipo, type TipoTarea } from "./taskTypes.js";

/** Pasados este umbral de días sin una evaluación completada, el caso se marca "evaluación vieja". */
const UMBRAL_DIAS_EVALUACION_VIEJA = 60;

export type EstadoGobernanza = "optimo" | "cambio_sugerido" | "evaluacion_vieja" | "sin_evaluar";

export interface FilaLedger {
  casoDeUsoId: string;
  nombre: string;
  tipoTarea: string;
  volumenMensual: number | null;
  modeloProduccion: string | null;
  costoMensualProduccion: number | null;
  ultimaEvaluacion: Date | null;
  estado: EstadoGobernanza;
  modeloRecomendado: string | null;
  ahorroPctVsProduccion: number | null;
  probeConectado: boolean;
}

async function calcularFilaLedger(caso: {
  id: string;
  nombre: string;
  tipoTarea: string;
  volumenMensual: number | null;
  modeloProduccion: string | null;
  costoMensualProduccion: number | null;
  probeUrl: string | null;
}): Promise<FilaLedger> {
  const ultimaCorrida = await db.evaluacionCorrida.findFirst({
    where: { casoDeUsoId: caso.id, estado: "completado" },
    orderBy: { completedAt: "desc" },
  });

  const base = {
    casoDeUsoId: caso.id,
    nombre: caso.nombre,
    tipoTarea: caso.tipoTarea,
    volumenMensual: caso.volumenMensual,
    modeloProduccion: caso.modeloProduccion,
    costoMensualProduccion: caso.costoMensualProduccion,
    probeConectado: caso.probeUrl !== null,
  };

  if (!ultimaCorrida || !ultimaCorrida.completedAt) {
    return { ...base, ultimaEvaluacion: null, estado: "sin_evaluar", modeloRecomendado: null, ahorroPctVsProduccion: null };
  }

  const diasDesdeEvaluacion = (Date.now() - ultimaCorrida.completedAt.getTime()) / (1000 * 60 * 60 * 24);
  const reporte = await generarReporte(ultimaCorrida.id);

  let estado: EstadoGobernanza;
  if (diasDesdeEvaluacion > UMBRAL_DIAS_EVALUACION_VIEJA) {
    estado = "evaluacion_vieja";
  } else if (reporte.veredicto && caso.modeloProduccion && reporte.veredicto.modeloRecomendado !== caso.modeloProduccion) {
    estado = "cambio_sugerido";
  } else {
    estado = "optimo";
  }

  return {
    ...base,
    ultimaEvaluacion: ultimaCorrida.completedAt,
    estado,
    modeloRecomendado: reporte.veredicto?.modeloRecomendado ?? null,
    ahorroPctVsProduccion: reporte.veredicto?.ahorroPctVsProduccion ?? null,
  };
}

export async function obtenerLedger(): Promise<FilaLedger[]> {
  const casos = await db.casoDeUso.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(casos.map(calcularFilaLedger));
}

export interface ResumenGobernanza {
  gastoMensualUsd: number;
  ahorroAcumuladoUsd: number;
  casosActivos: number;
  casosRequierenReevaluacion: number;
}

export async function obtenerResumenGobernanza(): Promise<ResumenGobernanza> {
  const ledger = await obtenerLedger();

  const gastoMensualUsd = ledger.reduce((acc, f) => acc + (f.costoMensualProduccion ?? 0), 0);
  const ahorroAcumuladoUsd = ledger.reduce((acc, f) => {
    if (f.ahorroPctVsProduccion && f.ahorroPctVsProduccion > 0 && f.costoMensualProduccion) {
      return acc + f.costoMensualProduccion * (f.ahorroPctVsProduccion / 100);
    }
    return acc;
  }, 0);
  const casosActivos = ledger.filter((f) => f.estado !== "sin_evaluar").length;
  const casosRequierenReevaluacion = ledger.filter((f) => f.estado === "cambio_sugerido" || f.estado === "evaluacion_vieja").length;

  return {
    gastoMensualUsd: Number(gastoMensualUsd.toFixed(2)),
    ahorroAcumuladoUsd: Number(ahorroAcumuladoUsd.toFixed(2)),
    casosActivos,
    casosRequierenReevaluacion,
  };
}

export async function obtenerHistorialEventos(casoDeUsoId?: string) {
  return db.eventoGobernanza.findMany({
    where: casoDeUsoId ? { casoDeUsoId } : undefined,
    include: { casoDeUso: { select: { nombre: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/**
 * Simula "salió un modelo nuevo": toma un modelo del catálogo que el caso todavía no
 * había evaluado, re-corre los casos de prueba guardados (vía el probe real del
 * cliente, con el panel anterior + el modelo nuevo) y alerta solo si la recomendación
 * cambia. No es una animación — vuelve a ejecutar el sistema real del cliente.
 */
export async function simularEventoNuevoModelo(casoDeUsoId: string): Promise<{ evento: Awaited<ReturnType<typeof crearEvento>> } | { error: string }> {
  const caso = await db.casoDeUso.findUnique({ where: { id: casoDeUsoId } });
  if (!caso) return { error: "Caso de uso no encontrado." };
  if (!caso.probeUrl) return { error: "Este caso no tiene un sistema conectado; no se puede re-correr." };

  const ultimaCorrida = await db.evaluacionCorrida.findFirst({
    where: { casoDeUsoId, estado: "completado" },
    orderBy: { completedAt: "desc" },
    include: { casosPrueba: true },
  });
  if (!ultimaCorrida) return { error: "Este caso todavía no tiene ninguna evaluación completada." };

  const panelAnterior = JSON.parse(ultimaCorrida.modelosEvaluados) as string[];
  const modeloNuevo = CATALOGO_MODELOS.find((m) => !panelAnterior.includes(m.id));
  if (!modeloNuevo) return { error: "Ya evaluaste el panel completo del catálogo en este caso; no hay ningún modelo nuevo que simular." };

  const nuevoPanelEstimado = [...panelAnterior, modeloNuevo.id];
  const estimacion = estimarCostoCorrida({
    modelos: nuevoPanelEstimado,
    numCasos: ultimaCorrida.numCasos,
    tipoEstimacion: estrategiaScoringParaTipo(caso.tipoTarea as TipoTarea) === "juez" ? "rag" : "estructural",
  });
  const { totalUsd: costoConMargen } = aplicarMargen(estimacion.costoTotalUsd);
  const saldoAlcanza = await verificarSaldoSuficiente(caso.organizacionId, costoConMargen);
  if (!saldoAlcanza) {
    return { error: `Créditos insuficientes: re-correr costaría aprox. US$${costoConMargen.toFixed(2)} (con margen incluido). Carga créditos antes de simular el evento.` };
  }

  const reporteAntes = await generarReporte(ultimaCorrida.id);
  const recomendadoAntes = reporteAntes.veredicto?.modeloRecomendado ?? null;

  // Reconstituye los insumos desde los casos de prueba guardados, para re-correr "vía sus ganchos"
  // (no hace falta volver a generar preguntas ni pedir documentos: ya están persistidos).
  const nuevoPanel = [...panelAnterior, modeloNuevo.id];
  const casosData = ultimaCorrida.casosPrueba.map((c) => ({
    input: c.input,
    dificultad: c.dificultad,
    respuestaEsperadaProvisional: c.respuestaEsperadaProvisional,
    esSintetico: c.esSintetico,
    contextoFuente: c.contextoFuente,
  }));

  const nuevaCorrida = await db.evaluacionCorrida.create({
    data: {
      casoDeUsoId,
      modelosEvaluados: JSON.stringify(nuevoPanel),
      estado: "corriendo",
      numCasos: casosData.length,
      casosPrueba: { create: casosData },
    },
  });

  // Reutiliza el mismo camino de ejecución del orquestador (rate limiting incluido), pero
  // esperando a que termine — a diferencia de iniciarCorrida(), que es fire-and-forget.
  await ejecutarCorridaParaGobernanza(nuevaCorrida.id, caso.probeUrl, nuevoPanel);

  const reporteDespues = await generarReporte(nuevaCorrida.id);
  const recomendadoDespues = reporteDespues.veredicto?.modeloRecomendado ?? null;
  const huboImpacto = recomendadoDespues !== recomendadoAntes;

  const descripcion = huboImpacto
    ? `Salió ${modeloNuevo.nombre}: cambia la recomendación de ${buscarModelo(recomendadoAntes ?? "")?.nombre ?? recomendadoAntes} a ${buscarModelo(recomendadoDespues ?? "")?.nombre ?? recomendadoDespues}.`
    : `Salió ${modeloNuevo.nombre}: se re-corrieron los casos guardados, ${buscarModelo(recomendadoAntes ?? "")?.nombre ?? recomendadoAntes} sigue siendo el óptimo.`;

  const evento = await crearEvento({
    casoDeUsoId,
    tipo: "nuevo_modelo",
    descripcion,
    huboImpacto,
    detalle: JSON.stringify({ modeloNuevo: modeloNuevo.id, recomendadoAntes, recomendadoDespues, corridaId: nuevaCorrida.id }),
  });

  return { evento };
}

function crearEvento(data: { casoDeUsoId: string; tipo: string; descripcion: string; huboImpacto: boolean; detalle: string }) {
  return db.eventoGobernanza.create({ data });
}
