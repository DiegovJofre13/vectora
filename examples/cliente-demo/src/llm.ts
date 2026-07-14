/**
 * Stub local: la respuesta que usa este ejemplo cuando no hay VECTORA_API_KEY
 * configurada, para que se pueda correr sin ninguna credencial. El camino
 * real y soportado es el gateway de Vectora (`probe.completar()` en
 * index.ts) — este archivo ya no llama a ningún proveedor directamente.
 * Ver docs/COMO-FUNCIONA-LA-CONEXION.md § 5 sobre por qué el gateway es el
 * único camino documentado para conectar un sistema real.
 */

export interface ParametrosCompletar {
  modelo: string;
  contexto: string[];
}

export interface ResultadoCompletar {
  texto: string;
}

export async function completarStubLocal(params: ParametrosCompletar): Promise<ResultadoCompletar> {
  await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 400));
  const snippet = params.contexto[0]?.slice(0, 200);
  const texto = snippet
    ? `[stub local, sin VECTORA_API_KEY configurada — modelo "${params.modelo}"] Según la información disponible: ${snippet}`
    : `[stub local, sin VECTORA_API_KEY configurada — modelo "${params.modelo}"] No encontré contexto suficiente para responder con precisión.`;
  return { texto };
}
