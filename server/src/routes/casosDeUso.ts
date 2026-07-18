import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { requiereGeneradorParaTipo, type TipoTarea } from "../engine/taskTypes.js";
import { estimarCostoCorrida } from "../engine/costEstimator.js";

const TIPOS_TAREA = ["soporte_conversacional", "extraccion", "clasificacion", "rag", "generacion"] as const;

const crearCasoSchema = z.object({
  organizacionId: z.string().min(1),
  nombre: z.string().min(1),
  descripcion: z.string().min(1),
  tipoTarea: z.enum(TIPOS_TAREA),
  dominio: z.string().min(1),
  volumenMensual: z.number().int().positive().optional(),
  modeloProduccion: z.string().optional(),
  costoMensualProduccion: z.number().positive().optional(),
});

const verificarConexionSchema = z.object({
  probeUrl: z.string().url(),
});

const estimarCostoSchema = z.object({
  modelos: z.array(z.string()).min(1),
  numCasos: z.number().int().positive().optional(),
  /** Si viene (caso RAG/conversacional con KB ya cargado), se suma el costo estimado de generar el dataset con LLM. */
  kbDocs: z.array(z.object({ titulo: z.string(), contenido: z.string() })).optional(),
});

/** Timeout corto: verificar conexión debe ser rápido, es un chequeo antes de gastar una corrida completa. */
const TIMEOUT_VERIFICACION_MS = 10_000;

function fetchConTimeout(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_VERIFICACION_MS): Promise<Response> {
  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controlador.signal }).finally(() => clearTimeout(timeoutId));
}

