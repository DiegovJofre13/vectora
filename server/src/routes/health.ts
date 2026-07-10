import type { FastifyInstance } from "fastify";
import { db } from "../lib/db.js";

export async function registrarRutasSalud(app: FastifyInstance): Promise<void> {
  app.get("/api/salud", async () => {
    const organizaciones = await db.organizacion.count();
    return { ok: true, organizaciones, version: "0.1.0" };
  });
}
