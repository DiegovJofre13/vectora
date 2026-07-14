import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buscarOrganizacionPorApiKey, registrarConsumo, verificarSaldoSuficiente } from "../engine/credits.js";
import { completarConGateway } from "../engine/providerGateway.js";
import { aplicarMargen } from "../engine/billing.js";

const completarSchema = z.object({
  modelo: z.string().min(1),
  prompt: z.string().min(1),
  formato: z.literal("json").optional(),
  casoUsoId: z.string().optional(),
  casoPruebaId: z.string().optional(),
});

export async function registrarRutasGateway(app: FastifyInstance): Promise<void> {
  app.post("/api/gateway/completar", async (req, reply) => {
    const auth = req.headers.authorization;
    const apiKey = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
    if (!apiKey) {
      reply.code(401);
      return { ok: false, error: "Falta el header Authorization: Bearer <tu API key de Vectora>." };
    }

    const organizacion = await buscarOrganizacionPorApiKey(apiKey);
    if (!organizacion) {
      reply.code(401);
      return { ok: false, error: "API key inválida." };
    }

    const parsed = completarSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
    }

    // Chequeo grueso antes de gastar la llamada real: saldo debe ser positivo. El chequeo fino
    // (¿alcanza para ESTA corrida completa?) ya se hizo al confirmar "correr" (orchestrator.ts).
    const saldoOk = await verificarSaldoSuficiente(organizacion.id, 0.000001);
    if (!saldoOk) {
      reply.code(402);
      return { ok: false, error: "Sin créditos disponibles. Carga créditos en Vectora antes de seguir evaluando." };
    }

    try {
      const resultado = await completarConGateway(parsed.data.modelo, parsed.data.prompt, parsed.data.formato);
      const { margenUsd, totalUsd } = aplicarMargen(resultado.costoBaseUsd);

      await registrarConsumo({
        organizacionId: organizacion.id,
        costoBaseUsd: resultado.costoBaseUsd,
        margenUsd,
        descripcion: `Gateway: ${parsed.data.modelo} (${resultado.tokensEntrada}+${resultado.tokensSalida} tokens)${parsed.data.casoPruebaId ? ` — caso ${parsed.data.casoPruebaId}` : ""}`,
      });

      return {
        ok: true,
        texto: resultado.texto,
        uso: { tokensEntrada: resultado.tokensEntrada, tokensSalida: resultado.tokensSalida, costoTotalUsd: totalUsd },
      };
    } catch (err) {
      reply.code(422);
      return { ok: false, error: err instanceof Error ? err.message : "No se pudo completar la llamada al modelo." };
    }
  });
}
