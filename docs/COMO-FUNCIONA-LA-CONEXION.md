# Cómo funciona la conexión

Este documento describe el sistema tal como quedó construido, leyendo el código real — no repite la spec original. Las citas de código tienen la ruta y, cuando ayuda, la línea. Si algo acá no calza con el código, el código manda: avísame y lo corrijo.

Piezas involucradas:
- `probe/src/probe.ts` — el SDK que el cliente instala (`@vectora/probe`).
- `server/src/engine/orchestrator.ts` — el orquestador de Vectora, quien llama al probe del cliente.
- `server/src/routes/casosDeUso.ts` — el endpoint de "verificar conexión".

## 1. El ciclo de vida completo de una corrida

```
UI de Vectora              Server de Vectora                    Sistema del cliente
(navegador)                 (orchestrator.ts)                    (@vectora/probe)
     |                            |                                     |
     | 1. Crear caso de uso       |                                     |
     |--------------------------->|                                     |
     |                            |                                     |
     | 2. Verificar conexión      |                                     |
     |--------------------------->| GET /probe/salud                    |
     |                            |------------------------------------>|
     |                            |<--{ok, registrado, nombreSistema}---|
     |                            | POST /probe/ejecutar (1 caso de prueba, modelo fijo) |
     |                            |------------------------------------>| fn(input, ctx)
     |                            |                                     |   probe.completar(ctx, {prompt}) -> gateway -> LLM real
     |                            |<--{ok, respuesta, ...}--------------|
     |<--conexión verificada------|                                     |
     |                            |                                     |
     | 3. Elegir modelos + KB /   |                                     |
     |    documentos existentes   |                                     |
     |--------------------------->|                                     |
     |                            |                                     |
     | 4. Confirmar y correr      |                                     |
     |--------------------------->| generarPreguntas() (agente generador,|
     |                            |   si es RAG) o toma los documentos   |
     |                            |   existentes que mandó el usuario    |
     |                            | crea EvaluacionCorrida + N CasoPrueba|
     |<--corridaId-----------------|  (síncrono, sin tocar al cliente aún)|
     |                            |                                     |
     |                            | ejecutarCorridaParaGobernanza()      |
     |                            | fire-and-forget: NO se espera acá,   |
     |                            | el request ya devolvió el corridaId  |
     |                            |                                     |
     |                            | por cada (CasoPrueba × modelo),      |
     |                            | hasta 4 en simultáneo:               |
     |                            | POST /probe/ejecutar                |
     |                            | {input, modelo, casoUsoId,           |
     |                            |  casoPruebaId}                       |
     |                            |------------------------------------>| fn(input, ctx)
     |                            |                                     |   ctx.modelo = "gpt-4o" (ej.)
     |                            |                                     |   probe.completar(ctx, { prompt })
     |                            |                                     |   -> POST al gateway de Vectora ->
     |                            |                                     |      OpenAI real con ESE modelo
     |                            |<--{ok, respuesta, contextoRecuperado,|
     |                            |    latenciaMs}-----------------------|
     |                            | juzgar() (RAG) o scoreEstructural()  |
     |                            |   (extracción/clasificación)         |
     |                            | guarda ResultadoModelo               |
     |                            |                                     |
     | 5. Poll cada 1.2s          |                                     |
     |--------------------------->| GET progreso                        |
     |<--{completados, porModelo}-|                                     |
     |                            |                                     |
     |     ... se repite hasta cubrir todos los pares caso×modelo ...   |
     |                            | estado=completado, costoRealUsd      |
     |                            |                                     |
     | 6. Ver reporte             |                                     |
     |--------------------------->| generarReporte(): agrega scores,     |
     |<--veredicto+tabla+pareto---|   arma frontera de Pareto            |
```

