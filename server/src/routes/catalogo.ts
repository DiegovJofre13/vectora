import type { FastifyInstance } from "fastify";
import { obtenerCatalogo } from "../engine/modelCatalog.js";
import { sugerirModelos } from "../engine/suggestModels.js";

export async function registrarRutasCatalogo(app: FastifyInstance): Promise<void> {
  app.get("/api/catalogo-modelos", async () => {
    return { modelos: obtenerCatalogo() };
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
