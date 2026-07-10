import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { obtenerPendientesCalibracion, obtenerResumenCalibracion, registrarCalibracion } from "../engine/calibration.js";

const calibrarSchema = z.object({
  humanVerdict: z.enum(["correcta", "corregida"]),
  correctedAnswer: z.string().optional(),
});

export async function registrarRutasCalibracion(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { dominio?: string } }>("/api/calibracion/pendientes", async (req) => {
    const pendientes = await obtenerPendientesCalibracion(req.query.dominio);
    return { pendientes };
  });

  app.get("/api/calibracion/resumen", async () => {
    const resumen = await obtenerResumenCalibracion();
    return { resumen };
  });

  app.post<{ Params: { resultadoModeloId: string } }>("/api/calibracion/:resultadoModeloId", async (req, reply) => {
    const parsed = calibrarSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    try {
      await registrarCalibracion({ resultadoModeloId: req.params.resultadoModeloId, ...parsed.data });
      return { ok: true };
    } catch (err) {
      reply.code(422);
      return { ok: false, error: err instanceof Error ? err.message : "No se pudo registrar la calibración." };
    }
  });
}