Código real de cada paso:
- Paso 2 — `server/src/routes/casosDeUso.ts`, handler `POST /api/casos-de-uso/:id/verificar-conexion`.
- Paso 4 (crear corrida) — `server/src/engine/orchestrator.ts::iniciarCorrida()`.
- Paso 4 (ejecutar, fire-and-forget) — `iniciarCorrida()` llama `void ejecutarCorridaParaGobernanza(...)` sin `await` y sin bloquear el `return { corridaId }`. La UI empieza a hacer polling inmediatamente.
- El loop de ejecución — `ejecutarCorridaParaGobernanza()`, que arma una tarea por cada `(CasoPrueba, modelo)` y las corre con `crearLimitador(CONCURRENCIA_MAXIMA)` (`server/src/lib/pLimit.ts`), `CONCURRENCIA_MAXIMA = 4` (`orchestrator.ts:9`). No es "manda las 150 llamadas de una" — hay como máximo 4 llamadas HTTP al probe del cliente abiertas a la vez.
- Paso 5 — `GET /api/casos-de-uso/:id/evaluaciones/:corridaId/progreso`, que simplemente cuenta cuántos `ResultadoModelo` existen por modelo (`orchestrator.ts::obtenerProgreso()`). No hay estado en memoria — si el server se reinicia a mitad de una corrida, el progreso se sigue leyendo bien de la base (aunque la corrida en sí queda huérfana, ver Limitaciones).

## 2. Cómo se intercambia el modelo, exactamente

`ctx` lo arma el propio SDK, no el cliente, en `probe.ejecutar()` (`probe.ts:76-80`):

```typescript
const ctx: VectoraCtx = {
  modelo: req.modelo,          // viene del body del POST /probe/ejecutar que mandó Vectora
  casoUsoId: req.casoUsoId,
  casoPruebaId: req.casoPruebaId,
};
```

Y ese `req.modelo` es literalmente el string que el orquestador de Vectora puso en el body del POST (`orchestrator.ts`, dentro de `llamarProbe`):

```typescript
const resultado = await llamarProbe(probeUrl, {
  input: inputParaProbe,
  modelo,                      // el id del catálogo: "gpt-4o", "claude-3-5-sonnet", etc.
  casoUsoId: corrida.casoDeUsoId,
  casoPruebaId: casoPrueba.id,
});
```

El cliente lo usa llamando a `probe.completar(ctx, { prompt })` (`probe.ts`, ver método `completar`), que manda `ctx.modelo` tal cual al gateway de Vectora:

```typescript
async completar(ctx: VectoraCtx, params: CompletarParams): Promise<CompletarResultado> {
  const res = await fetch(`${this.gatewayUrl}/api/gateway/completar`, {
    method: "POST",
    headers: { authorization: `Bearer ${this.apiKey}` },
    body: JSON.stringify({ modelo: ctx.modelo, prompt: params.prompt, formato: params.formato }),
  });
  // ...
}
```

Entonces la cadena completa es: **Vectora decide el modelo → lo manda en el JSON del POST a `/probe/ejecutar` → el SDK lo mete en `ctx.modelo` → `completar()` se lo manda al gateway de Vectora → el gateway llama al proveedor real con ese modelo exacto.** A diferencia del mecanismo anterior (`wrap`, ver nota abajo), acá Vectora sí controla qué modelo se llama de verdad — es su propio server el que hace la llamada al proveedor, no código del cliente.

Para el patrón C (sistema detrás de su propia API HTTP), existe `modeloActual(ctx)` (`probe.ts:62-64`), que es literalmente `return ctx.modelo` — el cliente lo lee para mandárselo a su propio backend, que a su vez debería llamar al gateway de Vectora en el punto donde antes llamaba a un proveedor.

> **Nota sobre `wrap`:** el SDK todavía tiene un método `wrap(ctx, llamadaModelo)` que le pasa `ctx.modelo` a un callback arbitrario del cliente — es el mecanismo que usan los fixtures de demo internos de Vectora (que llaman al motor Mock, no a un proveedor real). Ya no es un camino documentado ni mostrado para conectar un sistema real: el único camino soportado es `completar()`. Ver § 5 para por qué esto es una decisión de producto, no algo que el SDK pueda forzar técnicamente.

## 3. Qué exige el SDK del sistema del cliente

