import type { FastifyInstance } from "fastify";
import { db } from "../lib/db.js";

export async function registrarRutasOrganizaciones(app: FastifyInstance): Promise<void> {
  app.get("/api/organizaciones", async () => {
    const organizaciones = await db.organizacion.findMany({ orderBy: { createdAt: "asc" } });
    return { organizaciones };
  });
}
