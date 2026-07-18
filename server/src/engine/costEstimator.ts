import { buscarModelo } from "./modelCatalog.js";
import { precioGateway } from "./providerGateway.js";

/** Modelo fijo que usa el generador de preguntas (`generatorAgent.ts`) — ver ahí el porqué. */
const MODELO_GENERADOR = "gpt-4o-mini";

/**
 * Estimación de costo ANTES de correr (Módulo 1, paso "correr"). Usa un
 * largo de prompt/respuesta promedio plausible por tipo de tarea — no puede
 * conocer el costo real hasta ejecutar, pero da una cota razonable para que
 * el usuario confirme antes de gastar créditos.
 */
const CARACTERES_PROMEDIO_POR_TIPO: Record<"rag" | "estructural", { entrada: number; salida: number }> = {
  rag: { entrada: 900, salida: 280 },
  estructural: { entrada: 400, salida: 120 },
};

export interface EstimacionCosto {
  costoTotalUsd: number;
  costoPorModelo: { modelo: string; costoUsd: number }[];
  numCasos: number;
  numModelos: number;
  /** Costo estimado de generar el dataset con el LLM generador, si aplica (RAG/conversacional). Ya está sumado en costoTotalUsd. */
  costoGeneracionUsd?: number;
}

export function estimarCostoCorrida(params: {
  modelos: string[];
  numCasos: number;
  tipoEstimacion: "rag" | "estructural";
  /** Si viene, se suma al total el costo estimado de generar el dataset con LLM (ver `estimarCostoGeneracionDataset`). */
  kbDocsParaGeneracion?: { titulo: string; contenido: string }[];
}): EstimacionCosto {
  const { entrada, salida } = CARACTERES_PROMEDIO_POR_TIPO[params.tipoEstimacion];
  const costoPorModelo = params.modelos.map((id) => {
    const info = buscarModelo(id);
    if (!info) return { modelo: id, costoUsd: 0 };
    const tokensEst = (entrada + salida) / 4;
    const costoUnaLlamada = (tokensEst / 1000) * info.precioPor1KUsd;
    return { modelo: id, costoUsd: Number((costoUnaLlamada * params.numCasos).toFixed(4)) };
  });

  const costoEvaluacionUsd = costoPorModelo.reduce((acc, m) => acc + m.costoUsd, 0);
  const costoGeneracionUsd = params.kbDocsParaGeneracion ? estimarCostoGeneracionDataset(params.kbDocsParaGeneracion, params.numCasos) : undefined;
  const costoTotalUsd = Number((costoEvaluacionUsd + (costoGeneracionUsd ?? 0)).toFixed(4));

  return { costoTotalUsd, costoPorModelo, numCasos: params.numCasos, numModelos: params.modelos.length, costoGeneracionUsd };
}

/**
 * Estimación del costo de generar el dataset con el LLM generador (`generatorAgent.ts`),
 * ANTES de llamarlo — el input real (el knowledge base completo) sí se conoce en este punto,
 * así que la estimación de entrada es exacta; la de salida es una aproximación por pregunta
 * (texto corto + estructura JSON), ajustable si en la práctica se aleja mucho de lo real.
 */
export function estimarCostoGeneracionDataset(kbDocs: { titulo: string; contenido: string }[], cantidadPreguntas: number): number {
  const precios = precioGateway(MODELO_GENERADOR);
  if (!precios || kbDocs.length === 0) return 0;

  const charsKb = kbDocs.reduce((acc, d) => acc + d.titulo.length + d.contenido.length, 0);
  const tokensEntrada = charsKb / 4 + 350; // + overhead de las instrucciones del prompt
  const tokensSalida = cantidadPreguntas * 130; // pregunta + respuesta provisional + estructura JSON, aprox

  const costo = (tokensEntrada / 1000) * precios.entrada1K + (tokensSalida / 1000) * precios.salida1K;
  return Number(costo.toFixed(4));
}
