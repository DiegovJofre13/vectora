import type { FastifyInstance } from "fastify";
import { obtenerCatalogo } from "../engine/modelCatalog.js";
import { sugerirModelos } from "../engine/suggestModels.js";
import { modeloSoportadoPorGateway } from "../engine/providerGateway.js";

export async function registrarRutasCatalogo(app: FastifyInstance): Promise<void> {
  app.get("/api/catalogo-modelos", async () => {
    // gatewaySoportado marca qué modelos puede llamar de verdad el gateway de Vectora hoy
    // (solo OpenAI, ver providerGateway.ts) — el resto queda en el catálogo para cuando se
    // agreguen esas keys, pero el cliente no debería poder elegirlos todavía.
    const modelos = obtenerCatalogo().map((m) => ({ ...m, gatewaySoportado: modeloSoportadoPorGateway(m.id) }));
    return { modelos };
  });

  app.post<{ Body: { tipoTarea: string; nombre: string; descripcion: string; volumenMensual?: number } }>(
    "/api/sugerir-modelos",
    async (req) => {
      const { tipoTarea, nombre, descripcion, volumenMensual } = req.body;
      const sugeridos = sugerirModelos({ tipoTarea, nombre, descripcion, volumenMensual });
      return { sugeridos };
    }
  );
}
