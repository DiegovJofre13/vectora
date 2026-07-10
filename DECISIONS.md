# Decisiones de diseño

Registro vivo de decisiones técnicas de Vectora, en orden cronológico por fase. El objetivo es que cualquiera pueda entender *por qué* está construido así sin tener que preguntar.

## Fase 1 — Esqueleto

### Entorno de desarrollo (bloqueante, resuelto)
La máquina no tenía Node, npm, Homebrew ni git instalados, y tampoco las Xcode Command Line Tools (que proveen git en macOS). Sin Homebrew no hay forma de instalar nada vía brew, y git requiere el instalador gráfico de CLT (que pide clic humano) o una contraseña sudo que el agente no puede ingresar.

Se resolvió así:
- **Node.js**: se descargó el binario portable oficial (`node-v22.13.1-darwin-arm64.tar.gz` desde nodejs.org) a `~/.local/tools/node`, sin necesidad de Homebrew ni Xcode CLT (los binarios de Node no requieren compilación nativa). Se debe anteponer `~/.local/tools/node/bin` al `PATH` para usar `node`/`npm`/`npx`.
- **git**: se disparó `xcode-select --install` para que el usuario complete la instalación gráfica en paralelo mientras se avanzaba con el resto del trabajo. `git init` y el primer commit quedan pendientes hasta que la instalación termine.
- El **README** documenta ambos pasos para que cualquier otra máquina en el mismo estado pueda replicar el setup sin fricción.

### Monorepo con npm workspaces (no pnpm/yarn)
Se eligió `npm workspaces` porque ya viene con Node (no depende de instalar un gestor de paquetes adicional, relevante dado el punto anterior) y alcanza para 3 paquetes (`probe`, `server`, `client`). Si el proyecto crece mucho se puede migrar a pnpm sin drama.

### `@vectora/probe`: transporte HTTP local, no invocación in-process
El SDK necesita que Vectora (un proceso separado, potencialmente en otra máquina) pueda invocar la función registrada por el cliente. Se decidió que `probe.register(fn)` levanta automáticamente un servidor HTTP local (`GET /probe/salud`, `POST /probe/ejecutar`) en vez de exponer solo una API in-process.

**Por qué:** reflejar la arquitectura real del producto — el cliente instala el SDK dentro de *su* proceso, que corre en *su* infraestructura, y Vectora le pega por red. Esto es válido para los 3 patrones (A, B, C) por igual: en C el cliente igual expone su función registrada vía el probe aunque internamente llame a su propia API HTTP. Mantiene al SDK con cero dependencias (usa `node:http`, no Express/Fastify) porque es una pieza que vive en infraestructura ajena y debe ser lo más liviana y auditable posible.

El paso "conectar sistema" del Módulo 1 (Fase 2) le pedirá al usuario la URL del probe (`http://localhost:4501` en el caso demo) y hará un `GET /probe/salud` + un `POST /probe/ejecutar` de prueba antes de continuar.

### `wrap` solo mide latencia; el costo se estima server-side
`probe.wrap(ctx, llamadaModelo)` no intenta capturar tokens de entrada/salida, porque la forma de la respuesta del cliente es arbitraria (`string | Record<string, unknown>`) y no se le puede forzar un contrato de métricas de uso sin romper la simplicidad del SDK. En cambio:
- `wrap` mide latencia real (wall-clock) alrededor de la llamada al modelo, que es información que el SDK sí puede observar sin cooperación del cliente.
- El costo se estima en el servidor con una heurística de caracteres (`(chars_entrada + chars_salida) / 4 ≈ tokens`) multiplicada por el precio del catálogo. Es una aproximación razonable para el MVP; **CONNECT-REAL-MODELS.md** (Fase 4) explicará cómo reemplazarla por el conteo de tokens real que devuelven las APIs de los proveedores.

### Catálogo de modelos en archivo, no en DB
`server/src/engine/modelCatalog.ts` es un array estático (5 modelos: 1 frontera, 2 intermedios, 1 barato, 1 open-weights). Es el mismo panel para todas las organizaciones y cambia por despliegue de Vectora, no por cliente — no amerita una tabla. Si a futuro el panel se vuelve configurable por cliente, se migra a DB en ese momento.

### `sugerirModelos(casoDeUso)` aislada como único punto de reemplazo
`server/src/engine/suggestModels.ts` es hoy una heurística basada en regex sobre nombre/descripción (alto riesgo → incluye frontera; alto volumen → baratos + open). Se aisló deliberadamente como la única función que conoce la lógica de sugerencia, para que el día que sea data-driven (entrenada sobre qué modelo ganó históricamente) el reemplazo sea quirúrgico: misma firma, mismo call site, cero cambios en la UI ni en el resto del motor.

### `requiereGeneradorParaTipo` y `estrategiaScoringParaTipo` como fuente única de verdad
`server/src/engine/taskTypes.ts` centraliza la distinción "¿el caso trae su input o hay que generarlo?" y qué estrategia de scoring le corresponde a cada tipo de tarea. Tanto el seed como (en Fase 2) la API de creación de casos de uso llaman a estas funciones — así el criterio no se duplica ni diverge entre el seed y el motor real.

