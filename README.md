# Vectora

Plataforma self-service que evalúa qué modelo LLM conviene para cada caso de uso de una empresa — no sobre un dataset estático, sino ejerciendo el sistema real del cliente con distintos modelos, midiendo precisión, latencia y costo.

Ver [DECISIONS.md](./DECISIONS.md) para el detalle de decisiones de arquitectura, y [server/src/engine](./server/src/engine) + [probe/src](./probe/src) para el corazón del sistema.

## Estructura del monorepo

```
/probe    SDK @vectora/probe — el cliente lo instala para exponer su sistema a Vectora
/server   Fastify + Prisma (SQLite) — motor de evaluación, catálogo de modelos, API
/client   React + Vite + Tailwind — la UI de Vectora
```

## Requisitos (macOS)

- **Node.js 20+** y **npm**.
- **git** (para clonar/versionar el repo).

> Si tu Mac no tiene Homebrew ni las Xcode Command Line Tools instaladas (por lo tanto tampoco `git`), corre `xcode-select --install` y sigue el instalador gráfico, o instala [Homebrew](https://brew.sh) primero (`brew install git node`). Si necesitas Node ya mismo sin depender de Homebrew, puedes usar el binario portable oficial:
> ```bash
> curl -sSL https://nodejs.org/dist/v22.13.1/node-v22.13.1-darwin-arm64.tar.gz -o /tmp/node.tar.gz
> mkdir -p ~/.local/tools && tar -xzf /tmp/node.tar.gz -C ~/.local/tools && mv ~/.local/tools/node-v22.13.1-darwin-arm64 ~/.local/tools/node
> export PATH="$HOME/.local/tools/node/bin:$PATH"   # agrégalo a tu ~/.zshrc para que persista
> ```
> (para Mac Intel, cambia `darwin-arm64` por `darwin-x64`)

## Levantar todo (primera vez)

```bash
npm run setup   # instala dependencias, compila el SDK, aplica el schema y siembra "Fintech Andina"
npm run dev     # levanta server (4310), client (5173), y los 2 fixtures demo (4501, 4502)
```

Abre [http://localhost:5173](http://localhost:5173) — deberías ver los 5 casos de uso de "Fintech Andina" cargados desde el server.

### Qué corre en `npm run dev`

| Proceso | Puerto | Qué es |
|---|---|---|
| `server` | 4310 | API de Vectora (Fastify + Prisma) |
| `client` | 5173 | UI de Vectora (Vite dev server) |
| `demo-bot` | 4501 | Fixture: bot de soporte de Fintech Andina, patrón A (RAG), usa `@vectora/probe` real |
| `demo-fraude` | 4502 | Fixture: detección de fraude de Fintech Andina, patrón B (clasificación), usa `@vectora/probe` real |

Los fixtures demo son la prueba de que el SDK funciona de punta a punta: son sistemas reales corriendo en procesos propios, no simulaciones dentro del server.

## Comandos sueltos

```bash
npm run dev:server        # solo el server
npm run dev:client        # solo el client
npm run dev:demo-bot      # solo el fixture del bot de soporte
npm run dev:demo-fraude   # solo el fixture de detección de fraude

npm run db:push           # aplica server/prisma/schema.prisma a la DB (sin migración con nombre)
npm run db:seed           # re-siembra "Fintech Andina" (borra y recrea sus datos)
npm run build             # compila @vectora/probe y @vectora/server a JS
```

## Probar el SDK a mano

Con `demo-bot` corriendo (`npm run dev:demo-bot`):

```bash
curl http://localhost:4501/probe/salud

curl -X POST http://localhost:4501/probe/ejecutar \
  -H 'content-type: application/json' \
  -d '{"input":"¿Cuánto demora la reposición de una tarjeta robada?","modelo":"gpt-4o-mini"}'
```

Cambia `"modelo"` por cualquier id del catálogo (`gpt-4o`, `claude-3-5-sonnet`, `gemini-1-5-flash`, `gpt-4o-mini`, `llama-3-1-70b`, ver `server/src/engine/modelCatalog.ts`) y compara: el `contextoRecuperado` es idéntico entre corridas — solo cambia el modelo y, con él, la respuesta y la latencia.

## Probar el flujo completo (Módulos 1 y 2)

Con `npm run dev` corriendo (server + client + fixtures demo):

1. Abre [http://localhost:5173](http://localhost:5173) → "+ Nuevo caso de uso".
2. Paso 1: completa nombre/descripción/tipo de tarea/dominio.
3. Paso 2: conecta `http://localhost:4501` (bot de soporte demo) o `http://localhost:4502` (fraude demo) según el tipo elegido, usa "Usar KB de ejemplo" (o "Usar ejemplos de muestra" si es extracción/clasificación) para no tener que escribir insumos a mano, y elige al menos 2 modelos.
4. Paso 3: confirma el costo estimado y corre — vas a ver progreso en vivo por modelo.
5. Reporte: veredicto, tabla comparativa, y la frontera de Pareto costo-vs-precisión.

## Estado del proyecto

**Fase 1 (esqueleto) y Fase 2 (Módulos 1 y 2) completas**: monorepo, SDK `@vectora/probe` (register/wrap funcionales), motor Mock de modelos, Fastify + Prisma + SQLite, seed de "Fintech Andina" (5 casos de uso, historial de evaluación, 200 correcciones de juicio calibradas). Motor de evaluación real: agente generador de preguntas desde KB, scoring dual (estructural + juez), orquestador con rate limiting, estimador de costo, y reporte con veredicto + Pareto. UI del stepper de conexión y del reporte, probados de punta a punta en navegador real.

Pendiente (ver DECISIONS.md § Próximas fases): Módulos 3-4 (calibración del juez + gobernanza), export PDF real y `CONNECT-REAL-MODELS.md`.
