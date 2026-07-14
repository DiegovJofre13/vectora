import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.js";
import { cargarCreditos, obtenerResumenCreditos } from "../engine/credits.js";

const crearOrganizacionSchema = z.object({ nombre: z.string().min(1) });
const cargarCreditosSchema = z.object({ montoUsd: z.number().positive() });

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

  app.get<{ Params: { id: string } }>("/api/organizaciones/:id/creditos", async (req, reply) => {
    try {
      const resumen = await obtenerResumenCreditos(req.params.id);
      return { resumen };
    } catch {
      reply.code(404);
      return { ok: false, error: "Organización no encontrada." };
    }
  });

  // Sin pago real: "carga" el monto directo al saldo, para poder probar el gateway
  // y el bloqueo por saldo insuficiente sin integrar un procesador de pagos.
  app.post<{ Params: { id: string } }>("/api/organizaciones/:id/creditos/cargar", async (req, reply) => {
    const parsed = cargarCreditosSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    try {
      await cargarCreditos(req.params.id, parsed.data.montoUsd, `Carga manual de US$${parsed.data.montoUsd.toFixed(2)} (sin pago real)`);
      const resumen = await obtenerResumenCreditos(req.params.id);
      return { resumen };
    } catch (err) {
      reply.code(422);
      return { ok: false, error: err instanceof Error ? err.message : "No se pudo cargar el saldo." };
    }
  });
}