export async function registrarRutasCasosDeUso(app: FastifyInstance): Promise<void> {
  app.post("/api/casos-de-uso", async (req, reply) => {
    const parsed = crearCasoSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    const datos = parsed.data;
    const organizacion = await db.organizacion.findUnique({ where: { id: datos.organizacionId } });
    if (!organizacion) {
      reply.code(404);
      return { ok: false, error: "La organización indicada no existe." };
    }
    const caso = await db.casoDeUso.create({
      data: {
        organizacionId: datos.organizacionId,
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        tipoTarea: datos.tipoTarea,
        requiereGenerador: requiereGeneradorParaTipo(datos.tipoTarea),
        dominio: datos.dominio,
        volumenMensual: datos.volumenMensual,
        modeloProduccion: datos.modeloProduccion,
        costoMensualProduccion: datos.costoMensualProduccion,
        estado: "borrador",
      },
    });
    return { caso };
  });

  app.post<{ Params: { id: string } }>("/api/casos-de-uso/:id/verificar-conexion", async (req, reply) => {
    const parsed = verificarConexionSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    const casoExistente = await db.casoDeUso.findUnique({ where: { id: req.params.id } });
    if (!casoExistente) {
      reply.code(404);
      return { ok: false, error: "Caso de uso no encontrado" };
    }

    const { probeUrl } = parsed.data;
    const base = probeUrl.replace(/\/$/, "");

    try {
      const saludRes = await fetchConTimeout(`${base}/probe/salud`);
      const salud = (await saludRes.json()) as { ok: boolean; registrado: boolean; nombreSistema?: string; tieneKb?: boolean };
      if (!salud.ok || !salud.registrado) {
        reply.code(422);
        return { ok: false, error: "El probe respondió pero no tiene ninguna función registrada (probe.register(fn))." };
      }

      const ejecutarRes = await fetchConTimeout(`${base}/probe/ejecutar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "prueba de conexión de Vectora", modelo: "gpt-4o-mini" }),
      });
      const ejecutar = (await ejecutarRes.json()) as { ok: boolean; error?: string; respuesta?: unknown };
      if (!ejecutar.ok) {
        reply.code(422);
        return { ok: false, error: `La función registrada respondió con un error: ${ejecutar.error}` };
      }

      await db.casoDeUso.update({ where: { id: req.params.id }, data: { probeUrl, estado: "conectado" } });
      // tieneKb (opcional, viene de versiones del SDK con probe.exponerKb()) le avisa a la UI que
      // puede ofrecer la carga automática del knowledge base en vez de que se pegue a mano.
      return { ok: true, nombreSistema: salud.nombreSistema, respuestaPrueba: ejecutar.respuesta, tieneKb: Boolean(salud.tieneKb) };
    } catch (err) {
      reply.code(422);
      const esTimeout = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        error: esTimeout
          ? `${probeUrl} no respondió dentro de ${TIMEOUT_VERIFICACION_MS / 1000}s (timeout).`
          : `No se pudo conectar a ${probeUrl}: ${err instanceof Error ? err.message : "error desconocido"}`,
      };
    }
  });

  app.post<{ Params: { id: string } }>("/api/casos-de-uso/:id/obtener-kb", async (req, reply) => {
    const parsed = verificarConexionSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    const { probeUrl } = parsed.data;
    const base = probeUrl.replace(/\/$/, "");

    try {
      const kbRes = await fetchConTimeout(`${base}/probe/kb`);
      const kb = (await kbRes.json()) as { ok: boolean; error?: string; docs?: { id?: string; titulo: string; contenido: string }[] };
      if (!kb.ok) {
        reply.code(422);
        return { ok: false, error: kb.error ?? "El sistema no expuso ningún knowledge base." };
      }
      return { ok: true, docs: kb.docs ?? [] };
    } catch (err) {
      reply.code(422);
      const esTimeout = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        error: esTimeout
          ? `${probeUrl} no respondió dentro de ${TIMEOUT_VERIFICACION_MS / 1000}s (timeout).`
          : `No se pudo conectar a ${probeUrl}: ${err instanceof Error ? err.message : "error desconocido"}`,
      };
    }
  });

  app.post<{ Params: { id: string } }>("/api/casos-de-uso/:id/estimar-costo", async (req, reply) => {
    const parsed = estimarCostoSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    const caso = await db.casoDeUso.findUnique({ where: { id: req.params.id } });
    if (!caso) {
      reply.code(404);
      return { ok: false, error: "Caso de uso no encontrado" };
    }
    const requiereGenerador = requiereGeneradorParaTipo(caso.tipoTarea as TipoTarea);
    const numCasos = parsed.data.numCasos ?? (requiereGenerador ? 30 : 10);
    const estimacion = estimarCostoCorrida({
      modelos: parsed.data.modelos,
      numCasos,
      tipoEstimacion: requiereGenerador ? "rag" : "estructural",
      kbDocsParaGeneracion: requiereGenerador && parsed.data.kbDocs ? parsed.data.kbDocs : undefined,
    });
    return { estimacion };
  });

  app.get<{ Querystring: { incluirArchivados?: string } }>("/api/casos-de-uso", async (req) => {
    const casos = await db.casoDeUso.findMany({
      where: req.query.incluirArchivados === "true" ? {} : { archivado: false },
      include: { organizacion: true, evaluaciones: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
    });
    return { casos };
  });

  app.post<{ Params: { id: string } }>("/api/casos-de-uso/:id/archivar", async (req, reply) => {
    const caso = await db.casoDeUso.findUnique({ where: { id: req.params.id } });
    if (!caso) {
      reply.code(404);
      return { ok: false, error: "Caso de uso no encontrado" };
    }
    await db.casoDeUso.update({ where: { id: req.params.id }, data: { archivado: true } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/casos-de-uso/:id/desarchivar", async (req, reply) => {
    const caso = await db.casoDeUso.findUnique({ where: { id: req.params.id } });
    if (!caso) {
      reply.code(404);
      return { ok: false, error: "Caso de uso no encontrado" };
    }
    await db.casoDeUso.update({ where: { id: req.params.id }, data: { archivado: false } });
    return { ok: true };
  });

  // Borrado real, no reversible. Solo permitido para casos que nunca llegaron a correr nada —
  // sin eso, la falta de cascada hacia EvaluacionCorrida/CorreccionJuicio/EventoGobernanza
  // haría fallar el delete en la base de todos modos (a propósito, ver nota en schema.prisma).
  app.delete<{ Params: { id: string } }>("/api/casos-de-uso/:id", async (req, reply) => {
    const caso = await db.casoDeUso.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { evaluaciones: true, correccionesJuicio: true, eventosGobernanza: true } } },
    });
    if (!caso) {
      reply.code(404);
      return { ok: false, error: "Caso de uso no encontrado" };
    }
    const tieneHistorial = caso._count.evaluaciones > 0 || caso._count.correccionesJuicio > 0 || caso._count.eventosGobernanza > 0;
    if (caso.estado !== "borrador" || tieneHistorial) {
      reply.code(422);
      return {
        ok: false,
        error: "Este caso ya tiene evaluaciones, correcciones o eventos asociados — no se puede borrar. Usá 'Archivar' en su lugar.",
      };
    }
    await db.casoDeUso.delete({ where: { id: req.params.id } });
    return { ok: true };
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
