/**
 * miClienteLLM del ejemplo. Este es el ÚNICO archivo que un cliente real
 * reemplaza por su propio cliente de modelos — el resto (retrieval.ts,
 * index.ts) no cambia.
 *
 * Si hay OPENAI_API_KEY en el entorno, llama de verdad a la API de OpenAI
 * para los modelos "gpt-4o" y "gpt-4o-mini" (los dos ids del catálogo de
 * Vectora que corresponden a modelos reales de OpenAI). Para cualquier otro
 * id del catálogo (claude-3-5-sonnet, gemini-1-5-flash, llama-3-1-70b), o si
 * no hay API key configurada, cae a una respuesta local de ejemplo — dejada
 * así a propósito para que este ejemplo funcione sin configuración, y para
 * que quede clarísimo en la respuesta cuándo estás viendo un modelo real y
 * cuándo un stub.
 */

const MODELOS_OPENAI = new Set(["gpt-4o", "gpt-4o-mini"]);

export interface ParametrosCompletar {
  modelo: string;
  prompt: string;
  contexto: string[];
}

export interface ResultadoCompletar {
  texto: string;
}

export async function completar(params: ParametrosCompletar): Promise<ResultadoCompletar> {
  const apiKey = process.env["OPENAI_API_KEY"];

  if (apiKey && MODELOS_OPENAI.has(params.modelo)) {
    return completarConOpenAI(params, apiKey);
  }

  return completarStubLocal(params);
}

async function completarConOpenAI(params: ParametrosCompletar, apiKey: string): Promise<ResultadoCompletar> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.modelo,
      messages: [{ role: "user", content: params.prompt }],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const cuerpo = await res.text();
    throw new Error(`OpenAI respondió ${res.status}: ${cuerpo.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const texto = data.choices[0]?.message.content ?? "";
  return { texto };
}

/** Sin API key o modelo no soportado en este ejemplo: respuesta local, determinista, sin costo. */
async function completarStubLocal(params: ParametrosCompletar): Promise<ResultadoCompletar> {
  await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 400));
  const snippet = params.contexto[0]?.slice(0, 200);
  const texto = snippet
    ? `[stub local, sin proveedor real configurado para "${params.modelo}"] Según la información disponible: ${snippet}`
    : `[stub local, sin proveedor real configurado para "${params.modelo}"] No encontré contexto suficiente para responder con precisión.`;
  return { texto };
}
