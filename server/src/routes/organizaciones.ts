import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";

const crearOrganizacionSchema = z.object({ nombre: z.string().min(1) });

export async function registrarRutasOrganizaciones(app: FastifyInstance): Promise<void> {
  app.get("/api/organizaciones", async () => {
    const organizaciones = await db.organizacion.findMany({ orderBy: { createdAt: "asc" } });
    return { organizaciones };
  });

  // Habilita el onboarding vacío real: un cliente nuevo, sin ningún dato sembrado,
  // puede crear su propia organización antes de conectar su primer caso de uso.
  app.post("/api/organizaciones", async (req, reply) => {
    const parsed = crearOrganizacionSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    const organizacion = await db.organizacion.create({ data: { nombre: parsed.data.nombre } });
    return { organizacion };
  });
}
