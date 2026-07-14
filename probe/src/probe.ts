import { createServer, type Server } from "node:http";
import { PROBE_VERSION } from "./version.js";
import type {
  CompletarParams,
  CompletarResultado,
  EjecutarRequest,
  EjecutarResponse,
  FuncionRegistrada,
  LlamadaModelo,
  ProbeOptions,
  SaludResponse,
  VectoraCtx,
} from "./types.js";

const PUERTO_DEFAULT = 4500;
const GATEWAY_URL_DEFAULT = "http://localhost:4310";

/**
 * VectoraProbe es el objeto central del SDK. Un cliente lo instancia una vez
 * (o usa el singleton `probe` exportado por el paquete), declara `register`
 * y envuelve su llamada al modelo con `wrap`. A partir de ahí, Vectora puede
 * invocar su sistema de forma remota vía el servidor HTTP local que este
 * objeto levanta, intercambiando el modelo en cada corrida sin tocar el
 * retrieval ni el prompt del cliente.
 */
export class VectoraProbe {
  private fn: FuncionRegistrada | undefined;
  private server: Server | undefined;
  private readonly puerto: number;
  private readonly nombreSistema: string | undefined;
  private readonly autoServe: boolean;
  private readonly apiKey: string | undefined;
  private readonly gatewayUrl: string;

  constructor(opciones: ProbeOptions = {}) {
    this.puerto = opciones.puerto ?? Number(process.env["VECTORA_PROBE_PORT"] ?? PUERTO_DEFAULT);
    this.nombreSistema = opciones.nombreSistema;
    this.autoServe = opciones.autoServe ?? true;
    this.apiKey = opciones.apiKey ?? process.env["VECTORA_API_KEY"];
    this.gatewayUrl = opciones.gatewayUrl ?? process.env["VECTORA_GATEWAY_URL"] ?? GATEWAY_URL_DEFAULT;
  }

  /**
   * Declara la función de entrada del sistema del cliente. Se invoca una vez
   * por caso de prueba y por modelo: adentro va todo el pipeline real (RAG,
   * prompt, llamada al modelo a través de `wrap`, post-proceso).
   */
  register<TInput = unknown>(fn: FuncionRegistrada<TInput>): void {
    this.fn = fn as FuncionRegistrada;
    if (this.autoServe && !this.server) {
      this.levantarServidor();
    }
  }

  /**
   * Envuelve la llamada al modelo. Vectora ya decidió qué modelo toca en
   * `ctx.modelo`; este método solo lo pasa al callback del cliente y mide
   * latencia. El retrieval y el prompt quedan intactos: lo único que cambia
   * entre corridas es el modelo que recibe `llamadaModelo`.
   */
  async wrap<T>(ctx: VectoraCtx, llamadaModelo: LlamadaModelo<T>): Promise<T> {
    const inicio = Date.now();
    const resultado = await llamadaModelo(ctx.modelo);
    ctx._metrica = { latenciaMs: Date.now() - inicio, modelo: ctx.modelo };
    return resultado;
  }

  /** Para el patrón C (sistema detrás de una API HTTP propia): qué modelo toca en esta corrida. */
  modeloActual(ctx: VectoraCtx): string {
    return ctx.modelo;
  }

  /**
   * Alternativa a `wrap` + tu propio cliente de modelos: le pide a Vectora que
   * haga la llamada real al modelo por vos (con el `apiKey` de tu organización)
   * y te devuelve el texto. Vectora paga al proveedor y te descuenta créditos
   * (costo real + margen) — no necesitás tu propia API key del proveedor.
   * Requiere haber pasado `apiKey` (o la env var VECTORA_API_KEY) al crear el
   * probe. Mide latencia igual que `wrap`, así que no hace falta envolver esto
   * con `wrap` también.
   */
  async completar(ctx: VectoraCtx, params: CompletarParams): Promise<CompletarResultado> {
    if (!this.apiKey) {
      throw new Error(
        "probe.completar() requiere un apiKey de Vectora (pásalo en crearProbe({ apiKey }) o en la env var VECTORA_API_KEY). " +
          "Si preferís usar tu propia API key de modelo, usá probe.wrap() en vez de completar()."
      );
    }

    const inicio = Date.now();
    const res = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/api/gateway/completar`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ modelo: ctx.modelo, prompt: params.prompt, casoUsoId: ctx.casoUsoId, casoPruebaId: ctx.casoPruebaId }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string; texto?: string };
    ctx._metrica = { latenciaMs: Date.now() - inicio, modelo: ctx.modelo };

    if (!data.ok) {
      throw new Error(`Gateway de Vectora: ${data.error ?? `respondió ${res.status}`}`);
    }
    return { texto: data.texto ?? "" };
  }

  /**
   * Invoca la función registrada directamente (sin pasar por HTTP). La usan
   * tanto el servidor HTTP interno como quien quiera correr el probe
   * embebido en el mismo proceso (ej. tests, o el motor de evaluación
   * corriendo contra un fixture de demo en el mismo monorepo).
   */
  async ejecutar(req: EjecutarRequest): Promise<EjecutarResponse> {
    if (!this.fn) {
      return { ok: false, error: "No hay ninguna función registrada. Llama a probe.register(fn) antes de ejecutar." };
    }
    const ctx: VectoraCtx = {
      modelo: req.modelo,
      casoUsoId: req.casoUsoId,
      casoPruebaId: req.casoPruebaId,
    };
    const inicio = Date.now();
    try {
      const resultado = await this.fn(req.input, ctx);
      const latenciaMs = ctx._metrica?.latenciaMs ?? Date.now() - inicio;
      return { ok: true, latenciaMs, respuesta: resultado.respuesta, contextoRecuperado: resultado.contextoRecuperado };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Estado de salud: usado por el paso "verificar conexión" del onboarding. */
  salud(): SaludResponse {
    return { ok: true, registrado: this.fn !== undefined, nombreSistema: this.nombreSistema, version: PROBE_VERSION };
  }

  /** Levanta el servidor HTTP local que Vectora llama de forma remota. Idempotente. */
  levantarServidor(): Server {
    if (this.server) return this.server;

    this.server = createServer((req, res) => {
      const enviar = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      if (req.method === "GET" && req.url === "/probe/salud") {
        enviar(200, this.salud());
        return;
      }

      if (req.method === "POST" && req.url === "/probe/ejecutar") {
        let cuerpo = "";
        req.on("data", (chunk) => (cuerpo += chunk));
        req.on("end", () => {
          void (async () => {
            try {
              const payload = JSON.parse(cuerpo || "{}") as EjecutarRequest;
              const respuesta = await this.ejecutar(payload);
              enviar(respuesta.ok ? 200 : 422, respuesta);
            } catch (err) {
              enviar(400, { ok: false, error: err instanceof Error ? err.message : "Payload inválido" });
            }
          })();
        });
        return;
      }

      enviar(404, { ok: false, error: "Ruta no encontrada. Usa GET /probe/salud o POST /probe/ejecutar." });
    });

    this.server.listen(this.puerto, () => {
      const etiqueta = this.nombreSistema ? ` (${this.nombreSistema})` : "";
      // eslint-disable-next-line no-console
      console.log(`[vectora/probe] escuchando en http://localhost:${this.puerto}${etiqueta}`);
    });

    return this.server;
  }

  /** Cierra el servidor HTTP local, si estaba levantado. */
  async cerrar(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server?.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = undefined;
  }
}

/** Crea una instancia independiente de VectoraProbe (útil si un proceso necesita más de un sistema registrado). */
export function crearProbe(opciones?: ProbeOptions): VectoraProbe {
  return new VectoraProbe(opciones);
}
