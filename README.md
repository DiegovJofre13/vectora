# Vectora

Plataforma self-service que evalúa qué modelo LLM conviene para cada caso de uso de una empresa — no sobre un dataset estático, sino ejerciendo el sistema real del cliente con distintos modelos, midiendo precisión, latencia y costo.

Ver [DECISIONS.md](./DECISIONS.md) para el detalle de decisiones de arquitectura, y [server/src/engine](./server/src/engine) + [probe/src](./probe/src) para el corazón del sistema.

**¿Vas a conectar un sistema real?** Empieza por [docs/CONECTAR-SISTEMA-REAL.md](./docs/CONECTAR-SISTEMA-REAL.md) (checklist corto) y [docs/COMO-FUNCIONA-LA-CONEXION.md](./docs/COMO-FUNCIONA-LA-CONEXION.md) (cómo funciona por dentro, con las limitaciones dichas sin adornos).

## Estructura del monorepo

```
/probe               SDK @vectora/probe — el cliente lo instala para exponer su sistema a Vectora
/server              Fastify + Prisma (SQLite) — motor de evaluación, catálogo de modelos, API
/client              React + Vite + Tailwind — la UI de Vectora
/examples/cliente-demo   Sistema cliente independiente y real (no un mock) — plantilla para conectar tu sistema
/docs                Cómo funciona la conexión y checklist para conectar un sistema real
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

## Conectar un sistema real hoy

`examples/cliente-demo/` es un sistema cliente independiente y real (no un mock del motor): un bot RAG con 10 documentos markdown y `@vectora/probe` de verdad, pensado como plantilla.

```bash
npm run dev:cliente-demo                       # levanta en :4600, respuestas con un stub local
OPENAI_API_KEY=sk-... npm run dev:cliente-demo # gpt-4o y gpt-4o-mini responden con OpenAI real
```

Ver [examples/cliente-demo/README.md](./examples/cliente-demo/README.md) para conectarlo a Vectora y qué archivo reemplazar para pasar a tu propio sistema.

## Probar el flujo completo (Módulos 1 y 2)

Con `npm run dev` corriendo (server + client + fixtures demo):

1. Abre [http://localhost:5173](http://localhost:5173) → "+ Nuevo caso de uso".
2. Paso 1: completa nombre/descripción/tipo de tarea/dominio.
3. Paso 2: conecta `http://localhost:4501` (bot de soporte demo) o `http://localhost:4502` (fraude demo) según el tipo elegido, usa "Usar KB de ejemplo" (o "Usar ejemplos de muestra" si es extracción/clasificación) para no tener que escribir insumos a mano, y elige al menos 2 modelos.
4. Paso 3: confirma el costo estimado y corre — vas a ver progreso en vivo por modelo, y un link para ver el set de casos generado sin esperar a que termine.
5. Reporte: veredicto, tabla comparativa, y la frontera de Pareto costo-vs-precisión.
6. "Ver detalle de los casos y cada respuesta →": el set completo (pregunta, dificultad, de qué documento del KB salió) con acordeón por caso — al expandir, la respuesta de cada modelo lado a lado con el veredicto del juez (pasó/falló), sus scores y su razonamiento en texto. Filtros: algún modelo falló / baja confianza del juez / los modelos discrepan.

## Probar calibración y gobernanza (Módulos 3 y 4)

1. Pestaña "Calibrar el juez": la cola muestra los resultados con confianza < 65% (6 en el seed) — pregunta, contexto, respuesta del sistema, veredicto y nivel de duda. "Es correcta" o "Corregir" (con textarea) persisten la calibración y suben el contador de acuerdo juez-experto.
2. Pestaña "Gobernanza": tarjetas de gasto/ahorro/casos activos, tabla de casos en producción con estado derivado (óptimo / cambio sugerido / evaluación vieja), e historial de eventos.
3. "Simular modelo nuevo" (habilitado solo en casos con sistema conectado, ej. "Bot de soporte") re-corre de verdad las ~30 preguntas guardadas contra el probe con un modelo del catálogo que aún no se había evaluado — toma ~1 minuto real y alerta solo si la recomendación cambia.

## Pasar a modelos reales

Ver [CONNECT-REAL-MODELS.md](./CONNECT-REAL-MODELS.md) — explica exactamente qué tocar (y qué NO hay que tocar) para que un cliente evalúe con Bedrock/OpenAI/Anthropic/Google reales en vez del motor Mock. Spoiler: en el caso común, no hay que tocar nada de Vectora.

## Estado del proyecto

**Las 4 fases del plan original completas**, más una fase de foco reducido en lo que valida la hipótesis de valor: monorepo, SDK `@vectora/probe` (register/wrap funcionales, con timeout), motor Mock de modelos, Fastify + Prisma + SQLite, seed de "Fintech Andina". Motor de evaluación real (agente generador con trazabilidad al KB, scoring dual, orquestador con rate limiting, estimador de costo, reporte con veredicto + Pareto). Calibración del juez, gobernanza con alertas por evento reales, export PDF, onboarding desde base vacía. Documentación honesta de cómo funciona la conexión y sus límites, un ejemplo de cliente independiente conectable con modelos reales hoy, y una vista de detalle caso por caso (trazabilidad, respuesta de cada modelo, veredicto y razonamiento del juez, filtros). Todo probado de punta a punta en navegador real (Chromium vía Playwright ad hoc), no solo con curl.
