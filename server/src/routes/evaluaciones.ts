import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { confirmarYCorrer, editarCasoPrueba, generarDataset, obtenerProgreso } from "../engine/orchestrator.js";
import { generarReporte } from "../engine/report.js";
import { obtenerCasosConDetalle } from "../engine/caseDetail.js";
import { modeloSoportadoPorGateway } from "../engine/providerGateway.js";

const kbDocSchema = z.object({ id: z.string().optional(), titulo: z.string().min(1), contenido: z.string().min(1) });
const documentoExistenteSchema = z.object({
  input: z.unknown(),
  esperado: z.record(z.unknown()),
  camposAmbiguos: z.array(z.string()).optional(),
});

const generarDatasetSchema = z.object({
  modelos: z.array(z.string()).min(2, "Se necesitan al menos 2 modelos para poder comparar."),
  kbDocs: z.array(kbDocSchema).optional(),
  documentosExistentes: z.array(documentoExistenteSchema).optional(),
});

const editarCasoPruebaSchema = z.object({
  pregunta: z.string().min(1).optional(),
  respuestaEsperadaProvisional: z.string().min(1).optional(),
});

export async function registrarRutasEvaluaciones(app: FastifyInstance): Promise<void> {
  // Fase 1: genera el dataset (preguntas + respuesta provisional, o los documentos existentes)
  // y crea la corrida en estado "pendiente" — todavía no llama al sistema del cliente ni gasta
  // créditos. El usuario revisa/edita en la UI y recién confirma con el endpoint de abajo.
  app.post<{ Params: { id: string } }>("/api/casos-de-uso/:id/evaluaciones", async (req, reply) => {
    const parsed = generarDatasetSchema.safeParse(req.body);
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
      const { corridaId } = await generarDataset(
        { id: caso.id, organizacionId: caso.organizacionId, tipoTarea: caso.tipoTarea, probeUrl: caso.probeUrl },
        parsed.data.modelos,
        { kbDocs: parsed.data.kbDocs, documentosExistentes: parsed.data.documentosExistentes }
      );
      return { corridaId };
    } catch (err) {
      reply.code(422);
      return { ok: false, error: err instanceof Error ? err.message : "No se pudo generar el dataset." };
    }
  });

  // Fase 2: el usuario ya revisó (y opcionalmente editó) el dataset — recién acá se hace el
  // chequeo de créditos y se dispara la ejecución real contra el sistema del cliente.
  app.post<{ Params: { id: string; corridaId: string } }>("/api/casos-de-uso/:id/evaluaciones/:corridaId/confirmar", async (req, reply) => {
    try {
      await confirmarYCorrer(req.params.corridaId);
      return { ok: true };
    } catch (err) {
      reply.code(422);
      return { ok: false, error: err instanceof Error ? err.message : "No se pudo confirmar la corrida." };
    }
  });

  // Edita una pregunta generada y/o su respuesta esperada provisional, mientras la corrida
  // sigue "pendiente" (antes de confirmar y correr).
  app.patch<{ Params: { id: string; corridaId: string; casoPruebaId: string } }>(
    "/api/casos-de-uso/:id/evaluaciones/:corridaId/casos-prueba/:casoPruebaId",
    async (req, reply) => {
      const parsed = editarCasoPruebaSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
      }
      try {
        await editarCasoPrueba(req.params.corridaId, req.params.casoPruebaId, parsed.data);
        return { ok: true };
      } catch (err) {
        reply.code(422);
        return { ok: false, error: err instanceof Error ? err.message : "No se pudo editar el caso de prueba." };
      }
    }
  );

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
  // completa: los CasoPrueba ya existen desde que se generó el dataset (ver generarDataset()),
  // así que esta misma ruta sirve tanto para la pantalla de revisión (corrida "pendiente",
  // sin resultados todavía) como para ver el detalle parcial mientras sigue corriendo.
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
