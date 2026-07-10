import { buscarModelo } from "./modelCatalog.js";

/**
 * Motor Mock: reemplaza la llamada cara a un modelo real. Lo único mockeado
 * en todo Vectora es esto — el SDK @vectora/probe y sus ganchos (register,
 * wrap) operan de verdad sobre este motor, exactamente como operarían sobre
 * Bedrock/OpenAI en producción (ver CONNECT-REAL-MODELS.md).
 *
 * Simula, por modelo del catálogo: latencia realista (con jitter) y una
 * probabilidad de "acierto" (calidadBase) que determina si la respuesta
 * sintetizada está bien anclada al contexto o degradada — así el juez y el
 * scoring estructural tienen señal real que detectar, no un mock plano.
 */

export interface ParametrosCompletarMock {
  modelo: string;
  prompt: string;
  contextoRecuperado?: string[];
  /** Si viene, el motor devuelve `json` en vez de `texto`, simulando extracción/clasificación estructurada. */
  camposEsperados?: Record<string, string>;
}

export interface ResultadoCompletarMock {
  texto?: string;
  json?: Record<string, unknown>;
  /** true si el motor decidió sintetizar una respuesta "de calidad" para este modelo en esta llamada. */
  acierto: boolean;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function conJitter(baseMs: number): number {
  const factor = 0.8 + Math.random() * 0.4; // +/-20%
  return Math.round(baseMs * factor);
}

function sintetizarTexto(params: ParametrosCompletarMock, acierto: boolean): string {
  const snippet = params.contextoRecuperado?.[0]?.slice(0, 160);

  if (acierto && snippet) {
    return `Según la información disponible, ${snippet.replace(/\s+/g, " ").trim()}. Esto responde directamente a lo consultado.`;
  }
  if (acierto) {
    return `Respuesta basada en el análisis de la consulta: ${params.prompt.slice(0, 140)}`;
  }
  // Degradación simulada: respuesta genérica, poco anclada al contexto (para que el juez detecte baja groundedness).
  return "No tengo información suficiente en el contexto para responder con precisión, pero en general este tipo de casos se resuelve revisando la política vigente.";
}

function sintetizarJson(camposEsperados: Record<string, string>, acierto: boolean): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  const claves = Object.keys(camposEsperados);
  claves.forEach((clave, i) => {
    // Degradación simulada: si no hay acierto, omite el último campo (simula extracción incompleta).
    if (!acierto && i === claves.length - 1) return;
    salida[clave] = camposEsperados[clave];
  });
  return salida;
}

export async function completarMock(params: ParametrosCompletarMock): Promise<ResultadoCompletarMock> {
  const modeloInfo = buscarModelo(params.modelo);
  const latenciaBase = modeloInfo?.latenciaBaseMs ?? 1200;
  const calidadBase = modeloInfo?.calidadBase ?? 0.75;

  await esperar(conJitter(latenciaBase));

  const acierto = Math.random() < calidadBase;

  if (params.camposEsperados) {
    return { json: sintetizarJson(params.camposEsperados, acierto), acierto };
  }
  return { texto: sintetizarTexto(params, acierto), acierto };
}

/** Estimación de costo por heurística de caracteres (~4 chars/token). Ver DECISIONS.md. */
export function estimarCostoUsd(modelo: string, textoEntrada: string, textoSalida: string): number {
  const info = buscarModelo(modelo);
  if (!info) return 0;
  const tokensEst = (textoEntrada.length + textoSalida.length) / 4;
  return Number(((tokensEst / 1000) * info.precioPor1KUsd).toFixed(6));
}
