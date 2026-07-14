/**
 * Cliente demo: un bot RAG mínimo pero real (patrón A del SDK), pensado como
 * plantilla para que un cliente real vea exactamente qué reemplazar. Usa
 * @vectora/probe de verdad — no hay ningún atajo especial para este ejemplo.
 *
 * El único camino soportado para llamar al modelo es el gateway de Vectora
 * (`probe.completar()`) — Vectora paga al proveedor real y cobra créditos,
 * el cliente nunca necesita su propia API key de proveedor. Ver
 * docs/COMO-FUNCIONA-LA-CONEXION.md § 5. Sin VECTORA_API_KEY configurada,
 * este ejemplo cae a un stub local (ver llm.ts) para poder correrlo sin
 * configuración — no hay ninguna alternativa con key propia del cliente.
 *
 * Qué reemplazaría un cliente real:
 *   - retrieval.ts  -> su propio vector store / búsqueda
 *   - este archivo  -> se mantiene casi igual: solo cambia construirPrompt
 *                      y la forma del `input` si su tarea no es RAG
 *
 * También llama a `probe.exponerKb()` con el knowledge base real, para que
 * Vectora lo pueda importar automáticamente en el paso "Conecta tu sistema"
 * en vez de que alguien lo pegue a mano — es opcional, ver docs/CONECTAR-SISTEMA-REAL.md.
 */
import { probe, type VectoraCtx } from "@vectora/probe";
import { buscarEnKb, todosLosDocumentos, totalDocumentos, type DocumentoKb } from "./retrieval.js";
import { completarStubLocal } from "./llm.js";

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
    : (await completarStubLocal({ modelo: ctx.modelo, contexto: docs.map((d) => d.contenido) })).texto;

  return {
    respuesta: texto,
    contextoRecuperado: docs.map((d) => ({ id: d.id, titulo: d.titulo, contenido: d.contenido })),
  };
}

probe.register(responderConsulta);
// Opcional: expone el knowledge base real para que Vectora lo importe automáticamente
// en el paso "Conecta tu sistema" (GET /probe/kb), en vez de pegarlo a mano en la UI.
probe.exponerKb(todosLosDocumentos());

console.log(`[cliente-demo] knowledge base cargado: ${totalDocumentos()} documentos`);
console.log(
  `[cliente-demo] ${
    USA_GATEWAY_VECTORA
      ? "usando el gateway de Vectora (VECTORA_API_KEY configurada) — Vectora llama al modelo y cobra créditos"
      : "sin VECTORA_API_KEY — todas las respuestas son un stub local (cargá créditos y configurá la key para modelos reales)"
  }`
);