Lo mínimo indispensable:
1. Llamar `probe.register(fn)` una vez, al arrancar el proceso. Esto además levanta el servidor HTTP (`probe.ts:41-46`) — si nunca se llama `register`, no hay servidor escuchando y `verificar-conexión` falla con conexión rechazada.
2. `fn` debe devolver `Promise<{ respuesta, contextoRecuperado? }>` (`ProbeResultado`, ver contrato abajo). Si devuelve cualquier otra forma, `probe.ejecutar()` no valida el shape — lo reenvía tal cual, y Vectora intentará leer `.respuesta` de lo que sea que haya devuelto. Si `fn` no tiene `respuesta`, el reporte va a mostrar `undefined` serializado, sin error explícito en ese punto (el error aparecería después, al intentar juzgar/scorear un valor vacío).
3. En algún punto adentro de `fn`, el código del cliente debe llamar `probe.completar(ctx, { prompt })` (o, en patrón C, leer `probe.modeloActual(ctx)` y pasárselo a su backend, que a su vez debería llamar al gateway).

### El supuesto frágil más importante

**El SDK no puede impedir que el cliente llame a un modelo por su cuenta, con su propia key, en vez de usar `completar()`.** `fn` es código del cliente corriendo en su propia infraestructura — Vectora nunca la ve. Si alguien escribe adentro de su función registrada una llamada directa a OpenAI con su propia key (en vez de `probe.completar()`), no hay forma de detectarlo ni bloquearlo desde el SDK. La política de Vectora es no mostrar ni documentar ese camino en ningún lado (ver § 5) — pero es una política de producto, no una garantía técnica.

Un síntoma relacionado, si algo así ocurre (o si `completar()` se llama pero el modelo termina ignorado en el prompt/lógica del cliente): **los modelos del panel devuelven respuestas idénticas o casi idénticas**, con latencia parecida entre sí. El reporte va a mostrar filas con precisión/latencia muy similares y un "veredicto" sin sentido real. Vectora hoy **no detecta este caso automáticamente** — no hay ningún chequeo tipo "¿las respuestas de modelos distintos son sospechosamente idénticas?". Si conectas un sistema y el reporte te muestra a todos los modelos con precisión y latencia casi idénticas, sospecha primero de esto antes de sospechar del juez.

### Otros supuestos

- El campo `input` que le llega a `fn` viene tal cual lo generó Vectora (una pregunta string para RAG, o el objeto `documento` para extracción/clasificación). Si `fn` espera una forma distinta (ej. siempre un objeto con una clave particular), va a fallar al desestructurar — eso sí se ve, porque `probe.ejecutar()` atrapa la excepción y devuelve `{ ok: false, error: <mensaje> }` (`probe.ts:82-88`), y el orquestador guarda ese error como el resultado de ese caso×modelo (no aborta la corrida entera, ver más abajo).
- El endpoint de verificar-conexión prueba con `modelo: "gpt-4o-mini"` hardcodeado (`casosDeUso.ts`, dentro de `verificar-conexion`) y un `input` de prueba que es el string literal `"prueba de conexión de Vectora"`. Si el tipo de tarea del caso es extracción/clasificación (donde `fn` espera un objeto `documento`, no un string), esta prueba de conexión puede fallar por una razón que no tiene nada que ver con la conexión en sí — el cliente recibe un string donde esperaba un objeto. Si te pasa esto al conectar un sistema real de extracción, es un falso negativo conocido, no que tu sistema esté mal.

## 4. Los contratos exactos

De `probe/src/types.ts`, tal cual:

```typescript
/** Contexto que Vectora inyecta en cada invocación de una corrida. */
export interface VectoraCtx {
  modelo: string;                 // obligatorio: qué modelo toca en esta invocación
  casoUsoId?: string;             // opcional
  casoPruebaId?: string;          // opcional
  _metrica?: { latenciaMs: number; modelo: string }; // interno, lo escribe wrap — no tocar
}

/** Forma de salida obligatoria de toda función registrada. */
export interface ProbeResultado {
  respuesta: string | Record<string, unknown>;  // obligatorio
  contextoRecuperado?: unknown;                  // opcional — sin esto, el juez no puede medir groundedness
}

/** Función de entrada que el cliente declara con `probe.register(fn)`. */
export type FuncionRegistrada<TInput = unknown> = (
  input: TInput,
  ctx: VectoraCtx
) => Promise<ProbeResultado>;

/** Llamada al modelo que el cliente envuelve con `probe.wrap(ctx, llmCall)`. */
export type LlamadaModelo<T = unknown> = (modelo: string) => Promise<T>;
```

