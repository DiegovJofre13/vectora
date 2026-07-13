# Conectar un sistema real — checklist

Guía corta y concreta. Para el detalle de cómo funciona por dentro, ver `docs/COMO-FUNCIONA-LA-CONEXION.md`. Para un ejemplo andando, ver `examples/cliente-demo/`.

## 1. Instalar el SDK

En el proyecto del sistema que querés evaluar:

```bash
npm install @vectora/probe
```

(Si tu sistema vive dentro de este monorepo como workspace, ya lo tenés disponible sin instalar nada — es el caso de `examples/cliente-demo`.)

## 2. Declarar `register`

Tu función de entrada recibe `(input, ctx)` y debe devolver `{ respuesta, contextoRecuperado? }`. Elegí el patrón según tu sistema:

- **Patrón A — bot RAG** (tenés retrieval propio): `contextoRecuperado` es obligatorio en la práctica — sin él, el juez no puede medir groundedness. Ver `examples/cliente-demo/src/index.ts`.
- **Patrón B — extracción/clasificación** (input es un documento existente, no una pregunta): no hay retrieval, `contextoRecuperado` se omite.
- **Patrón C — tu sistema vive detrás de tu propia API HTTP**: usá `probe.modeloActual(ctx)` para saber qué modelo mandarle a tu API, en vez de `wrap` directo sobre la llamada al LLM.

Los tres patrones completos, con código, están en el paso 2 del stepper de Vectora (snippets copiables) y en `client/src/components/stepper/SnippetProbe.tsx`.

## 3. Declarar `wrap` en el punto exacto de la llamada al modelo

```typescript
const respuesta = await probe.wrap(ctx, (modelo) =>
  miClienteLLM.completar({ modelo, prompt })
);
```

Chequeo crítico: **tu `miClienteLLM.completar` tiene que usar de verdad el parámetro `modelo`** para decidir a qué proveedor/modelo llamar. Si lo ignora (modelo hardcodeado), Vectora no lo detecta solo — el síntoma es que el reporte final muestra a todos los modelos del panel con métricas casi idénticas. Ver `docs/COMO-FUNCIONA-LA-CONEXION.md` § 3.

## 4. Arrancar tu sistema

Tu proceso, corriendo. `probe.register(fn)` levanta un servidor HTTP local automáticamente (puerto 4500 por default, o el que pongas en `VECTORA_PROBE_PORT` / `crearProbe({ puerto })`). Anotá esa URL — la vas a necesitar en el paso siguiente.

## 5. Verificar la conexión ANTES de correr una evaluación completa

Esto ya existe, no hay que construir nada:

**Desde la UI de Vectora** — paso 2 del stepper, campo "Conecta tu sistema" → pegá la URL (ej. `http://localhost:4600`) → botón "Verificar conexión". Internamente pega `GET /probe/salud` y después un `POST /probe/ejecutar` de prueba (con `modelo: "gpt-4o-mini"` fijo — ver limitación en `COMO-FUNCIONA-LA-CONEXION.md` § 3) — no gasta ningún crédito ni corre los 30 casos.

**Desde la terminal**, si querés confirmar antes de siquiera abrir la UI:

```bash
curl http://localhost:4600/probe/salud
# {"ok":true,"registrado":true,"version":"0.1.0"}

curl -X POST http://localhost:4600/probe/ejecutar \
  -H 'content-type: application/json' \
  -d '{"input":"una pregunta de prueba","modelo":"gpt-4o-mini"}'
# {"ok":true,"latenciaMs":..., "respuesta":"...", "contextoRecuperado":[...]}
```

Si `registrado` da `false`, tu proceso arrancó pero nunca llamó `probe.register(fn)`. Si el `curl` a `/probe/ejecutar` da `{"ok":false,"error":...}`, el error viene de adentro de tu función registrada — el mensaje es literalmente lo que tiró tu excepción.

## 6. API keys de modelos

Van en **tu** proceso (variables de entorno de tu sistema, ej. `OPENAI_API_KEY`), nunca en Vectora. El server de Vectora no pide ni almacena ninguna credencial de proveedor de modelos — solo conoce la URL de tu probe. Ver `examples/cliente-demo/src/llm.ts` para un ejemplo funcional con OpenAI real.

## 7. Recién ahí, correr una evaluación

Paso 3 del stepper: confirmás el costo estimado y corrés. Cada caso × cada modelo del panel es un `POST /probe/ejecutar` real a tu sistema, con hasta 4 en simultáneo.

## Antes de conectar algo que no corre en tu misma máquina

No hay autenticación entre Vectora y el probe del cliente (ver `COMO-FUNCIONA-LA-CONEXION.md` § 5). Si tu sistema corre en otra máquina o en la nube, no expongas el puerto del probe directamente a internet — usá un túnel autenticado (ngrok, VPN, SSH tunnel) y apuntá "Conectar sistema" a esa URL en vez de a la IP/puerto directo.
