import { crearProbe, type VectoraCtx } from "@vectora/probe";
import { completarMock } from "../engine/mockModelEngine.js";

/**
 * Fixture demo: "Detección de fraude" de Fintech Andina, patrón B (input
 * existente, sin retrieval). El motor de evaluación corre transacciones ya
 * existentes contra cada modelo y compara el resultado estructurado.
 */

export interface TransaccionInput {
  id: string;
  montoClp: number;
  pais: string;
  canal: string;
  horaLocal: string;
  alertasPrevias: number;
}

function construirPrompt(input: TransaccionInput): string {
  return `Evalúa si esta transacción es fraudulenta. Responde con esFraude (true/false) y motivo breve.\nTransacción: ${JSON.stringify(input)}`;
}

async function miClienteLLM_completarJSON(params: { modelo: string; prompt: string }) {
  return completarMock({
    modelo: params.modelo,
    prompt: params.prompt,
    camposEsperados: { esFraude: "false", motivo: "patrón de gasto consistente con el historial del usuario" },
  });
}

async function extraerFraude(input: TransaccionInput, ctx: VectoraCtx) {
  const prompt = construirPrompt(input);
  const resultado = await probeFraude.wrap(ctx, (modelo) => miClienteLLM_completarJSON({ modelo, prompt }));
  return { respuesta: resultado.json ?? {} };
}

const puerto = Number(process.env["VECTORA_DEMO_FRAUDE_PORT"] ?? 4502);
export const probeFraude = crearProbe({ puerto, nombreSistema: "Fintech Andina · Detección de fraude", autoServe: false });
probeFraude.register(extraerFraude);

if (process.argv[1] && process.argv[1].endsWith("fintechAndinaFraude.ts")) {
  probeFraude.levantarServidor();
}
