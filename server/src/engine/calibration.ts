import { db } from "../lib/db.js";

const UMBRAL_BAJA_CONFIANZA = 0.65;

export interface PendienteCalibracion {
  resultadoModeloId: string;
  casoDeUsoId: string;
  casoDeUsoNombre: string;
  dominio: string;
  modelo: string;
  question: string;
  context: string;
  systemAnswer: string;
  provisionalExpected: string;
  judgeVerdict: { groundedness: number | null; relevancia: number | null; completitud: number | null; promedio: number | null };
  confidence: number;
}

function textoLegible(json: string | null): string {
  if (!json) return "";
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === "string") return parsed;
    // Contexto recuperado de RAG: array de { titulo, contenido } — se muestra como texto, no como JSON crudo.
    if (Array.isArray(parsed) && parsed.every((d) => d && typeof d === "object" && "contenido" in d)) {
      return parsed.map((d: { titulo?: string; contenido: string }) => (d.titulo ? `${d.titulo}: ${d.contenido}` : d.contenido)).join("\n\n");
    }
    return JSON.stringify(parsed);
  } catch {
    return json;
  }
}

/** Casos de baja confianza (<0.65) que todavía no tienen una CorreccionJuicio asociada. */
export async function obtenerPendientesCalibracion(dominio?: string): Promise<PendienteCalibracion[]> {
  const resultados = await db.resultadoModelo.findMany({
    where: {
      confianzaJuez: { lt: UMBRAL_BAJA_CONFIANZA, not: null },
      correccionJuicio: null,
      casoPrueba: { evaluacionCorrida: { casoDeUso: dominio ? { dominio } : undefined } },
    },
    include: { casoPrueba: { include: { evaluacionCorrida: { include: { casoDeUso: true } } } } },
    orderBy: { confianzaJuez: "asc" },
    take: 100,
  });

  return resultados.map((r) => {
    const caso = r.casoPrueba.evaluacionCorrida.casoDeUso;
    return {
      resultadoModeloId: r.id,
      casoDeUsoId: caso.id,
      casoDeUsoNombre: caso.nombre,
      dominio: caso.dominio,
      modelo: r.modelo,
      question: textoLegible(r.casoPrueba.input),
      context: textoLegible(r.contextoRecuperado),
      systemAnswer: textoLegible(r.respuesta),
      provisionalExpected: r.casoPrueba.respuestaEsperadaProvisional ?? "",
      judgeVerdict: { groundedness: r.scoreGroundedness, relevancia: r.scoreRelevancia, completitud: r.scoreCompletitud, promedio: r.scorePromedio },
      confidence: r.confianzaJuez ?? 0,
    };
  });
}

export async function registrarCalibracion(params: {
  resultadoModeloId: string;
  humanVerdict: "correcta" | "corregida";
  correctedAnswer?: string;
}): Promise<void> {
  const resultado = await db.resultadoModelo.findUniqueOrThrow({
    where: { id: params.resultadoModeloId },
    include: { casoPrueba: { include: { evaluacionCorrida: { include: { casoDeUso: true } } } } },
  });
  const caso = resultado.casoPrueba.evaluacionCorrida.casoDeUso;

  await db.correccionJuicio.create({
    data: {
      casoDeUsoId: caso.id,
      resultadoModeloId: resultado.id,
      dominio: caso.dominio,
      question: textoLegible(resultado.casoPrueba.input),
      context: textoLegible(resultado.contextoRecuperado),
      systemAnswer: textoLegible(resultado.respuesta),
      provisionalExpected: resultado.casoPrueba.respuestaEsperadaProvisional ?? "",
      judgeVerdict: JSON.stringify({
        groundedness: resultado.scoreGroundedness,
        relevancia: resultado.scoreRelevancia,
        completitud: resultado.scoreCompletitud,
        promedio: resultado.scorePromedio,
      }),
      humanVerdict: params.humanVerdict,
      correctedAnswer: params.humanVerdict === "corregida" ? (params.correctedAnswer ?? null) : null,
      confidence: resultado.confianzaJuez ?? 0,
    },
  });
}

export interface ResumenCalibracionDominio {
  dominio: string;
  calibrados: number;
  pendientes: number;
  porcentajeAcuerdo: number;
}

export async function obtenerResumenCalibracion(): Promise<ResumenCalibracionDominio[]> {
  const correcciones = await db.correccionJuicio.groupBy({
    by: ["dominio"],
    _count: { _all: true },
  });

  const resumen: ResumenCalibracionDominio[] = [];
  for (const grupo of correcciones) {
    const total = grupo._count._all;
    const correctas = await db.correccionJuicio.count({ where: { dominio: grupo.dominio, humanVerdict: "correcta" } });
    const pendientes = await db.resultadoModelo.count({
      where: {
        confianzaJuez: { lt: UMBRAL_BAJA_CONFIANZA, not: null },
        correccionJuicio: null,
        casoPrueba: { evaluacionCorrida: { casoDeUso: { dominio: grupo.dominio } } },
      },
    });
    resumen.push({
      dominio: grupo.dominio,
      calibrados: total,
      pendientes,
      porcentajeAcuerdo: total > 0 ? Number(((correctas / total) * 100).toFixed(1)) : 0,
    });
  }
  return resumen.sort((a, b) => b.calibrados - a.calibrados);
}