- `register(fn)` — obligatorio, una vez por proceso. `fn` puede ser genérico en `TInput`, pero en tiempo de ejecución no hay validación de tipo — lo que llega por HTTP se castea, no se valida contra un schema.
- `wrap(ctx, llamadaModelo)` — obligatorio en el punto donde se llama al modelo. Retorna lo que sea que devuelva `llamadaModelo` (genérico `T`), sin tocarlo — el cliente decide la forma de `T`.
- `contextoRecuperado` es **opcional**. Si no lo mandas (ej. un caso que no hace retrieval), el juez igual corre, pero `groundedness` se calcula contra un contexto vacío — en la práctica da groundedness ≈ 0 siempre, porque no hay nada contra qué comparar. Para tareas RAG de verdad, mandar `contextoRecuperado` no es opcional en la práctica, aunque el tipo lo permita.

## 5. El gateway de Vectora: quién hace la llamada al modelo

**Vectora hace la llamada real, absorbe el costo, y se lo cobra al cliente vía créditos** (pago por uso, con margen). Es el único camino documentado y soportado — así los costos quedan gobernados y visibles del lado de Vectora, no dispersos en las cuentas de cada cliente. (El SDK todavía tiene `wrap`, que le pasaría el modelo a un callback del cliente con su propia key — pero eso ya no se muestra en ningún snippet, ejemplo, ni doc; queda solo para uso interno de Vectora, ver nota en § 2.)

```typescript
const { texto } = await probe.completar(ctx, { prompt });  // la key de Vectora, te cobra créditos
```

`probe.completar()` es el método del SDK (`probe/src/probe.ts`) para esto. Requiere un `apiKey` de Vectora (`crearProbe({ apiKey })` o env var `VECTORA_API_KEY`), que identifica a la organización que paga — la sacás desde la UI (Gobernanza → Créditos). Por dentro:

1. `probe.completar` hace `POST {gatewayUrl}/api/gateway/completar` con `Authorization: Bearer <apiKey>` y `{modelo, prompt}` (`gatewayUrl` default `http://localhost:4310`, o env var `VECTORA_GATEWAY_URL` — en un deploy real, la URL pública del server de Vectora).
2. El server (`routes/gateway.ts`) busca la organización dueña de ese `apiKey`, chequea que tenga saldo positivo, y si alcanza, llama de verdad a OpenAI (`engine/providerGateway.ts::completarConGateway` — **solo modelos de OpenAI por ahora**, confirmado con el negocio; otros proveedores quedan para cuando haya keys).
3. El costo se calcula con los tokens reales que devuelve OpenAI (`usage.prompt_tokens`/`usage.completion_tokens`), no con una heurística — acá se cobra plata de verdad. Se le aplica un margen del 30% (`engine/billing.ts::MARGEN_GATEWAY`) y el total se descuenta del saldo de la organización (`engine/credits.ts::registrarConsumo`), quedando en el ledger (`MovimientoCreditos`, tipo `"consumo"`).
4. Si el saldo no alcanza, el gateway responde `402` con un error claro, y `probe.completar` lo propaga como excepción — la función registrada del cliente falla igual que si el proveedor real hubiera dado un error.

Además de `iniciarCorrida()` (Vectora corre casos contra el probe del cliente) hay un segundo gate, **antes** de eso: al confirmar "correr" en el stepper, Vectora estima el costo de la corrida completa (la misma heurística de `costEstimator.ts` que ya mostraba el costo estimado) + margen, y si el saldo de la organización no alcanza para esa estimación, bloquea la corrida entera antes de gastar nada (`orchestrator.ts::iniciarCorrida`, y lo mismo en `governance.ts::simularEventoNuevoModelo` para las alertas por evento). Es un gate grueso (estimación, no el costo exacto) — el gate fino y exacto es el del punto 4, que solo cobra por lo que de verdad pasa por el gateway.

