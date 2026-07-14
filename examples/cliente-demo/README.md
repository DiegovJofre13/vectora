# cliente-demo-fintech

Un sistema "cliente" independiente y realista — no un mock del motor de Vectora — que usa `@vectora/probe` de verdad. Es un bot RAG mínimo: 10 documentos markdown de una fintech chilena ficticia ("Maipo Pagos"), retrieval por palabras clave, y una llamada al modelo vía `probe.completar()` — el gateway de Vectora.

El objetivo de este ejemplo es doble: (1) que puedas conectar *algo* real a Vectora hoy sin escribir código, y (2) que sirva de plantilla para ver exactamente qué reemplazar cuando conectes tu propio sistema.

## Levantarlo

Desde la raíz del monorepo (una vez corrido `npm install` ahí):

```bash
npm run dev:cliente-demo
```

Esto levanta el sistema en `http://localhost:4600` (puerto fijado en el script `dev` de `package.json`, vía `VECTORA_PROBE_PORT=4600`). Vas a ver en la consola cuántos documentos cargó el KB y si está usando el gateway de Vectora o el stub local.

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

## Usar modelos reales: el gateway de Vectora

**Este es el único camino soportado para llamar a un modelo real** — no hay una opción con tu propia API key de proveedor (ver por qué en `docs/COMO-FUNCIONA-LA-CONEXION.md` § 5: así los costos quedan gobernados y visibles del lado de Vectora, no dispersos en las cuentas de cada cliente).

```bash
VECTORA_API_KEY=vec_live_... npm run dev:cliente-demo
```

Con esto, cada llamada al modelo pasa por `probe.completar()`: Vectora llama de verdad a OpenAI con su propia key, y te descuenta créditos (costo real + margen) de tu organización. Sacá tu `VECTORA_API_KEY` desde la pestaña "Gobernanza" de la UI de Vectora (sección Créditos) — ahí también cargás saldo (simulado, sin pago real).

Si no configurás `VECTORA_API_KEY`, todo cae a un stub local (ver `src/llm.ts`) — sin costo, sin llamadas reales — para que el ejemplo funcione igual sin ninguna configuración.

## Qué cambiar para conectar tu sistema real (la parte que más importa)

Este ejemplo tiene 2 archivos relevantes en `src/`. Un cliente real reemplaza cada uno con distinto nivel de esfuerzo:

| Archivo | Qué hace acá | Qué cambia un cliente real |
|---|---|---|
| `src/retrieval.ts` | Lee `kb/*.md` del disco y busca por palabras clave | Reemplazar por su vector store o motor de búsqueda real. La firma que importa es `buscarEnKb(pregunta, k): DocumentoKb[]` — mientras devuelva algo con `titulo`/`contenido`, el resto no se entera del cambio. |
| `src/index.ts` | Declara `probe.register`, y llama `probe.completar()` con la key de Vectora (o cae al stub de `llm.ts` sin ella) | Casi no cambia. Si su tarea no es RAG (ej. extracción de un documento existente), cambia la forma del `input` y agrega `formato: "json"` en `completar()` — ver `docs/CONECTAR-SISTEMA-REAL.md` en la raíz del repo para los 3 patrones. |

En concreto, para pasar de este ejemplo a su sistema:

1. Copien esta carpeta (o solo la estructura) a su propio repo.
2. `npm install @vectora/probe` en su proyecto (dejará de ser un workspace del monorepo de Vectora).
3. Reemplacen `src/retrieval.ts` por su retrieval real, o bórrenlo si su tarea no hace retrieval (extracción/clasificación sobre documentos existentes — ver Patrón B en `docs/CONECTAR-SISTEMA-REAL.md`).
4. Consigan su `VECTORA_API_KEY` desde la UI de Vectora y configúrenla como variable de entorno. No necesitan ninguna API key de proveedor de modelos.
5. Corran su sistema, y en la UI de Vectora apunten "Conectar sistema" a la URL donde quedó escuchando.
