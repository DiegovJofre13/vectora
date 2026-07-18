/**
 * Agente generador: para casos conversacionales/RAG, la conversación no
 * existe hasta que alguien la crea. Este agente "invierte" el flujo RAG —
 * parte del contenido del knowledge base del cliente, no de la pregunta — y
 * produce preguntas realistas con dificultad escalonada (simple, multi-hop,
 * razonamiento), cada una con una respuesta esperada PROVISIONAL derivada
 * del contenido (se valida con humano en el Módulo 3).
 *
 * Llama a un LLM real (mismo gateway que `probe.completar()`,
 * `providerGateway.ts::completarConGateway`) para escribir preguntas con el
 * lenguaje e idiosincrasia de un usuario real de verdad — no una plantilla
 * fija. El costo de esta llamada se cobra igual que cualquier otra: mismo
 * gateway, mismo margen del 30% (ver `orchestrator.ts::generarDataset()`,
 * que hace el pre-flight de créditos y registra el consumo real).
 *
 * Modelo fijo (`MODELO_GENERADOR`), no elegible por el usuario — es una
 * pieza de infraestructura de Vectora, no un modelo del panel que se está
 * evaluando. gpt-4o-mini: suficientemente bueno para escribir preguntas
 * naturales, barato para no inflar el costo de generar el dataset.
 */
import { z } from "zod";
import { completarConGateway } from "./providerGateway.js";

const MODELO_GENERADOR = "gpt-4o-mini";

export interface DocumentoKbInput {
  id?: string;
  titulo: string;
  contenido: string;
}

export interface DocumentoKbNormalizado {
  id: string;
  titulo: string;
  contenido: string;
}

export interface PreguntaGenerada {
  pregunta: string;
  dificultad: "simple" | "multi_hop" | "razonamiento";
  /** Los documentos reales de donde salió la pregunta (trazabilidad) — no solo sus ids. */
  documentosFuente: DocumentoKbNormalizado[];
  respuestaEsperadaProvisional: string;
}

export interface ResultadoGeneracion {
  preguntas: PreguntaGenerada[];
  costoBaseUsd: number;
  tokensEntrada: number;
  tokensSalida: number;
}

function normalizarDocs(docs: DocumentoKbInput[]): DocumentoKbNormalizado[] {
  return docs.map((d, i) => ({ id: d.id || `kb-input-${i + 1}`, titulo: d.titulo, contenido: d.contenido }));
}

const preguntaLlmSchema = z.object({
  pregunta: z.string().min(1),
  dificultad: z.enum(["simple", "multi_hop", "razonamiento"]),
  documentosFuenteIds: z.array(z.string()).min(1),
  respuestaEsperadaProvisional: z.string().min(1),
});
const respuestaLlmSchema = z.object({ preguntas: z.array(preguntaLlmSchema) });

function construirPrompt(docs: DocumentoKbNormalizado[], cantidad: number): string {
  const nSimple = Math.round(cantidad * 0.4);
  const nMultiHop = Math.round(cantidad * 0.35);
  const nRazonamiento = cantidad - nSimple - nMultiHop;

  const docsTexto = docs.map((d) => `[id: ${d.id}] "${d.titulo}"\n${d.contenido}`).join("\n\n");

  return `Sos un generador de datos de prueba para evaluar un chatbot de atención al cliente. Tu trabajo es escribir preguntas que HARÍA UN USUARIO REAL del producto — no un ingeniero de QA. Usá lenguaje natural e informal, con la idiosincrasia de alguien escribiendo en un chat de soporte real: puede ser impreciso, coloquial, sin jerga técnica ni referencias literales a los títulos de los documentos (un usuario real no dice "según el documento X").

Estos son los documentos de la base de conocimiento del cliente:

${docsTexto}

Generá EXACTAMENTE ${cantidad} preguntas en total — ni menos ni más, contalas antes de responder — con esta distribución:
- ${nSimple} preguntas "simple": sobre un solo documento, directas.
- ${nMultiHop} preguntas "multi_hop": que combinan información de DOS documentos distintos en una sola pregunta.
- ${nRazonamiento} preguntas "razonamiento": que piden extrapolar, comparar con un caso particular del usuario, o preguntar "qué pasa si...".

Para cada pregunta, escribí también una respuesta esperada provisional: una respuesta breve y correcta según los documentos, sintetizada como lo haría un agente de soporte — no copies el documento entero.

Respondé en JSON con esta forma exacta, sin texto adicional antes ni después:
{"preguntas": [{"pregunta": "...", "dificultad": "simple", "documentosFuenteIds": ["id-del-documento"], "respuestaEsperadaProvisional": "..."}]}`;
}

/**
 * Genera el dataset de preguntas con un LLM real. Async porque hace una
 * llamada de verdad al gateway — el caller (`orchestrator.ts::generarDataset`)
 * es responsable del pre-flight de créditos y de registrar el consumo real
 * con el costo que devuelve acá.
 *
 * `cantidadObjetivo` es un pedido, no una garantía: en pruebas reales el
 * modelo a veces devuelve menos preguntas de las pedidas (ej. 23 de 30),
 * pese a la instrucción explícita en el prompt. No se fuerza a completar el
 * número con un segundo llamado — `numCasos` en la corrida usa la cantidad
 * real devuelta (`preguntas.length`), así que esto no rompe nada aguas
 * abajo, solo produce una corrida con menos casos de los esperados.
 */
export async function generarPreguntas(docsInput: DocumentoKbInput[], cantidadObjetivo = 30): Promise<ResultadoGeneracion> {
  if (docsInput.length === 0) return { preguntas: [], costoBaseUsd: 0, tokensEntrada: 0, tokensSalida: 0 };

  const docs = normalizarDocs(docsInput);
  const docsPorId = new Map(docs.map((d) => [d.id, d]));

  const prompt = construirPrompt(docs, cantidadObjetivo);
  const resultado = await completarConGateway(MODELO_GENERADOR, prompt, "json");

  let parseado: unknown;
  try {
    parseado = JSON.parse(resultado.texto);
  } catch {
    throw new Error("El generador de preguntas devolvió un JSON inválido — probá de nuevo.");
  }

  const validado = respuestaLlmSchema.safeParse(parseado);
  if (!validado.success) {
    throw new Error(`El generador de preguntas devolvió una forma inesperada: ${validado.error.issues.map((i) => i.message).join("; ")}`);
  }

  const preguntas: PreguntaGenerada[] = validado.data.preguntas.map((p) => {
    const documentosFuente = p.documentosFuenteIds.map((id) => docsPorId.get(id)).filter((d): d is DocumentoKbNormalizado => Boolean(d));
    return {
      pregunta: p.pregunta,
      dificultad: p.dificultad,
      // Si el modelo alucinó un id que no existe, mejor un doc real de trazabilidad que ninguno.
      documentosFuente: documentosFuente.length > 0 ? documentosFuente : [docs[0]!],
      respuestaEsperadaProvisional: p.respuestaEsperadaProvisional,
    };
  });

  return { preguntas, costoBaseUsd: resultado.costoBaseUsd, tokensEntrada: resultado.tokensEntrada, tokensSalida: resultado.tokensSalida };
}
