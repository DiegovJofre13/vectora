# Conectar modelos reales

Esta guía explica exactamente qué tocar para pasar del motor Mock a modelos reales (Bedrock, OpenAI, Anthropic, Google, etc.), sin rediseñar nada de Vectora. Léela junto con `DECISIONS.md`, que explica *por qué* cada pieza está mockeada como está.

## Primero, lo más importante: en el caso real (un cliente conectando su sistema), no hay nada que cambiar en Vectora

Vectora nunca llama a un modelo directamente. El punto de contacto con el modelo vive **dentro del sistema del cliente**, en su función registrada con `probe.register(fn)`, en el callback que le pasan a `probe.wrap(ctx, callback)`:

```typescript
const respuesta = await probe.wrap(ctx, (modelo) =>
  miClienteLLM.completar({ modelo, prompt })  // ← acá es donde vive la llamada real
);
```

Si `miClienteLLM.completar` ya llama a OpenAI/Bedrock/Anthropic de verdad (con sus propias API keys, en la infraestructura del cliente), **Vectora ya está evaluando modelos reales, sin ningún cambio**. El SDK (`@vectora/probe`), el orquestador, el juez, el scoring — nada de eso sabe ni le importa si `wrap` terminó llamando a un modelo real o a un mock. Esa es la razón de ser del diseño: la frontera entre "mock" y "real" es una sola función, dentro del código del cliente, no dentro de Vectora.

Lo único que el cliente necesita saber es **qué strings de modelo va a recibir** en `ctx.modelo` / el parámetro `modelo` de `wrap`, para mapearlos a la llamada real correcta. Esos ids son los del catálogo (`server/src/engine/modelCatalog.ts`):

| id del catálogo | proveedor | modelo real sugerido |
|---|---|---|
| `gpt-4o` | OpenAI | `gpt-4o` |
| `claude-3-5-sonnet` | Anthropic | `claude-3-5-sonnet-20241022` |
| `gemini-1-5-flash` | Google | `gemini-1.5-flash` |
| `gpt-4o-mini` | OpenAI | `gpt-4o-mini` |
| `llama-3-1-70b` | Meta (self-hosted / Bedrock) | `meta.llama3-1-70b-instruct-v1:0` (Bedrock) o el endpoint self-hosted que corresponda |

Ejemplo de un `miClienteLLM.completar` real, enrutando por id:

```typescript
async function completar({ modelo, prompt }: { modelo: string; prompt: string }) {
  switch (modelo) {
    case "gpt-4o":
    case "gpt-4o-mini":
      return openai.chat.completions.create({ model: modelo, messages: [{ role: "user", content: prompt }] });
    case "claude-3-5-sonnet":
      return anthropic.messages.create({ model: "claude-3-5-sonnet-20241022", messages: [{ role: "user", content: prompt }] });
    case "gemini-1-5-flash":
      return genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).generateContent(prompt);
    case "llama-3-1-70b":
      return bedrock.send(new InvokeModelCommand({ modelId: "meta.llama3-1-70b-instruct-v1:0", body: JSON.stringify({ prompt }) }));
  }
}
```

**Las API keys viven en el sistema del cliente, nunca en Vectora.** El server de Vectora solo hace `POST /probe/ejecutar` al endpoint HTTP del cliente — no necesita, no pide, y no debería recibir ningún credential de proveedor de modelos. Esto es una propiedad de seguridad del diseño, no un detalle de implementación: mantenla así.

## Segundo: los fixtures demo de Fintech Andina (si quieres una demo con modelos reales)

`server/src/demo/fintechAndinaBot.ts` y `server/src/demo/fintechAndinaFraude.ts` son sistemas reales que usan `@vectora/probe` de verdad, pero su `miClienteLLM` es `completarMock` (`server/src/engine/mockModelEngine.ts`) — para que la demo funcione sin API keys. Si quieres una demo con modelos reales (ej. para mostrarle a un design partner), el único cambio es reemplazar esa llamada:

En `fintechAndinaBot.ts`:
```typescript
// Antes:
async function miClienteLLM_completar(params: { modelo: string; prompt: string; contexto: string[] }) {
  return completarMock({ modelo: params.modelo, prompt: params.prompt, contextoRecuperado: params.contexto });
}

// Después (ejemplo con OpenAI + Anthropic):
async function miClienteLLM_completar(params: { modelo: string; prompt: string; contexto: string[] }) {
  const texto = await completarReal(params.modelo, params.prompt); // tu función, ver tabla de arriba
  return { texto };
}
```

Mismo cambio en `fintechAndinaFraude.ts`, en `miClienteLLM_completarJSON` (ahí además hay que pedirle al modelo real que devuelva JSON — `response_format: { type: "json_object" }` en OpenAI, tool use forzado en Anthropic, etc., según el proveedor).

No hay que tocar `probeBot`/`probeFraude`, el `register`, ni el `wrap` — siguen exactamente igual.

## Tercero: el juez (opcional, pero recomendado para producción)

`server/src/engine/judge.ts::juzgar()` hoy calcula groundedness/relevancia/completitud con solapamiento léxico (sin llamar a ningún modelo) — ver DECISIONS.md para el porqué. Es honesto pero es un proxy imperfecto de calidad real. Para producción, reemplázalo por un juez LLM real, **de una familia de modelo distinta a las evaluadas** (el mismo requisito que pide el producto):

- Mantén la firma exacta: `juzgar(entrada: EntradaJuez): VeredictoJuez` (o su versión async si el juez real requiere await, y actualiza el único call site en `orchestrator.ts`).
- El juez real debería recibir los mismos 4 campos (`pregunta`, `contextoRecuperado`, `respuesta`, `referenciaProvisional`) en el prompt, pedirle al modelo que emita los 3 scores + una razón, y derivar `confianza` de la propia introspección del modelo (o de un segundo muestreo) en vez de la heurística de varianza actual.
- No toques `orchestrator.ts` ni `report.ts` — ambos solo conocen la forma de `VeredictoJuez`, no cómo se calcula.

## Cuarto: el agente generador (opcional)

`server/src/engine/generatorAgent.ts::generarPreguntas()` usa plantillas deterministas sobre el KB. Para preguntas más realistas, reemplázalo por una llamada real a un LLM que lea los documentos y genere las ~30 preguntas con dificultad escalonada. Mantén la firma (`generarPreguntas(docs, cantidad): PreguntaGenerada[]`, o su versión async) — `orchestrator.ts` es el único caller.

## Quinto: costo real en vez de la heurística de caracteres

`server/src/engine/mockModelEngine.ts::estimarCostoUsd()` estima tokens con `(chars_entrada + chars_salida) / 4`. Es una aproximación razonable para comparar modelos entre sí (todos usan la misma heurística, así que el sesgo es consistente), pero no es exacta. Si quieres costos reales:

- La mayoría de proveedores devuelven `usage` (tokens de entrada/salida) en la respuesta real de la API. Ese dato vive del lado del cliente (dentro de `miClienteLLM.completar`), no de Vectora.
- Para que Vectora lo aproveche, el cliente tendría que devolverlo en `ProbeResultado` (ej. agregando un campo opcional `uso?: { tokensEntrada: number; tokensSalida: number }` al contrato del SDK) y el orquestador (`orchestrator.ts`, donde hoy llama a `estimarCostoUsd`) usarlo si está presente, con fallback a la heurística si no. Esto es un cambio de contrato del SDK — evalúalo con cuidado si ya tienes clientes integrados contra la versión actual.

## Checklist

- [ ] El sistema del cliente llama a un modelo real dentro del callback de `wrap` — nada que tocar en Vectora.
- [ ] (Opcional, demo) Fixtures de Fintech Andina apuntando a modelos reales en vez de `completarMock`.
- [ ] (Opcional, producción) Juez LLM real de otra familia, misma firma que `juzgar()`.
- [ ] (Opcional, producción) Agente generador con LLM real, misma firma que `generarPreguntas()`.
- [ ] (Opcional, precisión de costos) Contrato del SDK extendido con `uso` real, con fallback a la heurística.
- [ ] API keys de proveedores de modelos viven solo en el sistema del cliente. Nunca en `server/.env` ni en ningún lugar del código de Vectora.