**Importante:** Vectora no tiene forma de saber, al recibir un `POST /probe/ejecutar` del cliente, qué hizo la función registrada por dentro — si de verdad llamó a `probe.completar()` (el gateway) o si, pese a que ya no se documenta ni se muestra en ningún lado, alguien escribió su propia llamada a un proveedor con su propia key. El pre-check de saldo en `iniciarCorrida()` bloquea la corrida completa asumiendo el camino documentado (el gateway); si en la práctica el cliente usa su propia key para todo, ese pre-check es más conservador de lo necesario (no se cobra nada, pero tampoco corre si el saldo está en cero). Ver Limitaciones conocidas.

## 6. Autenticación y comunicación

Hay dos direcciones distintas, con seguridad distinta:

**Vectora → cliente (siempre así, sin cambios):** el server de Vectora es quien inicia la conexión (`fetch` desde `orchestrator.ts` y `casosDeUso.ts` hacia el `probeUrl` que el usuario ingresó) hacia el servidor HTTP que levanta el SDK del cliente (`probe.ts::levantarServidor()`). **Este servidor no pide ningún API key, token, ni firma** — es HTTP plano, cualquiera que pueda alcanzar ese puerto puede mandarle un `POST /probe/ejecutar` y hacer que ejecute la función registrada con el modelo que quiera. El protocolo es HTTP (no HTTPS) sobre `node:http` directo, sin TLS.

Esto es aceptable para correr todo en `localhost` (fixtures demo, `examples/cliente-demo/`). **No es aceptable para exponer el probe de un cliente real a internet tal cual está.** Si necesitas conectar un sistema en otra máquina/red, la recomendación es un túnel autenticado (`ngrok` con verificación, VPN, SSH tunnel) — no exponer el puerto directamente. Sigue siendo una limitación real, no resuelta por el punto siguiente.

**Cliente → Vectora (nuevo, solo para el gateway):** `POST /api/gateway/completar` sí está autenticado — con el `apiKey` de la organización (`Authorization: Bearer vec_live_...`), generado por Vectora y mostrado en la UI (Gobernanza → Créditos). Esto es una autenticación real (identifica y cobra a una organización), pero acotada solo a este endpoint — no protege el resto de la API de Vectora (`/api/casos-de-uso`, etc.), que sigue sin autenticación (limitación conocida, sin cambios).

## 7. Manejo de errores

Hay dos niveles distintos, y se comportan distinto:

**Nivel caso×modelo (uno de los ~150 pares):**
- Si `fn` tira una excepción, `probe.ejecutar()` la atrapa (`probe.ts:82-88`) y responde `{ ok: false, error: <mensaje> }` con status HTTP 422.
- Si el sistema del cliente no responde dentro de 60 segundos, el orquestador aborta esa llamada puntual con un timeout (`orchestrator.ts::llamarProbe`, `AbortController` + `TIMEOUT_PROBE_MS = 60_000`) y la trata igual que cualquier otro error.
- En cualquiera de los dos casos, el orquestador **no aborta la corrida**: guarda un `ResultadoModelo` con la respuesta `[error] <mensaje>`, costo 0, y un score bajo (`scorePromedio: 0` / `confianzaJuez: 0.15` para RAG, `scoreEstructural: 0` para extracción/clasificación) — así ese caso queda visible como fallido en el reporte, en vez de desaparecer o tirar abajo toda la evaluación.
- No hay reintentos automáticos. Un timeout o error puntual se guarda como tal, no se reintenta ni una vez.

