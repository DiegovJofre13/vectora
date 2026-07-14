import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { iniciarCorrida } from "../engine/orchestrator.js";
import { obtenerProgreso } from "../engine/orchestrator.js";
import { generarReporte } from "../engine/report.js";
import { obtenerCasosConDetalle } from "../engine/caseDetail.js";
import { modeloSoportadoPorGateway } from "../engine/providerGateway.js";

const kbDocSchema = z.object({ id: z.string().optional(), titulo: z.string().min(1), contenido: z.string().min(1) });
const documentoExistenteSchema = z.object({
  input: z.unknown(),
  esperado: z.record(z.unknown()),
  camposAmbiguos: z.array(z.string()).optional(),
});

const iniciarCorridaSchema = z.object({
  modelos: z.array(z.string()).min(2, "Se necesitan al menos 2 modelos para poder comparar."),
  kbDocs: z.array(kbDocSchema).optional(),
  documentosExistentes: z.array(documentoExistenteSchema).optional(),
});

export async function registrarRutasEvaluaciones(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/api/casos-de-uso/:id/evaluaciones", async (req, reply) => {
    const parsed = iniciarCorridaSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }

    // Defensa en profundidad: el panel de la UI ya solo deja elegir modelos que el gateway
    // soporta (ver /api/catalogo-modelos), pero esto rechaza cualquier corrida creada igual
    // con un modelo no soportado, en vez de dejar que cada caso falle recién al llamar al modelo.
    const noSoportados = parsed.data.modelos.filter((m) => !modeloSoportadoPorGateway(m));
    if (noSoportados.length > 0) {
      reply.code(400);
      return {
        ok: false,
        error: `El gateway de Vectora todavía no soporta: ${noSoportados.join(", ")} (solo modelos de OpenAI por ahora).`,
      };
    }

    const caso = await db.casoDeUso.findUnique({ where: { id: req.params.id } });
    if (!caso) {
      reply.code(404);
      return { ok: false, error: "Caso de uso no encontrado" };
    }

    try {
      const { corridaId } = await iniciarCorrida(
        { id: caso.id, organizacionId: caso.organizacionId, tipoTarea: caso.tipoTarea, probeUrl: caso.probeUrl },
        parsed.data.modelos,
        { kbDocs: parsed.data.kbDocs, documentosExistentes: parsed.data.documentosExistentes }
      );
      return { corridaId };
    } catch (err) {
      reply.code(422);
      return { ok: false, error: err instanceof Error ? err.message : "No se pudo iniciar la corrida." };
    }
  });

  app.get<{ Params: { id: string; corridaId: string } }>("/api/casos-de-uso/:id/evaluaciones/:corridaId/progreso", async (req, reply) => {
    try {
      const progreso = await obtenerProgreso(req.params.corridaId);
      return { progreso };
    } catch {
      reply.code(404);
      return { ok: false, error: "Corrida no encontrada." };
    }
  });

  app.get<{ Params: { id: string; corridaId: string } }>("/api/casos-de-uso/:id/evaluaciones/:corridaId/reporte", async (req, reply) => {
    try {
      const reporte = await generarReporte(req.params.corridaId);
      return { reporte };
    } catch {
      reply.code(404);
      return { ok: false, error: "Corrida no encontrada." };
    }
  });

  // El set de pruebas + detalle por modelo. A propósito NO requiere que la corrida esté
  // completa: los CasoPrueba ya existen desde que se creó la corrida (ver iniciarCorrida()),
  // así que se puede ver el set generado y el detalle parcial mientras sigue corriendo.
  app.get<{ Params: { id: string; corridaId: string } }>("/api/casos-de-uso/:id/evaluaciones/:corridaId/casos", async (req, reply) => {
    try {
      const detalle = await obtenerCasosConDetalle(req.params.corridaId);
      return detalle;
    } catch {
      reply.code(404);
      return { ok: false, error: "Corrida no encontrada." };
    }
  });
}
