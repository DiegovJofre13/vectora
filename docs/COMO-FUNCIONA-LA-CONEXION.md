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
     |                            |                                     |   probe.wrap(ctx, llamar) -> LLM
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
     |                            |                                     |   probe.wrap(ctx, (modelo) =>
     |                            |                                     |     miClienteLLM.completar({modelo, prompt}))
     |                            |                                     |   -> el modelo pedido, no otro
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

Este es el mecanismo completo, sin nada oculto (`probe/src/probe.ts:54-59`):

```typescript
async wrap<T>(ctx: VectoraCtx, llamadaModelo: LlamadaModelo<T>): Promise<T> {
  const inicio = Date.now();
  const resultado = await llamadaModelo(ctx.modelo);
  ctx._metrica = { latenciaMs: Date.now() - inicio, modelo: ctx.modelo };
  return resultado;
}
```

`wrap` no decide nada — el modelo ya viene decidido en `ctx.modelo` **antes** de que `wrap` se ejecute. `ctx` lo arma el propio SDK, no el cliente, en `probe.ejecutar()` (`probe.ts:76-80`):

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

Entonces la cadena completa es: **Vectora decide el modelo → lo manda en el JSON del POST → el SDK lo mete en `ctx.modelo` → `wrap` se lo pasa como argumento al callback del cliente → el cliente decide qué hacer con ese string.**

`wrap` no le exige nada al callback salvo que sea `(modelo: string) => Promise<T>` — el tipo es `LlamadaModelo<T> = (modelo: string) => Promise<T>` (`probe/src/types.ts:38`). El SDK no valida que el callback realmente use el parámetro `modelo` para nada. Eso es responsabilidad 100% del cliente — ver la sección de supuestos frágiles.

Para el patrón C (sistema detrás de su propia API HTTP, sin `wrap` directo sobre la llamada al LLM), existe `modeloActual(ctx)` (`probe.ts:62-64`), que es literalmente `return ctx.modelo` — mismo mecanismo, solo que el cliente lo lee explícitamente en vez de que se lo pase `wrap`.

## 3. Qué exige el SDK del sistema del cliente

Lo mínimo indispensable:
1. Llamar `probe.register(fn)` una vez, al arrancar el proceso. Esto además levanta el servidor HTTP (`probe.ts:41-46`) — si nunca se llama `register`, no hay servidor escuchando y `verificar-conexión` falla con conexión rechazada.
2. `fn` debe devolver `Promise<{ respuesta, contextoRecuperado? }>` (`ProbeResultado`, ver contrato abajo). Si devuelve cualquier otra forma, `probe.ejecutar()` no valida el shape — lo reenvía tal cual, y Vectora intentará leer `.respuesta` de lo que sea que haya devuelto. Si `fn` no tiene `respuesta`, el reporte va a mostrar `undefined` serializado, sin error explícito en ese punto (el error aparecería después, al intentar juzgar/scorear un valor vacío).
3. En algún punto adentro de `fn`, el código del cliente debe llamar `probe.wrap(ctx, callback)` (o leer `probe.modeloActual(ctx)`) y **usar de verdad** el string `modelo` para invocar al proveedor correcto.

### El supuesto frágil más importante

**El SDK no puede detectar si el cliente ignora el parámetro `modelo`.** Si el `miClienteLLM.completar` del cliente tiene el modelo hardcodeado (ej. siempre llama a `gpt-4o` sin mirar el argumento), no pasa nada visible: la corrida completa igual, sin ningún error. Lo que va a pasar es que **los 5 modelos del panel van a devolver respuestas idénticas o casi idénticas** (mismo modelo real respondiendo a la misma pregunta), con latencia parecida entre sí. El reporte va a mostrar 5 filas con precisión/latencia muy similares y un "veredicto" sin sentido real (probablemente recomendando el más barato del catálogo, aunque el modelo que realmente respondió fue siempre el mismo).

Vectora hoy **no detecta este caso automáticamente**. No hay ningún chequeo tipo "¿las respuestas de modelos distintos son sospechosamente idénticas?". Es la limitación más importante para probar con un sistema real esta semana: si conectas un sistema y el reporte te muestra a todos los modelos con precisión y latencia casi idénticas, sospecha primero de esto antes de sospechar del juez.

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

## 5. Autenticación y comunicación

**No hay autenticación.** El servidor HTTP que levanta el SDK (`probe.ts::levantarServidor()`) no pide ningún API key, token, ni firma — es HTTP plano, cualquiera que pueda alcanzar ese puerto puede mandarle un `POST /probe/ejecutar` y hacer que ejecute la función registrada con el modelo que quiera. El protocolo es HTTP (no HTTPS) sobre `node:http` directo, sin TLS.

