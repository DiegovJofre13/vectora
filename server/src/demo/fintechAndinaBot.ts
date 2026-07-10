import { crearProbe, type VectoraCtx } from "@vectora/probe";
import { completarMock } from "../engine/mockModelEngine.js";
import { buscarEnKb } from "./fintechAndinaKb.js";

/**
 * Fixture demo: el "bot de soporte" de Fintech Andina, patrón A (el wrap solo
 * envuelve la llamada al modelo; retrieval y prompt quedan intactos entre
 * corridas). Corre como proceso propio y expone @vectora/probe real en
 * VECTORA_DEMO_BOT_PORT — así el motor de evaluación lo llama exactamente
 * como llamaría al sistema de un cliente real.
 */

function construirPrompt(pregunta: string, docs: { titulo: string; contenido: string }[]): string {
  const contexto = docs.map((d) => `- ${d.titulo}: ${d.contenido}`).join("\n");
  return `Eres el asistente de soporte de Fintech Andina. Responde la consulta del usuario usando solo el contexto entregado.\n\nContexto:\n${contexto}\n\nConsulta: ${pregunta}`;
}

async function miClienteLLM_completar(params: { modelo: string; prompt: string; contexto: string[] }) {
  return completarMock({ modelo: params.modelo, prompt: params.prompt, contextoRecuperado: params.contexto });
}

async function responderConsulta(pregunta: string, ctx: VectoraCtx) {
  const docs = buscarEnKb(pregunta, 3); // no cambia entre modelos
  const prompt = construirPrompt(pregunta, docs); // no cambia entre modelos

  const resultado = await probeBot.wrap(ctx, (modelo) =>
    miClienteLLM_completar({ modelo, prompt, contexto: docs.map((d) => d.contenido) })
  );

  return {
    respuesta: resultado.texto ?? "",
    contextoRecuperado: docs.map((d) => ({ id: d.id, titulo: d.titulo, contenido: d.contenido })),
  };
}

const puerto = Number(process.env["VECTORA_DEMO_BOT_PORT"] ?? 4501);
export const probeBot = crearProbe({ puerto, nombreSistema: "Fintech Andina · Bot de soporte", autoServe: false });
probeBot.register(responderConsulta);

// Permite levantar este fixture como proceso propio: `tsx src/demo/fintechAndinaBot.ts`.
if (process.argv[1] && process.argv[1].endsWith("fintechAndinaBot.ts")) {
  probeBot.levantarServidor();
}
