import { db } from "../lib/db.js";
import { buscarModelo } from "./modelCatalog.js";
import { estrategiaScoringParaTipo, type TipoTarea } from "./taskTypes.js";

export interface FilaReporte {
  modelo: string;
  nombre: string;
  proveedor: string;
  tier: string;
  openWeights: boolean;
  precision: number;
  latenciaP95Ms: number;
  costoPromedioUsd: number;
  costoPor1KUsd: number;
  tag: "optimo" | "valor" | "maxima_precision" | "open" | null;
  ajusteCasoUso: number;
}

export interface ReporteEvaluacion {
  corridaId: string;
  estado: string;
  veredicto: {
    modeloRecomendado: string;
    nombreRecomendado: string;
    justificacion: string;
    precision: number;
    costoPor1KUsd: number;
    latenciaP95Ms: number;
    ahorroPctVsProduccion: number | null;
  } | null;
  filas: FilaReporte[];
  pareto: { modelo: string; costoPor1KUsd: number; precision: number; esFrontera: boolean; esRecomendado: boolean }[];
  esRag: boolean;
  calloutReferenciaProvisional: boolean;
}

function calcularP95(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenado.length - 1, Math.ceil(0.95 * ordenado.length) - 1);
  return ordenado[idx] ?? 0;
}

function calcularFronteraPareto(puntos: { modelo: string; costo: number; precision: number }[]): Set<string> {
  const frontera = new Set<string>();
  for (const p of puntos) {
    const dominado = puntos.some(
      (q) => q.modelo !== p.modelo && q.costo <= p.costo && q.precision >= p.precision && (q.costo < p.costo || q.precision > p.precision)
    );
    if (!dominado) frontera.add(p.modelo);
  }
  return frontera;
}

export async function generarReporte(corridaId: string): Promise<ReporteEvaluacion> {
  const corrida = await db.evaluacionCorrida.findUniqueOrThrow({
    where: { id: corridaId },
    include: { casoDeUso: true, casosPrueba: { include: { resultados: true } } },
  });

  const modelosEvaluados = JSON.parse(corrida.modelosEvaluados) as string[];
  const requiereJuez = estrategiaScoringParaTipo(corrida.casoDeUso.tipoTarea as TipoTarea) === "juez";
  const esSintetico = corrida.casosPrueba.some((c) => c.esSintetico);

  const todosResultados = corrida.casosPrueba.flatMap((c) => c.resultados);

  const filasBase = modelosEvaluados.map((modeloId) => {
    const info = buscarModelo(modeloId);
    const resultadosModelo = todosResultados.filter((r) => r.modelo === modeloId);
    const precisionValores = resultadosModelo
      .map((r) => (requiereJuez ? r.scorePromedio : r.scoreEstructural))
      .filter((v): v is number => v !== null && v !== undefined);
    const precision = precisionValores.length > 0 ? Number((precisionValores.reduce((a, b) => a + b, 0) / precisionValores.length).toFixed(3)) : 0;
    const latenciaP95Ms = calcularP95(resultadosModelo.map((r) => r.latenciaMs));
    const costoPromedioUsd =
      resultadosModelo.length > 0 ? Number((resultadosModelo.reduce((a, r) => a + r.costoEstimadoUsd, 0) / resultadosModelo.length).toFixed(6)) : 0;

    return {
      modelo: modeloId,
      nombre: info?.nombre ?? modeloId,
      proveedor: info?.proveedor ?? "—",
      tier: info?.tier ?? "—",
      openWeights: info?.openWeights ?? false,
      precision,
      latenciaP95Ms,
      costoPromedioUsd,
      costoPor1KUsd: info?.precioPor1KUsd ?? 0,
    };
  });

  const precisionMax = Math.max(0.001, ...filasBase.map((f) => f.precision));
  const costoMax = Math.max(0.000001, ...filasBase.map((f) => f.costoPromedioUsd));

  const filasConAjuste = filasBase.map((f) => {
    const retencionCalidad = f.precision / precisionMax;
    const costoRelativo = f.costoPromedioUsd / costoMax;
    const ajusteCasoUso = Number((retencionCalidad * 0.7 + (1 - costoRelativo) * 0.3).toFixed(4));
    return { ...f, ajusteCasoUso };
  });

  const ordenadas = [...filasConAjuste].sort((a, b) => b.ajusteCasoUso - a.ajusteCasoUso);
  const recomendado = ordenadas[0];

  const puntosPareto = filasConAjuste.map((f) => ({ modelo: f.modelo, costo: f.costoPor1KUsd, precision: f.precision }));
  const fronteraSet = calcularFronteraPareto(puntosPareto);
  const masPrecisoId = [...filasConAjuste].sort((a, b) => b.precision - a.precision)[0]?.modelo;

  const filas: FilaReporte[] = ordenadas.map((f) => {
    let tag: FilaReporte["tag"] = null;
    if (recomendado && f.modelo === recomendado.modelo) tag = "optimo";
    else if (f.modelo === masPrecisoId) tag = "maxima_precision";
    else if (f.openWeights) tag = "open";
    else if (fronteraSet.has(f.modelo)) tag = "valor";
    return { ...f, tag };
  });

  const pareto = filasConAjuste.map((f) => ({
    modelo: f.modelo,
    costoPor1KUsd: f.costoPor1KUsd,
    precision: f.precision,
    esFrontera: fronteraSet.has(f.modelo),
    esRecomendado: recomendado ? f.modelo === recomendado.modelo : false,
  }));

  let veredicto: ReporteEvaluacion["veredicto"] = null;
  if (recomendado && corrida.estado === "completado") {
    const modeloReferencia = filasConAjuste.find((f) => f.modelo === masPrecisoId);
    const retencionCalidad = modeloReferencia ? Math.round((recomendado.precision / Math.max(0.001, modeloReferencia.precision)) * 100) : 100;
    const ahorroPctVsMax =
      modeloReferencia && modeloReferencia.costoPromedioUsd > 0
        ? Math.round((1 - recomendado.costoPromedioUsd / modeloReferencia.costoPromedioUsd) * 100)
        : 0;

    let ahorroPctVsProduccion: number | null = null;
    if (corrida.casoDeUso.modeloProduccion) {
      const filaProduccion = filasConAjuste.find((f) => f.modelo === corrida.casoDeUso.modeloProduccion);
      if (filaProduccion && filaProduccion.costoPromedioUsd > 0) {
        ahorroPctVsProduccion = Math.round((1 - recomendado.costoPromedioUsd / filaProduccion.costoPromedioUsd) * 100);
      }
    }

    const justificacion =
      recomendado.modelo === masPrecisoId
        ? `${recomendado.nombre} es el de mayor precisión del panel (${Math.round(recomendado.precision * 100)}%) y su costo/latencia siguen siendo competitivos para este caso.`
        : `${recomendado.nombre} da ${retencionCalidad}% de la calidad de ${modeloReferencia?.nombre ?? "el modelo de referencia"} a ${ahorroPctVsMax}% menos costo por caso.`;

    veredicto = {
      modeloRecomendado: recomendado.modelo,
      nombreRecomendado: recomendado.nombre,
      justificacion,
      precision: recomendado.precision,
      costoPor1KUsd: recomendado.costoPor1KUsd,
      latenciaP95Ms: recomendado.latenciaP95Ms,
      ahorroPctVsProduccion,
    };
  }

  return {
    corridaId,
    estado: corrida.estado,
    veredicto,
    filas,
    pareto,
    esRag: requiereJuez,
    calloutReferenciaProvisional: esSintetico,
  };
}
