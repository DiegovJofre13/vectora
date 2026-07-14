# cliente-demo-fintech

Un sistema "cliente" independiente y realista — no un mock del motor de Vectora — que usa `@vectora/probe` de verdad. Es un bot RAG mínimo: 10 documentos markdown de una fintech chilena ficticia ("Maipo Pagos"), retrieval por palabras clave, y una llamada al modelo envuelta con `probe.wrap`.

El objetivo de este ejemplo es doble: (1) que puedas conectar *algo* real a Vectora hoy sin escribir código, y (2) que sirva de plantilla para ver exactamente qué reemplazar cuando conectes tu propio sistema.

## Levantarlo

Desde la raíz del monorepo (una vez corrido `npm install` ahí):

```bash
npm run dev:cliente-demo
```

Esto levanta el sistema en `http://localhost:4600` (puerto fijado en el script `dev` de `package.json`, vía `VECTORA_PROBE_PORT=4600`). Vas a ver en la consola cuántos documentos cargó el KB y si hay una API key de OpenAI configurada.

Para correrlo sin watch mode, o en otro puerto:

```bash
VECTORA_PROBE_PORT=4700 npm start
```

## Conectarlo a Vectora

Con el server de Vectora corriendo (`npm run dev` en la raíz, o al menos `npm run dev:server`):

1. En la UI de Vectora, "+ Nuevo caso de uso" → tipo de tarea "RAG" o "Soporte conversacional".
2. Paso 2, "Conecta tu sistema" → `http://localhost:4600` → "Verificar conexión".
3. Deberías ver "✓ Conectado" — eso confirma que Vectora pudo invocar `responderConsulta` de verdad, no un mock.
4. Podés usar el knowledge base real de este ejemplo pegando el contenido de `kb/*.md` en el paso de "Knowledge base" del stepper (o usar "Usar KB de ejemplo", que trae contenido distinto, del fixture interno de Vectora — no son la misma base).

También podés probarlo a mano, sin la UI:

```bash
curl http://localhost:4600/probe/salud

curl -X POST http://localhost:4600/probe/ejecutar \
  -H 'content-type: application/json' \
  -d '{"input":"¿Cuánto demora la reposición de una tarjeta robada?","modelo":"gpt-4o-mini"}'
```

## Qué cambiar para conectar tu sistema real (la parte que más importa)

Este ejemplo tiene 3 archivos en `src/`. Un cliente real reemplaza cada uno con distinto nivel de esfuerzo:

| Archivo | Qué hace acá | Qué cambia un cliente real |
|---|---|---|
| `src/llm.ts` | Llama a OpenAI de verdad si hay `OPENAI_API_KEY`, si no, devuelve un stub local | Solo aplica si usan su propia key (Opción B). Reemplazar por su propio cliente de modelos (su SDK de OpenAI/Bedrock/Anthropic con sus credenciales). Si usan el gateway de Vectora (Opción A), este archivo no hace falta. |
| `src/retrieval.ts` | Lee `kb/*.md` del disco y busca por palabras clave | Reemplazar por su vector store o motor de búsqueda real. La firma que importa es `buscarEnKb(pregunta, k): DocumentoKb[]` — mientras devuelva algo con `titulo`/`contenido`, el resto no se entera del cambio. |
| `src/index.ts` | Declara `probe.register`, y usa `probe.completar()` (gateway) o `probe.wrap()` (key propia) según la env var que encuentre | Casi no cambia. Si su tarea no es RAG (ej. extracción de un documento existente), cambia la forma del `input` — ver `docs/CONECTAR-SISTEMA-REAL.md` en la raíz del repo para los 3 patrones. |

En concreto, para pasar de este ejemplo a su sistema:

1. Copien esta carpeta (o solo la estructura) a su propio repo.
2. `npm install @vectora/probe` en su proyecto (dejará de ser un workspace del monorepo de Vectora).
3. Reemplacen `src/llm.ts` por su cliente de modelos real — mantengan la firma `completar({ modelo, prompt, contexto }): Promise<{ texto: string }>`, o adapten `src/index.ts` si su forma de llamar al modelo es distinta.
4. Reemplacen `src/retrieval.ts` por su retrieval real, o bórrenlo si su tarea no hace retrieval (extracción/clasificación sobre documentos existentes — ver Patrón B en `docs/CONECTAR-SISTEMA-REAL.md`).
5. Corran su sistema, y en la UI de Vectora apunten "Conectar sistema" a la URL donde quedó escuchando.

## Usar modelos reales ahora mismo

Hay dos formas, elegí una (`src/index.ts` decide sola cuál según qué variable de entorno encuentre):

### Opción A — Gateway de Vectora (Vectora paga y te cobra créditos)

```bash
VECTORA_API_KEY=vec_live_... npm run dev:cliente-demo
```

Con esto, cada llamada al modelo pasa por `probe.completar()` en vez de `probe.wrap()`: Vectora llama de verdad a OpenAI con su propia key, y te descuenta créditos (costo real + margen) de tu organización. Vos no necesitás ninguna API key de proveedor. Sacá tu `VECTORA_API_KEY` desde la pestaña "Gobernanza" de la UI de Vectora (sección Créditos).

### Opción B — tu propia API key de OpenAI

```bash
OPENAI_API_KEY=sk-... npm run dev:cliente-demo
```

Los ids de catálogo `gpt-4o` y `gpt-4o-mini` van a llamar de verdad a la API de OpenAI con tu key (ver `src/llm.ts::completarConOpenAI`), vía `probe.wrap`. Los otros 3 ids del catálogo (`claude-3-5-sonnet`, `gemini-1-5-flash`, `llama-3-1-70b`) van a seguir cayendo al stub local — agregar esos proveedores es agregar un `case` más en `src/llm.ts`, mismo patrón que el de OpenAI. **Tu API key vive solo acá, en tu máquina/proceso — nunca se la mandás a Vectora.**

Si no configurás ninguna de las dos, todo cae al stub local (sin costo, sin llamadas reales) para que el ejemplo funcione igual sin configuración.

Ver `docs/COMO-FUNCIONA-LA-CONEXION.md` § "Gateway de Vectora" para el detalle completo de las dos opciones.
