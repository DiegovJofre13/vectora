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
  CompletarParams,
  CompletarResultado,
  KbDoc,
  KbResponse,
} from "./types.js";

import { crearProbe } from "./probe.js";

/**
 * Singleton por defecto. Cubre el caso común (un sistema por proceso):
 *   import { probe } from "@vectora/probe";
 *   probe.register(miFuncion);
 *   const { texto } = await probe.completar(ctx, { prompt });
 */
export const probe = crearProbe();
