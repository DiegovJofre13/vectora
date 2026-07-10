import Fastify from "fastify";
import cors from "@fastify/cors";
import { registrarRutasSalud } from "./routes/health.js";
import { registrarRutasCatalogo } from "./routes/catalogo.js";
import { registrarRutasCasosDeUso } from "./routes/casosDeUso.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

await registrarRutasSalud(app);
await registrarRutasCatalogo(app);
await registrarRutasCasosDeUso(app);

const puerto = Number(process.env["PORT"] ?? 4310);
app
  .listen({ port: puerto, host: "0.0.0.0" })
  .then(() => app.log.info(`Vectora server escuchando en http://localhost:${puerto}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
