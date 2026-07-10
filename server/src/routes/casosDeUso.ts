import type { FastifyInstance } from "fastify";
import { db } from "../lib/db.js";

export async function registrarRutasCasosDeUso(app: FastifyInstance): Promise<void> {
  app.get("/api/casos-de-uso", async () => {
    const casos = await db.casoDeUso.findMany({
      include: { organizacion: true, evaluaciones: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
    });
    return { casos };
  });

  app.get<{ Params: { id: string } }>("/api/casos-de-uso/:id", async (req, reply) => {
    const caso = await db.casoDeUso.findUnique({
      where: { id: req.params.id },
      include: {
        organizacion: true,
        evaluaciones: { include: { casosPrueba: { include: { resultados: true } } }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!caso) {
      reply.code(404);
      return { ok: false, error: "Caso de uso no encontrado" };
    }
    return { caso };
  });
}
