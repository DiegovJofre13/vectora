import { db } from "../lib/db.js";
import { estrategiaScoringParaTipo, type TipoTarea } from "./taskTypes.js";

function parsearJson<T>(texto: string | null): T | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return null;
  }
}

export interface DocumentoFuente {
  id: string;
  titulo: string;
  contenido: string;
}

export interface ResultadoDetalle {
  resultadoId: string;
  modelo: string;
  respuesta: unknown;
  contextoRecuperado: unknown;
  latenciaMs: number;
  costoEstimadoUsd: number;
  scoreEstructural: number | null;
  scoreGroundedness: number | null;
  scoreRelevancia: number | null;
  scoreCompletitud: number | null;
  scorePromedio: number | null;
  confianzaJuez: number | null;
  veredictoJuez: string | null;
  razonamientoJuez: string | null;
  detalleEstructural: unknown;
}

export interface CasoConDetalle {
  casoPruebaId: string;
  input: unknown;
  dificultad: string | null;
  esSintetico: boolean;
  documentosFuente: DocumentoFuente[] | null;
  respuestaEsperadaProvisional: string | null;
  resultados: ResultadoDetalle[];
}

export interface CasosConDetalleRespuesta {
  requiereJuez: boolean;
  numModelos: number;
  casos: CasoConDetalle[];
}

/**
 * El set de pruebas completo con el detalle por modelo — accesible aunque la
 * corrida siga en curso: los CasoPrueba se crean síncronamente al iniciar la
 * corrida (antes de llamar al probe del cliente ni una vez), así que esta
 * consulta siempre devuelve algo, con `resultados` incompleto mientras corre.
 */
export async function obtenerCasosConDetalle(corridaId: string): Promise<CasosConDetalleRespuesta> {
  const corrida = await db.evaluacionCorrida.findUniqueOrThrow({
    where: { id: corridaId },
    include: { casoDeUso: true, casosPrueba: { include: { resultados: true } } },
  });

  const requiereJuez = estrategiaScoringParaTipo(corrida.casoDeUso.tipoTarea as TipoTarea) === "juez";
  const modelos = JSON.parse(corrida.modelosEvaluados) as string[];

  const casos: CasoConDetalle[] = corrida.casosPrueba.map((cp) => ({
    casoPruebaId: cp.id,
    input: parsearJson(cp.input) ?? cp.input,
    dificultad: cp.dificultad,
    esSintetico: cp.esSintetico,
    documentosFuente: parsearJson<DocumentoFuente[]>(cp.contextoFuente),
    respuestaEsperadaProvisional: cp.respuestaEsperadaProvisional,
    resultados: cp.resultados.map((r) => ({
      resultadoId: r.id,
      modelo: r.modelo,
      respuesta: parsearJson(r.respuesta) ?? r.respuesta,
      contextoRecuperado: parsearJson(r.contextoRecuperado),
      latenciaMs: r.latenciaMs,
      costoEstimadoUsd: r.costoEstimadoUsd,
      scoreEstructural: r.scoreEstructural,
      scoreGroundedness: r.scoreGroundedness,
      scoreRelevancia: r.scoreRelevancia,
      scoreCompletitud: r.scoreCompletitud,
      scorePromedio: r.scorePromedio,
      confianzaJuez: r.confianzaJuez,
      veredictoJuez: r.veredictoJuez,
      razonamientoJuez: r.razonamientoJuez,
      detalleEstructural: parsearJson(r.detalleEstructural),
    })),
  }));

  return { requiereJuez, numModelos: modelos.length, casos };
}
