/**
 * Contrato público del SDK @vectora/probe.
 *
 * El cliente instala este paquete dentro de su propio proceso y declara dos
 * ganchos: `register` (su función de entrada, con todo el pipeline adentro)
 * y `wrap` (el punto exacto donde se invoca al modelo). Vectora nunca ve el
 * código del cliente: solo llama a estos ganchos por HTTP, una vez por caso
 * de prueba y por modelo del panel.
 */

/** Contexto que Vectora inyecta en cada invocación de una corrida. */
export interface VectoraCtx {
  /** Id del modelo a usar en esta invocación (ver catálogo de modelos del server). */
  modelo: string;
  /** Id del caso de uso en Vectora, si aplica. */
  casoUsoId?: string;
  /** Id del caso de prueba puntual dentro de la evaluación. */
  casoPruebaId?: string;
  /** Bolsa interna donde `wrap` deja métricas (latencia) de esta invocación. No mutar desde el cliente. */
  _metrica?: { latenciaMs: number; modelo: string };
}

/** Forma de salida obligatoria de toda función registrada. */
export interface ProbeResultado {
  /** Respuesta del sistema del cliente. String para texto libre, objeto para extracción/clasificación estructurada. */
  respuesta: string | Record<string, unknown>;
  /** Contexto recuperado (ej. chunks de RAG) para que el juez evalúe groundedness. Opcional: no todos los casos de uso hacen retrieval. */
  contextoRecuperado?: unknown;
}

/** Función de entrada que el cliente declara con `probe.register(fn)`. */
export type FuncionRegistrada<TInput = unknown> = (
  input: TInput,
  ctx: VectoraCtx
) => Promise<ProbeResultado>;

/** Llamada al modelo que el cliente envuelve con `probe.wrap(ctx, llmCall)`. */
export type LlamadaModelo<T = unknown> = (modelo: string) => Promise<T>;

export interface ProbeOptions {
  /** Puerto donde el probe expone su servidor HTTP local. Default: 4500, o env VECTORA_PROBE_PORT. */
  puerto?: number;
  /** Nombre descriptivo del sistema del cliente, solo para logs/salud. */
  nombreSistema?: string;
  /** Si es false, no levanta servidor HTTP automáticamente al registrar (útil para tests in-process). Default true. */
  autoServe?: boolean;
  /**
   * API key de Vectora para usar `probe.completar()` (el gateway de modelos de Vectora, que
   * llama al proveedor real y cobra créditos). Opcional: sin esto, `completar()` no está
   * disponible y el cliente sigue llamando a los modelos con su propia key vía `wrap`.
   * También se puede pasar por la variable de entorno VECTORA_API_KEY.
   */
  apiKey?: string;
  /** URL del server de Vectora para el gateway. Default: http://localhost:4310, o env VECTORA_GATEWAY_URL. */
  gatewayUrl?: string;
}

/** Parámetros para `probe.completar()` — el gateway de modelos de Vectora. */
export interface CompletarParams {
  prompt: string;
}

/** Resultado de `probe.completar()`. */
export interface CompletarResultado {
  texto: string;
}

/** Payload que Vectora envía al invocar una corrida sobre el sistema del cliente. */
export interface EjecutarRequest {
  input: unknown;
  modelo: string;
  casoUsoId?: string;
  casoPruebaId?: string;
}

export interface EjecutarResponseOk extends ProbeResultado {
  ok: true;
  latenciaMs: number;
}

export interface EjecutarResponseError {
  ok: false;
  error: string;
}

export type EjecutarResponse = EjecutarResponseOk | EjecutarResponseError;

export interface SaludResponse {
  ok: true;
  registrado: boolean;
  nombreSistema?: string;
  version: string;
}