Esto es aceptable para correr todo en `localhost` (que es el caso de uso actual: los fixtures demo y el ejemplo en `examples/cliente-demo/` corren en la misma máquina que el server de Vectora). **No es aceptable para exponer el probe de un cliente real a internet tal cual está.** Si necesitas conectar un sistema que corre en otra máquina/red esta semana, la recomendación es un túnel autenticado (ej. `ngrok` con verificación, un VPN, o un SSH tunnel) — no exponer el puerto del probe directamente. Esto es una limitación real, no una decisión de diseño: quedó así porque el MVP asume confianza total dentro de la misma red/máquina, y no se construyó ningún mecanismo de credenciales todavía.

Vectora → cliente es siempre Vectora quien inicia la conexión (`fetch` desde `orchestrator.ts` y `casosDeUso.ts` hacia el `probeUrl` que el usuario ingresó). El cliente nunca llama a Vectora.

## 6. Manejo de errores

Hay dos niveles distintos, y se comportan distinto:

**Nivel caso×modelo (uno de los ~150 pares):**
- Si `fn` tira una excepción, `probe.ejecutar()` la atrapa (`probe.ts:82-88`) y responde `{ ok: false, error: <mensaje> }` con status HTTP 422.
- Si el sistema del cliente no responde dentro de 60 segundos, el orquestador aborta esa llamada puntual con un timeout (`orchestrator.ts::llamarProbe`, `AbortController` + `TIMEOUT_PROBE_MS = 60_000`) y la trata igual que cualquier otro error.
- En cualquiera de los dos casos, el orquestador **no aborta la corrida**: guarda un `ResultadoModelo` con la respuesta `[error] <mensaje>`, costo 0, y un score bajo (`scorePromedio: 0` / `confianzaJuez: 0.15` para RAG, `scoreEstructural: 0` para extracción/clasificación) — así ese caso queda visible como fallido en el reporte, en vez de desaparecer o tirar abajo toda la evaluación.
- No hay reintentos automáticos. Un timeout o error puntual se guarda como tal, no se reintenta ni una vez.

**Nivel corrida completa:**
- Si algo dentro del loop de ejecución tira una excepción que *no* está contemplada (ej. un bug interno, no un error del cliente), el `Promise.all` de `ejecutarCorridaParaGobernanza` rechaza, y el `.catch()` en `iniciarCorrida()` marca la `EvaluacionCorrida` entera como `estado: "error"`. Los `ResultadoModelo` que ya se habían guardado antes de la falla quedan en la base (no se pierden), pero la corrida no sigue y el reporte no se puede generar hasta volver a correrla.
- Si el server de Vectora se reinicia a mitad de una corrida "corriendo", esa corrida queda huérfana: nadie va a seguir llamando al probe del cliente, pero tampoco se marca como error — simplemente el progreso deja de avanzar para siempre. Es una limitación conocida (ver abajo), no un caso manejado.

## 7. Limitaciones conocidas

En orden de qué tan probable es que te muerda esta semana:

1. **No hay forma de detectar si el cliente ignora el parámetro `modelo`.** Ver sección 3. Si el reporte muestra a todos los modelos con métricas casi idénticas, sospecha de esto primero.
2. **Sin autenticación ni HTTPS.** Solo apto para correr en `localhost` o detrás de un túnel de confianza. Ver sección 5.
3. **Sin reconexión si el server de Vectora se reinicia a mitad de una corrida.** La corrida queda huérfana en estado "corriendo" para siempre; hay que volver a lanzarla.
4. **Sin reintentos automáticos** ante timeout o error puntual — un fallo transitorio de red se cuenta como fallo definitivo de ese caso×modelo.
5. **Verificar-conexión prueba con un solo modelo fijo (`gpt-4o-mini`) y un `input` string fijo.** No prueba los modelos que realmente vas a evaluar, y puede dar falso negativo en tareas de extracción/clasificación (ver sección 3).
6. **`ProbeResultado` no se valida contra el contrato en tiempo de ejecución.** Si `fn` devuelve algo con forma distinta a `{ respuesta, contextoRecuperado? }`, no hay error inmediato — el dato raro se propaga hasta el juez/scoring y ahí puede dar resultados sin sentido en vez de un error claro.
7. **Concurrencia fija en 4** (`CONCURRENCIA_MAXIMA` en `orchestrator.ts`), no configurable por caso de uso ni por API. Si el sistema del cliente no aguanta 4 requests simultáneas, hoy no hay forma de bajarla sin editar código.
8. **El juez y el agente generador siguen siendo heurísticas, no modelos reales** (ver `DECISIONS.md` y `CONNECT-REAL-MODELS.md`) — esto no es una limitación de la *conexión* en sí, pero afecta qué tan confiable es el reporte que sale de una corrida contra un sistema real.
