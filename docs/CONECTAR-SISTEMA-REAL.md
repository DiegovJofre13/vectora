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
- **Patrón B — extracción/clasificación** (input es un documento existente, no una pregunta): no hay retrieval, `contextoRecuperado` se omite, y `completar()` se llama con `formato: "json"`.
- **Patrón C — tu sistema vive detrás de tu propia API HTTP**: usá `probe.modeloActual(ctx)` para saber qué modelo mandarle a tu API — tu backend, en el punto donde llama al modelo, debería llamar al gateway de Vectora (ver paso 3).

Los tres patrones completos, con código, están en el paso 2 del stepper de Vectora (snippets copiables) y en `client/src/components/stepper/SnippetProbe.tsx`.

### Opcional: exponer tu knowledge base para carga automática (Patrón A)

Si tu sistema hace RAG (Patrón A), podés llamar a `probe.exponerKb(docs)` con tus documentos reales (`{ id?, titulo, contenido }[]`) — Vectora los va a poder traer automáticamente en el paso "Conecta tu sistema" de la UI (botón "Cargar automáticamente desde tu sistema"), en vez de que alguien los pegue a mano. Es enteramente opcional: sin esto, la carga sigue siendo manual (pegar texto o subir archivos .md/.txt) — ver `examples/cliente-demo/src/index.ts` para un ejemplo real (`probe.exponerKb(todosLosDocumentos())`).

```typescript
probe.register(responderConsulta);
probe.exponerKb(misDocumentosReales); // opcional
```

## 3. Declarar `completar` en el punto exacto de la llamada al modelo

El único camino soportado: Vectora hace la llamada real al proveedor y te cobra créditos (costo real + margen). No necesitás ninguna API key de proveedor de modelos.

```typescript
const { texto } = await probe.completar(ctx, { prompt });
```

Para extracción/clasificación (Patrón B), pedile JSON al modelo:

```typescript
const { texto } = await probe.completar(ctx, { prompt, formato: "json" });
const datos = JSON.parse(texto);
```

Requiere pasar tu `apiKey` de Vectora al crear el probe (`crearProbe({ apiKey })` o env var `VECTORA_API_KEY`) — la sacás de la pestaña Gobernanza → Créditos en la UI. Ver `docs/COMO-FUNCIONA-LA-CONEXION.md` § 5. Solo modelos de OpenAI por ahora.

*(El SDK todavía tiene `probe.wrap()`, que le pasaría el modelo a un callback tuyo con tu propia key — pero eso no es un camino soportado ni documentado para sistemas reales. Ver `docs/COMO-FUNCIONA-LA-CONEXION.md` § 2 y § 5 para el porqué.)*

## 4. Arrancar tu sistema

Tu proceso, corriendo. `probe.register(fn)` levanta un servidor HTTP local automáticamente (puerto 4500 por default, o el que pongas en `VECTORA_PROBE_PORT` / `crearProbe({ puerto })`). Anotá esa URL — la vas a necesitar en el paso siguiente.

## 5. Verificar la conexión ANTES de correr una evaluación completa

Esto ya existe, no hay que construir nada:

**Desde la UI de Vectora** — paso 2 del stepper, campo "Conecta tu sistema" → pegá la URL (ej. `http://localhost:4600`) → botón "Verificar conexión". Internamente pega `GET /probe/salud` y después un `POST /probe/ejecutar` de prueba (con `modelo: "gpt-4o-mini"` fijo — ver limitación en `COMO-FUNCIONA-LA-CONEXION.md` § 3) — no gasta ningún crédito ni corre los 30 casos.

**Desde la terminal**, si querés confirmar antes de siquiera abrir la UI:

```bash
curl http://localhost:4600/probe/salud
# {"ok":true,"registrado":true,"version":"0.1.0","tieneKb":true}

curl -X POST http://localhost:4600/probe/ejecutar \
  -H 'content-type: application/json' \
  -d '{"input":"una pregunta de prueba","modelo":"gpt-4o-mini"}'
# {"ok":true,"latenciaMs":..., "respuesta":"...", "contextoRecuperado":[...]}

curl http://localhost:4600/probe/kb
# {"ok":true,"docs":[{"id":"01-onboarding","titulo":"...","contenido":"..."}, ...]}
```

Si `registrado` da `false`, tu proceso arrancó pero nunca llamó `probe.register(fn)`. Si el `curl` a `/probe/ejecutar` da `{"ok":false,"error":...}`, el error viene de adentro de tu función registrada — el mensaje es literalmente lo que tiró tu excepción. `tieneKb` en `/probe/salud` (y `GET /probe/kb`) solo existen si llamaste a `probe.exponerKb()` — ver la sección opcional del paso 2.

## 6. API keys

Tu `apiKey` de Vectora (`vec_live_...`) va en tu proceso, como env var `VECTORA_API_KEY` — identifica a tu organización para cobrarle créditos, no da acceso a nada de Vectora más allá de `POST /api/gateway/completar`. No necesitás ninguna API key de proveedor de modelos (OpenAI, Anthropic, etc.) en tu sistema. Cargá créditos primero (Gobernanza → Créditos → "Cargar créditos") o la corrida se bloquea por saldo insuficiente.

## 7. Recién ahí, correr una evaluación

Paso 3 del stepper: confirmás el costo estimado y corrés. Cada caso × cada modelo del panel es un `POST /probe/ejecutar` real a tu sistema, con hasta 4 en simultáneo, y cada llamada al modelo (vía `completar()`) te descuenta créditos en tiempo real — si el saldo llega a cero a mitad de la corrida, esos casos puntuales van a fallar (quedan marcados como error en el reporte, no frenan el resto).

## Antes de conectar algo que no corre en tu misma máquina

No hay autenticación entre Vectora y el probe del cliente (ver `COMO-FUNCIONA-LA-CONEXION.md` § 6). Si tu sistema corre en otra máquina o en la nube, no expongas el puerto del probe directamente a internet — usá un túnel autenticado (ngrok, VPN, SSH tunnel) y apuntá "Conectar sistema" a esa URL en vez de a la IP/puerto directo.
