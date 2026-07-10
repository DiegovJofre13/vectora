import { buscarModelo } from "./modelCatalog.js";

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
}

export function estimarCostoCorrida(params: {
  modelos: string[];
  numCasos: number;
  tipoEstimacion: "rag" | "estructural";
}): EstimacionCosto {
  const { entrada, salida } = CARACTERES_PROMEDIO_POR_TIPO[params.tipoEstimacion];
  const costoPorModelo = params.modelos.map((id) => {
    const info = buscarModelo(id);
    if (!info) return { modelo: id, costoUsd: 0 };
    const tokensEst = (entrada + salida) / 4;
    const costoUnaLlamada = (tokensEst / 1000) * info.precioPor1KUsd;
    return { modelo: id, costoUsd: Number((costoUnaLlamada * params.numCasos).toFixed(4)) };
  });

  const costoTotalUsd = Number(costoPorModelo.reduce((acc, m) => acc + m.costoUsd, 0).toFixed(4));

  return { costoTotalUsd, costoPorModelo, numCasos: params.numCasos, numModelos: params.modelos.length };
}