**Nivel corrida completa:**
- Si algo dentro del loop de ejecución tira una excepción que *no* está contemplada (ej. un bug interno, no un error del cliente), el `Promise.all` de `ejecutarCorridaParaGobernanza` rechaza, y el `.catch()` en `iniciarCorrida()` marca la `EvaluacionCorrida` entera como `estado: "error"`. Los `ResultadoModelo` que ya se habían guardado antes de la falla quedan en la base (no se pierden), pero la corrida no sigue y el reporte no se puede generar hasta volver a correrla.
- Si el server de Vectora se reinicia a mitad de una corrida "corriendo", esa corrida queda huérfana: nadie va a seguir llamando al probe del cliente, pero tampoco se marca como error — simplemente el progreso deja de avanzar para siempre. Es una limitación conocida (ver abajo), no un caso manejado.

## 8. Limitaciones conocidas

En orden de qué tan probable es que te muerda esta semana:

1. **No hay forma de detectar si el cliente ignora el parámetro `modelo`, ni de impedir que llame a un proveedor con su propia key en vez de usar `completar()`.** Ver sección 3. "Solo se puede usar el gateway de Vectora" es una política de producto (nada lo muestra ni lo documenta), no una garantía técnica — el SDK no puede inspeccionar el código de la función registrada. Si el reporte muestra a todos los modelos con métricas casi idénticas, sospecha de esto primero.
2. **Sin autenticación ni HTTPS entre Vectora y el probe del cliente** (dirección Vectora→cliente). Solo apto para correr en `localhost` o detrás de un túnel de confianza. Ver sección 6. El gateway (dirección cliente→Vectora) sí está autenticado.
3. **El gateway solo soporta modelos de OpenAI.** `claude-3-5-sonnet`, `gemini-1-5-flash`, `llama-3-1-70b` no tienen key configurada — `probe.completar()` con esos ids tira un error claro (`modeloSoportadoPorGateway` en `providerGateway.ts`), no cae a un mock silencioso.
4. **El pre-check de saldo en `iniciarCorrida()` es una estimación, no el costo exacto**, y bloquea la corrida completa asumiendo que se va a usar el gateway — aunque el cliente termine usando su propia key (en cuyo caso no se le cobra nada, pero el pre-check igual pudo haber bloqueado si el saldo estaba en cero). Ver sección 5.
5. **Sin reconexión si el server de Vectora se reinicia a mitad de una corrida.** La corrida queda huérfana en estado "corriendo" para siempre; hay que volver a lanzarla.
6. **Sin reintentos automáticos** ante timeout o error puntual — un fallo transitorio de red se cuenta como fallo definitivo de ese caso×modelo. Esto aplica también al gateway: si OpenAI falla una vez, no se reintenta, y no se cobra (el error se propaga antes de registrar el consumo).
7. **Verificar-conexión prueba con un solo modelo fijo (`gpt-4o-mini`) y un `input` string fijo.** No prueba los modelos que realmente vas a evaluar, y puede dar falso negativo en tareas de extracción/clasificación (ver sección 3). Tampoco prueba el gateway — no cobra créditos ni valida que el `apiKey` esté bien configurado en el cliente.
8. **`ProbeResultado` no se valida contra el contrato en tiempo de ejecución.** Si `fn` devuelve algo con forma distinta a `{ respuesta, contextoRecuperado? }`, no hay error inmediato — el dato raro se propaga hasta el juez/scoring y ahí puede dar resultados sin sentido en vez de un error claro.
9. **Concurrencia fija en 4** (`CONCURRENCIA_MAXIMA` en `orchestrator.ts`), no configurable por caso de uso ni por API. Si el sistema del cliente no aguanta 4 requests simultáneas, hoy no hay forma de bajarla sin editar código.
10. **El juez y el agente generador siguen siendo heurísticas, no modelos reales** (ver `DECISIONS.md` y `CONNECT-REAL-MODELS.md`) — esto no es una limitación de la *conexión* en sí, pero afecta qué tan confiable es el reporte que sale de una corrida contra un sistema real.
11. **Los precios de OpenAI en `providerGateway.ts` están hardcodeados** (`PRECIOS_OPENAI`) y hay que actualizarlos a mano si OpenAI cambia su tabla de precios — no hay integración con ninguna API de pricing.
