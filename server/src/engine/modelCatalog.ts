/**
 * Catálogo de modelos del panel. Vive en archivo (no en DB) porque cambia por
 * despliegue de Vectora, no por cliente: es el mismo panel para todas las
 * organizaciones. Reemplazar/ampliar esta lista es el único punto de contacto
 * para actualizar qué modelos ofrece Vectora.
 */
export interface ModeloCatalogo {
  id: string;
  nombre: string;
  proveedor: string;
  /** frontera | intermedio | barato | open */
  tier: "frontera" | "intermedio" | "barato" | "open";
  /** Precio blended por 1K tokens (entrada+salida promediado). Ver DECISIONS.md sobre esta simplificación. */
  precioPor1KUsd: number;
  /** Modelo de pesos abiertos (auto-hospedable). */
  openWeights: boolean;
  /** Latencia p50 típica en ms, usada por el motor Mock para simular tiempos realistas. */
  latenciaBaseMs: number;
  /** 0-1: probabilidad de que el motor Mock sintetice una respuesta "correcta" con este modelo. */
  calidadBase: number;
}

export const CATALOGO_MODELOS: ModeloCatalogo[] = [
  {
    id: "gpt-4o",
    nombre: "GPT-4o",
    proveedor: "OpenAI",
    tier: "frontera",
    precioPor1KUsd: 0.015,
    openWeights: false,
    latenciaBaseMs: 1900,
    calidadBase: 0.96,
  },
  {
    id: "claude-3-5-sonnet",
    nombre: "Claude 3.5 Sonnet",
    proveedor: "Anthropic",
    tier: "intermedio",
    precioPor1KUsd: 0.006,
    openWeights: false,
    latenciaBaseMs: 1300,
    calidadBase: 0.93,
  },
  {
    id: "gemini-1-5-flash",
    nombre: "Gemini 1.5 Flash",
    proveedor: "Google",
    tier: "intermedio",
    precioPor1KUsd: 0.0025,
    openWeights: false,
    latenciaBaseMs: 950,
    calidadBase: 0.88,
  },
  {
    id: "gpt-4o-mini",
    nombre: "GPT-4o mini",
    proveedor: "OpenAI",
    tier: "barato",
    precioPor1KUsd: 0.0006,
    openWeights: false,
    latenciaBaseMs: 750,
    calidadBase: 0.8,
  },
  {
    id: "llama-3-1-70b",
    nombre: "Llama 3.1 70B",
    proveedor: "Meta (self-hosted)",
    tier: "open",
    precioPor1KUsd: 0.0009,
    openWeights: true,
    latenciaBaseMs: 1450,
    calidadBase: 0.82,
  },
];

export function buscarModelo(id: string): ModeloCatalogo | undefined {
  return CATALOGO_MODELOS.find((m) => m.id === id);
}

export function obtenerCatalogo(): ModeloCatalogo[] {
  return CATALOGO_MODELOS;
}
