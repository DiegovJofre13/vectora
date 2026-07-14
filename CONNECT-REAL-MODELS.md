# Conectar modelos reales

Esta guía explica exactamente qué tocar para pasar del motor Mock a modelos reales, sin rediseñar nada de Vectora. Léela junto con `DECISIONS.md`, que explica *por qué* cada pieza está mockeada como está.

## Actualización: el camino soportado es el gateway de Vectora, no BYO-key

La primera versión de este documento explicaba cómo un cliente conecta su sistema con su propia API key de proveedor (BYO-key), sin que Vectora tuviera que cambiar nada. Eso sigue siendo *técnicamente* cierto — pero ya **no es el camino que Vectora muestra, documenta, ni recomienda**. Desde que se agregó el gateway de modelos (`probe.completar()`), la política de producto es que Vectora hace la llamada real y cobra créditos con margen — así los costos quedan gobernados del lado de Vectora, no dispersos en las cuentas de cada cliente. Ver `docs/COMO-FUNCIONA-LA-CONEXION.md` § 5 para el detalle completo (incluida la limitación honesta: el SDK no puede *impedir* técnicamente que alguien siga escribiendo su propia integración BYO-key adentro de su función registrada, solo Vectora ya no se lo muestra ni sugiere en ningún lado).

Este documento ahora cubre principalmente las piezas de **infraestructura interna de Vectora** que siguen siendo heurísticas/mock y se pueden reemplazar por algo real (juez, agente generador, fixtures de demo) — no la conexión de un cliente, que está en `docs/CONECTAR-SISTEMA-REAL.md`.

## Primero: los fixtures demo de Fintech Andina (si quieres una demo con modelos reales)

`server/src/demo/fintechAndinaBot.ts` y `server/src/demo/fintechAndinaFraude.ts` son sistemas reales que usan `@vectora/probe` de verdad, pero llaman a `completarMock` (`server/src/engine/mockModelEngine.ts`) — para que la demo funcione sin créditos ni configuración. Si quieres una demo con modelos reales (ej. para mostrarle a un design partner), el cambio es que los fixtures usen el gateway de Vectora igual que cualquier cliente real — "dogfooding" del mismo camino, no un atajo aparte:

En `fintechAndinaBot.ts`:
```typescript
// Antes:
const resultado = await probeBot.wrap(ctx, (modelo) =>
  miClienteLLM_completar({ modelo, prompt, contexto: docs.map((d) => d.contenido) })
);

// Después: el gateway de Vectora, con un apiKey de una organización real (ej. Fintech Andina).
const probeBot = crearProbe({ puerto, nombreSistema: "...", apiKey: process.env["VECTORA_API_KEY"] });
// ...
const resultado = await probeBot.completar(ctx, { prompt });
```

Mismo cambio en `fintechAndinaFraude.ts`, agregando `formato: "json"` en el `completar()` (Patrón B).

No hay que tocar `register`, ni la lógica de retrieval — solo el punto donde antes se llamaba a `completarMock`.

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

- [ ] El sistema del cliente llama a `probe.completar()` en el punto donde antes llamaría a un modelo — nada que tocar en Vectora (ver `docs/CONECTAR-SISTEMA-REAL.md`).
- [ ] (Opcional, demo) Fixtures de Fintech Andina apuntando al gateway de Vectora en vez de `completarMock`.
- [ ] (Opcional, producción) Juez LLM real de otra familia, misma firma que `juzgar()`.
- [ ] (Opcional, producción) Agente generador con LLM real, misma firma que `generarPreguntas()`.
- [ ] (Opcional, precisión de costos) Contrato del SDK extendido con `uso` real, con fallback a la heurística.
- [ ] La única key de proveedor de modelos vive en `server/.env`, del lado de Vectora (hoy: `OPENAI_API_KEY`, solo OpenAI) — el cliente nunca la ve ni la necesita, solo su propio `apiKey` de Vectora (`vec_live_...`).
