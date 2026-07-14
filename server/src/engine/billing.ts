/**
 * Margen de Vectora sobre el costo real de los proveedores de modelos, cuando
 * la llamada pasa por el gateway (ver engine/providerGateway.ts). Confirmado
 * con el negocio en 30% — cámbialo acá si cambia, es el único lugar donde
 * vive este número.
 */
export const MARGEN_GATEWAY = 0.3;

export interface MontoConMargen {
  costoBaseUsd: number;
  margenUsd: number;
  totalUsd: number;
}

export function aplicarMargen(costoBaseUsd: number): MontoConMargen {
  const margenUsd = Number((costoBaseUsd * MARGEN_GATEWAY).toFixed(6));
  const totalUsd = Number((costoBaseUsd + margenUsd).toFixed(6));
  return { costoBaseUsd: Number(costoBaseUsd.toFixed(6)), margenUsd, totalUsd };
}
