/**
 * Gateway de modelos de Vectora: la llamada real al proveedor, cuando el
 * cliente usa `probe.completar()` en vez de su propia API key (ver
 * probe/src/probe.ts y docs/COMO-FUNCIONA-LA-CONEXION.md § "Gateway de
 * Vectora"). Solo OpenAI por ahora — confirmado con el negocio, se agregan
 * más proveedores (Anthropic, Google, Bedrock) cuando haya keys para ellos.
 *
 * El costo se calcula con los tokens reales que devuelve la API de OpenAI
 * (`usage.prompt_tokens`/`usage.completion_tokens`), no con la heurística de
 * caracteres que usa el motor Mock (`mockModelEngine.ts::estimarCostoUsd`) —
 * acá se factura con dinero real, así que el costo tiene que ser exacto.
 */

const TIMEOUT_GATEWAY_MS = 60_000;

/** USD por 1K tokens. Ver https://openai.com/api/pricing — revisar antes de confiar en esto
 * para facturación de producción, los precios de los proveedores cambian sin aviso. */
const PRECIOS_OPENAI: Record<string, { entrada1K: number; salida1K: number }> = {
  "gpt-4o": { entrada1K: 0.0025, salida1K: 0.01 },
  "gpt-4o-mini": { entrada1K: 0.00015, salida1K: 0.0006 },
};

export function modeloSoportadoPorGateway(modelo: string): boolean {
  return modelo in PRECIOS_OPENAI;
}

/** Precio por 1K tokens del modelo, si el gateway lo soporta — para estimar costo antes de llamar. */
export function precioGateway(modelo: string): { entrada1K: number; salida1K: number } | undefined {
  return PRECIOS_OPENAI[modelo];
}

export interface ResultadoGateway {
  texto: string;
  tokensEntrada: number;
  tokensSalida: number;
  costoBaseUsd: number;
}

export async function completarConGateway(modelo: string, prompt: string, formato?: "json"): Promise<ResultadoGateway> {
  const precios = PRECIOS_OPENAI[modelo];
  if (!precios) {
    throw new Error(`El gateway de Vectora todavía no soporta el modelo "${modelo}" (solo modelos de OpenAI por ahora).`);
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error("El gateway de Vectora no tiene OPENAI_API_KEY configurada en el server.");
  }

  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_GATEWAY_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        // OpenAI exige que el prompt mencione "JSON" cuando se pide este response_format —
        // responsabilidad del cliente al armar su prompt para Patrón B (extracción/clasificación).
        ...(formato === "json" ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controlador.signal,
    });

    if (!res.ok) {
      const cuerpo = await res.text();
      throw new Error(`OpenAI respondió ${res.status}: ${cuerpo.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const texto = data.choices[0]?.message.content ?? "";
    const tokensEntrada = data.usage.prompt_tokens;
    const tokensSalida = data.usage.completion_tokens;
    const costoBaseUsd = (tokensEntrada / 1000) * precios.entrada1K + (tokensSalida / 1000) * precios.salida1K;

    return { texto, tokensEntrada, tokensSalida, costoBaseUsd: Number(costoBaseUsd.toFixed(6)) };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenAI no respondió dentro de ${TIMEOUT_GATEWAY_MS / 1000}s (timeout).`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
