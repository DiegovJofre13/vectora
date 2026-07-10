/**
 * Tipos de tarea soportados por el motor y la propiedad que distingue todo
 * el comportamiento del motor: ¿el caso trae su propio input, o el motor
 * tiene que generarlo?
 *
 * - rag / soporte_conversacional: la conversación no existe hasta que el
 *   agente generador la crea a partir del knowledge base del cliente.
 * - extraccion / clasificacion / generacion: el input (documento a procesar
 *   o resumir) ya existe en la infraestructura del cliente.
 *
 * Única fuente de verdad: tanto el seed como la API de creación de casos de
 * uso llaman a esta función para materializar `requiereGenerador`.
 */
export type TipoTarea = "soporte_conversacional" | "extraccion" | "clasificacion" | "rag" | "generacion";

const TIPOS_CON_INPUT_GENERADO: ReadonlySet<TipoTarea> = new Set(["rag", "soporte_conversacional"]);

export function requiereGeneradorParaTipo(tipoTarea: TipoTarea): boolean {
  return TIPOS_CON_INPUT_GENERADO.has(tipoTarea);
}

/** Estrategia de scoring que le corresponde a cada tipo de tarea (ver Módulo 2 / arquitectura de scoring). */
export function estrategiaScoringParaTipo(tipoTarea: TipoTarea): "estructural" | "juez" {
  return requiereGeneradorParaTipo(tipoTarea) || tipoTarea === "generacion" ? "juez" : "estructural";
}
