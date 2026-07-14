import { randomBytes } from "node:crypto";

/** Key que el sistema del cliente usa para autenticarse contra el gateway de modelos de Vectora. */
export function generarApiKeyGateway(): string {
  return `vec_live_${randomBytes(24).toString("base64url")}`;
}
