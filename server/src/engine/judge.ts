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

/** Bajo este promedio, el veredicto binario es "fallo". Ajustable — no hay una única cifra "correcta" para un juez heurístico. */
const UMBRAL_APROBACION = 0.55;

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

function banda(valor: number): "alto" | "medio" | "bajo" {
  if (valor >= 0.7) return "alto";
  if (valor >= 0.4) return "medio";
  return "bajo";
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
  /** "paso" | "fallo", derivado de promedio vs. UMBRAL_APROBACION. */
  veredicto: "paso" | "fallo";
  /** Por qué el juez llegó a este veredicto — compuesto a partir de los mismos números, no inventado aparte. */
  razonamiento: string;
}

function explicar(groundedness: number, relevancia: number, completitud: number, confianza: number, sinContexto: boolean): string {
  const partes: string[] = [];

  if (sinContexto) {
    partes.push("No llegó contextoRecuperado del sistema del cliente, así que groundedness no tiene contra qué medirse y queda en el piso.");
  } else {
    const bg = banda(groundedness);
    partes.push(
      bg === "alto"
        ? `Groundedness alto (${Math.round(groundedness * 100)}%): la respuesta comparte gran parte de su vocabulario con el contexto recuperado.`
        : bg === "medio"
          ? `Groundedness medio (${Math.round(groundedness * 100)}%): la respuesta se apoya solo parcialmente en el contexto recuperado.`
          : `Groundedness bajo (${Math.round(groundedness * 100)}%): la respuesta comparte poco vocabulario con el contexto recuperado — posible respuesta no anclada.`
    );
  }

  const br = banda(relevancia);
  partes.push(
    br === "alto"
      ? `Relevancia alta (${Math.round(relevancia * 100)}%): responde directamente lo preguntado.`
      : br === "medio"
        ? `Relevancia media (${Math.round(relevancia * 100)}%): toca el tema pero no calza del todo con la pregunta.`
        : `Relevancia baja (${Math.round(relevancia * 100)}%): comparte poco vocabulario con la pregunta.`
  );

  const bc = banda(completitud);
  partes.push(
    bc === "alto"
      ? `Completitud alta (${Math.round(completitud * 100)}%): cubre lo que indicaba la referencia provisional.`
      : bc === "medio"
        ? `Completitud media (${Math.round(completitud * 100)}%): cubre parte de lo esperado según la referencia (provisional, señal secundaria).`
        : `Completitud baja (${Math.round(completitud * 100)}%): falta cobertura frente a la referencia provisional (señal secundaria, no concluyente por sí sola).`
  );

  if (confianza < 0.4) {
    partes.push("El juez tiene baja confianza en este veredicto: los tres criterios discrepan bastante entre sí.");
  }

  return partes.join(" ");
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

  const veredicto: "paso" | "fallo" = promedio >= UMBRAL_APROBACION ? "paso" : "fallo";
  const razonamiento = explicar(groundedness, relevancia, completitud, confianza, entrada.contextoRecuperado.length === 0);

  return { groundedness, relevancia, completitud, promedio, confianza, veredicto, razonamiento };
}
