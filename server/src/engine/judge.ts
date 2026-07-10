/**
 * Juez para casos conversacionales/RAG. Evalúa groundedness (¿la respuesta se
 * apoya en el contexto recuperado?), relevancia (¿responde lo preguntado?) y
 * completitud (¿cubre lo esperado?), y emite una confianza sobre su propio
 * veredicto.
 *
 * Es "de familia distinta a los modelos evaluados" en el sentido de que no
 * usa el mismo mecanismo que el sistema del cliente: en vez de repetir el
 * mock de completado, calcula solapamiento léxico real entre los textos
 * (pregunta, contexto, respuesta, referencia) — una señal determinista y
 * explicable, y suficiente para el MVP. Pondera más los criterios objetivos
 * (groundedness, relevancia — se calculan contra el contexto y la pregunta
 * reales) que la completitud (se calcula contra la referencia, que es
 * provisional). CONNECT-REAL-MODELS.md documenta cómo reemplazar esto por un
 * juez LLM real de otra familia de modelos.
 */

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");
}

function palabras(texto: string): Set<string> {
  return new Set(normalizar(texto).split(/\s+/).filter((p) => p.length > 3));
}

/** Solapamiento relativo al conjunto más chico (recall-like), 0 si alguno está vacío. */
function solapamiento(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let interseccion = 0;
  for (const palabra of a) if (b.has(palabra)) interseccion++;
  return interseccion / Math.min(a.size, b.size);
}

export interface EntradaJuez {
  pregunta: string;
  contextoRecuperado: string[];
  respuesta: string;
  referenciaProvisional: string;
}

export interface VeredictoJuez {
  groundedness: number;
  relevancia: number;
  completitud: number;
  promedio: number;
  confianza: number;
}

export function juzgar(entrada: EntradaJuez): VeredictoJuez {
  const respWords = palabras(entrada.respuesta);
  const ctxWords = palabras(entrada.contextoRecuperado.join(" "));
  const pregWords = palabras(entrada.pregunta);
  const refWords = palabras(entrada.referenciaProvisional);

  const groundedness = Number(solapamiento(respWords, ctxWords).toFixed(3));
  const relevancia = Number(solapamiento(respWords, pregWords).toFixed(3));
  const completitud = Number(solapamiento(refWords, respWords).toFixed(3));

  // Criterios objetivos (contexto/pregunta reales) pesan más que la completitud (contra referencia provisional).
  const promedio = Number((groundedness * 0.45 + relevancia * 0.3 + completitud * 0.25).toFixed(3));

  const scores = [groundedness, relevancia, completitud];
  const variabilidad = Math.max(...scores) - Math.min(...scores);
  const respuestaCorta = entrada.respuesta.trim().length < 20;
  const confianzaCruda = 0.92 - variabilidad * 0.55 - (respuestaCorta ? 0.25 : 0);
  const confianza = Number(Math.max(0.12, Math.min(0.98, confianzaCruda)).toFixed(3));

  return { groundedness, relevancia, completitud, promedio, confianza };
}