### Motor Mock: la única pieza mockeada
`server/src/engine/mockModelEngine.ts` reemplaza la llamada cara a un modelo real. Simula latencia realista (con jitter ±20% sobre la latencia base del catálogo) y una probabilidad de "acierto" (`calidadBase` del catálogo) que decide si la respuesta sintetizada está bien anclada al contexto o degradada — así el juez y el scoring estructural (Fase 2) tienen señal real que detectar, no un mock plano que siempre "sale bien". Todo lo demás (SDK, ganchos, HTTP) opera de verdad.

### Prisma sin `enum`, para portabilidad a Postgres
El conector `sqlite` de Prisma no soporta `enum` nativo. Como el proyecto está pensado para migrar a Postgres, todos los campos "tipo" (`tipoTarea`, `estado`, `tier` en el catálogo, etc.) son `String` validados en la capa de aplicación, no `enum` de Prisma. Esto hace que el cambio de `datasource` a Postgres sea un cambio de una línea, sin tocar el schema de modelos.

### Nombres de campo de `CorreccionJuicio`
El contrato pedido especifica campos en inglés (`useCase, domain, question, context, systemAnswer, provisionalExpected, judgeVerdict, humanVerdict, confidence, timestamp`). El resto del schema está en español (consistente con el resto del producto). Se mapeó 1:1: `useCase→casoDeUsoId` (FK, en vez de duplicar el string), `domain→dominio`, y el resto se dejó tal cual porque son datos de texto libre sin equivalente de dominio claro en español que no sea una traducción literal. Se agregó `correctedAnswer` (no pedido explícitamente) para separar "corrigió el texto" de solo marcar `humanVerdict = "corregida"` sin perder el texto corregido — necesario para que el dato sirva a fine-tuning futuro.

### Seed "Fintech Andina": generado sin pasar por el motor Mock en vivo
El seed (`server/prisma/seed.ts` + `seedData.ts`) sintetiza directamente filas de Prisma con un RNG de semilla fija (`mulberry32`), en vez de invocar el motor Mock real (que usa `setTimeout` reales para simular latencia). Poblar ~275 `ResultadoModelo` + 200 `CorreccionJuicio` a través de llamadas HTTP reales habría tomado minutos y sido no-determinista; el seed necesita ser instantáneo y reproducible. La lógica de síntesis de scores/latencia/costo en `seedData.ts` es deliberadamente independiente del motor Mock real — están calibradas para verse consistentes, pero no comparten código, porque uno sirve para *demostrar* datos históricos plausibles y el otro para *ejecutar* evaluaciones nuevas de verdad.

Volumen sembrado: 5 casos de uso, 5 corridas de evaluación, 55 casos de prueba, 275 resultados por modelo, 200 correcciones de juicio calibradas, 6 resultados con confianza < 0.65 (cola pendiente de calibración del Módulo 3), 4 eventos de gobernanza, 5 movimientos de crédito.

### Fixtures demo como sistemas reales, no simulados en el motor
`server/src/demo/fintechAndinaBot.ts` (patrón A, RAG) y `fintechAndinaFraude.ts` (patrón B, clasificación) son programas reales que usan `@vectora/probe` de verdad — se levantan como procesos propios (`npm run dev:demo-bot` / `dev:demo-fraude`) y exponen su servidor HTTP en los puertos 4501/4502. Esto prueba el contrato end-to-end (register → wrap → intercambio de modelo → HTTP) sin atajos, y le da al onboarding un ejemplo real y corriendo contra el cual apuntar el paso "conectar sistema" en Fase 2.

### Tailwind v3 (no v4) para el client
Se usó la configuración clásica de Tailwind v3 (`tailwind.config.js` + PostCSS) en vez de v4 (que elimina el archivo de config a favor de CSS-first). La razón es pragmática: v3 permite declarar la paleta de marca completa (`fondo`, `superficie`, `linea`, `tinta`, `marca`, `ambar`, `coral`, `azul`, `violeta`) como tokens de Tailwind de forma más explícita y documentada, y es la versión con la que hay más certeza de compatibilidad estable hoy.

### Vulnerabilidad conocida y aceptada: esbuild/vite (dev-only)
`npm audit` reporta una vulnerabilidad moderada en `esbuild <=0.24.2` (usado por Vite 5): un sitio malicioso podría enviar requests al dev server y leer la respuesta. Solo afecta al servidor de desarrollo local (no a builds de producción) y arreglarla requiere saltar a Vite 8 (breaking change no evaluado). Se deja pendiente para revisar en Fase 4 (pulido), no se ignora silenciosamente.

## Próximas fases
- **Fase 2**: Módulos 1 y 2 (stepper de conexión, agente generador de preguntas desde el KB, scoring dual estructural/juez, reporte con Pareto).
- **Fase 3**: Módulos 3 y 4 (calibración del juez, ledger de gobernanza, alertas por evento).
- **Fase 4**: export PDF, estados vacíos/errores, `CONNECT-REAL-MODELS.md`.
