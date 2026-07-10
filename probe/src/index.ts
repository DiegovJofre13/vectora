export { VectoraProbe, crearProbe } from "./probe.js";
export type {
  VectoraCtx,
  ProbeResultado,
  FuncionRegistrada,
  LlamadaModelo,
  ProbeOptions,
  EjecutarRequest,
  EjecutarResponse,
  EjecutarResponseOk,
  EjecutarResponseError,
  SaludResponse,
} from "./types.js";

import { crearProbe } from "./probe.js";

/**
 * Singleton por defecto. Cubre el caso común (un sistema por proceso):
 *   import { probe } from "@vectora/probe";
 *   probe.register(miFuncion);
 *   await probe.wrap(ctx, (modelo) => miClienteLLM.completar({ modelo, prompt }));
 */
export const probe = crearProbe();
