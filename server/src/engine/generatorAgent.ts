/**
 * Agente generador: para casos conversacionales/RAG, la conversación no
 * existe hasta que alguien la crea. Este agente "invierte" el flujo RAG —
 * parte del contenido del knowledge base del cliente, no de la pregunta — y
 * produce preguntas realistas con dificultad escalonada (simple, multi-hop,
 * razonamiento), cada una con una respuesta esperada PROVISIONAL derivada
 * del contenido (se valida con humano en el Módulo 3).
 *
 * Nota de honestidad: como en todo Vectora, lo único mockeado es la llamada
 * cara a un modelo real. Generar preguntas realmente novedosas a partir de
 * texto arbitrario requeriría esa llamada (un LLM leyendo el KB) — acá se
 * aproxima con plantillas deterministas sobre el contenido entregado, para
 * no depender de una llamada de generación que no existe en el motor Mock.
 * CONNECT-REAL-MODELS.md documenta cómo reemplazar esto por una llamada real.
 *
 * Las plantillas incorporan una frase real del contenido (no solo el
 * título): si solo preguntaran por el título, el juez (que mide solapamiento
 * léxico) no tendría vocabulario compartido real con la respuesta para medir
 * relevancia/completitud.
 */

export interface DocumentoKbInput {
  id?: string;
  titulo: string;
  contenido: string;
}

export interface PreguntaGenerada {
  pregunta: string;
  dificultad: "simple" | "multi_hop" | "razonamiento";
  contextoFuenteIds: string[];
  respuestaEsperadaProvisional: string;
}

const PLANTILLAS_SIMPLE = [
  (t: string, frase: string) => `Tengo una duda sobre "${t}": ¿es cierto que ${frase}?`,
  (t: string, frase: string) => `Según la política de "${t}", ¿${frase}?`,
  (t: string, frase: string) => `¿Puedes confirmarme si ${frase}, según "${t}"?`,
];

const PLANTILLAS_MULTI_HOP = [
  (a: string, fraseA: string, b: string, fraseB: string) =>
    `Sé que ${fraseA} (según "${a}"). ¿Eso cambia algo respecto a que ${fraseB} (según "${b}")?`,
  (a: string, fraseA: string, b: string, fraseB: string) =>
    `Si ${fraseA} según "${a}", y además ${fraseB} según "${b}", ¿qué debería considerar?`,
];

const PLANTILLAS_RAZONAMIENTO = [
  (t: string, frase: string) =>
    `Mi caso es distinto a lo normal: sé que ${frase} (según "${t}"), pero no estoy seguro si aplica igual. ¿Qué corresponde hacer?`,
  (t: string, frase: string) => `¿Qué pasaría si no se cumple que ${frase}, según lo indicado en "${t}"?`,
];

function extraerFrase(contenido: string, nPalabras = 10): string {
  const frase = contenido
    .split(/\s+/)
    .slice(0, nPalabras)
    .join(" ")
    .replace(/[.,;:]+$/, "");
  return frase.charAt(0).toLowerCase() + frase.slice(1);
}

interface DocumentoKbNormalizado {
  id: string;
  titulo: string;
  contenido: string;
}

function normalizarDocs(docs: DocumentoKbInput[]): DocumentoKbNormalizado[] {
  return docs.map((d, i) => ({ id: d.id || `kb-input-${i + 1}`, titulo: d.titulo, contenido: d.contenido }));
}

export function generarPreguntas(docsInput: DocumentoKbInput[], cantidadObjetivo = 30): PreguntaGenerada[] {
  if (docsInput.length === 0) return [];
  const docs = normalizarDocs(docsInput);

  const nSimple = Math.round(cantidadObjetivo * 0.4);
  const nMultiHop = Math.round(cantidadObjetivo * 0.35);
  const nRazonamiento = cantidadObjetivo - nSimple - nMultiHop;

  const preguntas: PreguntaGenerada[] = [];

  for (let i = 0; i < nSimple; i++) {
    const doc = docs[i % docs.length];
    const plantilla = PLANTILLAS_SIMPLE[i % PLANTILLAS_SIMPLE.length];
    if (!doc || !plantilla) continue;
    preguntas.push({
      pregunta: plantilla(doc.titulo, extraerFrase(doc.contenido)),
      dificultad: "simple",
      contextoFuenteIds: [doc.id],
      respuestaEsperadaProvisional: doc.contenido,
    });
  }

  for (let i = 0; i < nMultiHop; i++) {
    const docA = docs[i % docs.length];
    const docB = docs[(i + 1) % docs.length];
    const plantilla = PLANTILLAS_MULTI_HOP[i % PLANTILLAS_MULTI_HOP.length];
    if (!docA || !docB || !plantilla) continue;
    preguntas.push({
      pregunta: plantilla(docA.titulo, extraerFrase(docA.contenido), docB.titulo, extraerFrase(docB.contenido)),
      dificultad: "multi_hop",
      contextoFuenteIds: docA.id === docB.id ? [docA.id] : [docA.id, docB.id],
      respuestaEsperadaProvisional: docA.id === docB.id ? docA.contenido : `${docA.contenido} Además: ${docB.contenido}`,
    });
  }

  for (let i = 0; i < nRazonamiento; i++) {
    const doc = docs[(i + 2) % docs.length];
    const plantilla = PLANTILLAS_RAZONAMIENTO[i % PLANTILLAS_RAZONAMIENTO.length];
    if (!doc || !plantilla) continue;
    preguntas.push({
      pregunta: plantilla(doc.titulo, extraerFrase(doc.contenido)),
      dificultad: "razonamiento",
      contextoFuenteIds: [doc.id],
      respuestaEsperadaProvisional: doc.contenido,
    });
  }

  return preguntas;
}
