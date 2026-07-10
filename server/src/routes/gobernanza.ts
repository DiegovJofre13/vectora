import type { FastifyInstance } from "fastify";
import { obtenerHistorialEventos, obtenerLedger, obtenerResumenGobernanza, simularEventoNuevoModelo } from "../engine/governance.js";

export async function registrarRutasGobernanza(app: FastifyInstance): Promise<void> {
  app.get("/api/gobernanza/ledger", async () => {
    const ledger = await obtenerLedger();
    return { ledger };
  });

  app.get("/api/gobernanza/resumen", async () => {
    const resumen = await obtenerResumenGobernanza();
    return { resumen };
  });

  app.get<{ Querystring: { casoDeUsoId?: string } }>("/api/gobernanza/eventos", async (req) => {
    const eventos = await obtenerHistorialEventos(req.query.casoDeUsoId);
    return { eventos };
  });

  app.post<{ Params: { id: string } }>("/api/casos-de-uso/:id/eventos/simular-modelo-nuevo", async (req, reply) => {
    const resultado = await simularEventoNuevoModelo(req.params.id);
    if ("error" in resultado) {
      reply.code(422);
      return { ok: false, error: resultado.error };
    }
    return { ok: true, evento: resultado.evento };
  });
}
