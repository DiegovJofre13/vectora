/**
 * Cliente demo: un bot RAG mínimo pero real (patrón A del SDK), pensado como
 * plantilla para que un cliente real vea exactamente qué reemplazar. Usa
 * @vectora/probe de verdad — no hay ningún atajo especial para este ejemplo.
 *
 * Qué reemplazaría un cliente real:
 *   - retrieval.ts  -> su propio vector store / búsqueda
 *   - llm.ts        -> su propio cliente de modelos (ya soporta OpenAI real
 *                      si hay OPENAI_API_KEY; ver ese archivo)
 *   - este archivo  -> se mantiene casi igual: solo cambia construirPrompt
 *                      y la forma del `input` si su tarea no es RAG
 */
import { probe, type VectoraCtx } from "@vectora/probe";
import { buscarEnKb, totalDocumentos, type DocumentoKb } from "./retrieval.js";
import { completar } from "./llm.js";

function construirPrompt(pregunta: string, docs: DocumentoKb[]): string {
  const contexto = docs.map((d) => `- ${d.titulo}: ${d.contenido}`).join("\n");
  return `Eres el asistente de soporte de Maipo Pagos. Responde la consulta del usuario usando solo el contexto entregado.\n\nContexto:\n${contexto}\n\nConsulta: ${pregunta}`;
}

async function responderConsulta(pregunta: string, ctx: VectoraCtx) {
  const docs = buscarEnKb(pregunta, 3); // no cambia entre modelos
  const prompt = construirPrompt(pregunta, docs); // no cambia entre modelos

  const resultado = await probe.wrap(ctx, (modelo) =>
    completar({ modelo, prompt, contexto: docs.map((d) => d.contenido) })
  );

  return {
    respuesta: resultado.texto,
    contextoRecuperado: docs.map((d) => ({ id: d.id, titulo: d.titulo, contenido: d.contenido })),
  };
}

probe.register(responderConsulta);

const apiKeyConfigurada = Boolean(process.env["OPENAI_API_KEY"]);
console.log(`[cliente-demo] knowledge base cargado: ${totalDocumentos()} documentos`);
console.log(`[cliente-demo] OPENAI_API_KEY ${apiKeyConfigurada ? "configurada — gpt-4o/gpt-4o-mini responden con modelos reales" : "no configurada — todas las respuestas son un stub local"}`);
