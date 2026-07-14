/**
 * Cliente demo: un bot RAG mínimo pero real (patrón A del SDK), pensado como
 * plantilla para que un cliente real vea exactamente qué reemplazar. Usa
 * @vectora/probe de verdad — no hay ningún atajo especial para este ejemplo.
 *
 * Muestra las dos formas de llamar al modelo, elegidas en tiempo de arranque
 * según qué credencial encuentre (ver docs/COMO-FUNCIONA-LA-CONEXION.md):
 *   - VECTORA_API_KEY configurada -> usa el gateway de Vectora (probe.completar):
 *     Vectora llama al proveedor y te cobra créditos, vos no necesitás tu
 *     propia key del proveedor.
 *   - si no, OPENAI_API_KEY configurada -> tu propia key, vía probe.wrap (ver llm.ts).
 *   - si no hay ninguna, un stub local (ver llm.ts) para que el ejemplo funcione igual.
 *
 * Qué reemplazaría un cliente real:
 *   - retrieval.ts  -> su propio vector store / búsqueda
 *   - llm.ts        -> su propio cliente de modelos, si prefiere seguir usando su key
 *   - este archivo  -> se mantiene casi igual: solo cambia construirPrompt
 *                      y la forma del `input` si su tarea no es RAG
 */
import { probe, type VectoraCtx } from "@vectora/probe";
import { buscarEnKb, totalDocumentos, type DocumentoKb } from "./retrieval.js";
import { completar } from "./llm.js";

const USA_GATEWAY_VECTORA = Boolean(process.env["VECTORA_API_KEY"]);

function construirPrompt(pregunta: string, docs: DocumentoKb[]): string {
  const contexto = docs.map((d) => `- ${d.titulo}: ${d.contenido}`).join("\n");
  return `Eres el asistente de soporte de Maipo Pagos. Responde la consulta del usuario usando solo el contexto entregado.\n\nContexto:\n${contexto}\n\nConsulta: ${pregunta}`;
}

async function responderConsulta(pregunta: string, ctx: VectoraCtx) {
  const docs = buscarEnKb(pregunta, 3); // no cambia entre modelos
  const prompt = construirPrompt(pregunta, docs); // no cambia entre modelos

  const texto = USA_GATEWAY_VECTORA
    ? (await probe.completar(ctx, { prompt })).texto
    : (await probe.wrap(ctx, (modelo) => completar({ modelo, prompt, contexto: docs.map((d) => d.contenido) }))).texto;

  return {
    respuesta: texto,
    contextoRecuperado: docs.map((d) => ({ id: d.id, titulo: d.titulo, contenido: d.contenido })),
  };
}

probe.register(responderConsulta);

const openAiConfigurada = Boolean(process.env["OPENAI_API_KEY"]);
console.log(`[cliente-demo] knowledge base cargado: ${totalDocumentos()} documentos`);
console.log(
  `[cliente-demo] ${
    USA_GATEWAY_VECTORA
      ? "usando el gateway de Vectora (VECTORA_API_KEY configurada) — Vectora llama al modelo y cobra créditos"
      : openAiConfigurada
        ? "OPENAI_API_KEY configurada — gpt-4o/gpt-4o-mini responden con modelos reales, con tu propia key"
        : "sin ninguna credencial configurada — todas las respuestas son un stub local"
  }`
);
