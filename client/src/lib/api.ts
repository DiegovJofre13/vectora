const API_URL = import.meta.env["VITE_API_URL"] ?? "http://localhost:4310";

export interface CasoDeUsoResumen {
  id: string;
  nombre: string;
  descripcion: string;
  tipoTarea: string;
  requiereGenerador: boolean;
  dominio: string;
  probeUrl: string | null;
  estado: string;
  modeloProduccion: string | null;
  costoMensualProduccion: number | null;
  volumenMensual: number | null;
}

export interface Organizacion {
  id: string;
  nombre: string;
}

export interface ModeloCatalogo {
  id: string;
  nombre: string;
  proveedor: string;
  tier: "frontera" | "intermedio" | "barato" | "open";
  precioPor1KUsd: number;
  openWeights: boolean;
  latenciaBaseMs: number;
  calidadBase: number;
}

export interface EstimacionCosto {
  costoTotalUsd: number;
  costoPorModelo: { modelo: string; costoUsd: number }[];
  numCasos: number;
  numModelos: number;
}

export interface ProgresoCorrida {
  estado: string;
  numCasos: number;
  numModelos: number;
  completados: number;
  porModelo: Record<string, number>;
}

export interface FilaReporte {
  modelo: string;
  nombre: string;
  proveedor: string;
  tier: string;
  openWeights: boolean;
  precision: number;
  latenciaP95Ms: number;
  costoPromedioUsd: number;
  costoPor1KUsd: number;
  tag: "optimo" | "valor" | "maxima_precision" | "open" | null;
  ajusteCasoUso: number;
}

export interface ReporteEvaluacion {
  corridaId: string;
  estado: string;
  veredicto: {
    modeloRecomendado: string;
    nombreRecomendado: string;
    justificacion: string;
    precision: number;
    costoPor1KUsd: number;
    latenciaP95Ms: number;
    ahorroPctVsProduccion: number | null;
  } | null;
  filas: FilaReporte[];
  pareto: { modelo: string; costoPor1KUsd: number; precision: number; esFrontera: boolean; esRecomendado: boolean }[];
  esRag: boolean;
  calloutReferenciaProvisional: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json();
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error ?? `Error ${res.status}`);
  }
  return data as T;
}

export async function obtenerSalud(): Promise<{ ok: boolean; organizaciones: number; version: string }> {
  return req("/api/salud");
}

export async function listarCasosDeUso(): Promise<CasoDeUsoResumen[]> {
  const data = await req<{ casos: CasoDeUsoResumen[] }>("/api/casos-de-uso");
  return data.casos;
}

export async function obtenerCaso(id: string): Promise<any> {
  const data = await req<{ caso: any }>(`/api/casos-de-uso/${id}`);
  return data.caso;
}

export async function listarOrganizaciones(): Promise<Organizacion[]> {
  const data = await req<{ organizaciones: Organizacion[] }>("/api/organizaciones");
  return data.organizaciones;
}

export async function crearOrganizacion(nombre: string): Promise<Organizacion> {
  const data = await req<{ organizacion: Organizacion }>("/api/organizaciones", { method: "POST", body: JSON.stringify({ nombre }) });
  return data.organizacion;
}

export async function obtenerCatalogo(): Promise<ModeloCatalogo[]> {
  const data = await req<{ modelos: ModeloCatalogo[] }>("/api/catalogo-modelos");
  return data.modelos;
}

export async function sugerirModelosApi(input: {
  tipoTarea: string;
  nombre: string;
  descripcion: string;
  volumenMensual?: number;
}): Promise<string[]> {
  const data = await req<{ sugeridos: string[] }>("/api/sugerir-modelos", { method: "POST", body: JSON.stringify(input) });
  return data.sugeridos;
}

export interface CrearCasoInput {
  organizacionId: string;
  nombre: string;
  descripcion: string;
  tipoTarea: string;
  dominio: string;
  volumenMensual?: number;
  modeloProduccion?: string;
  costoMensualProduccion?: number;
}

export async function crearCasoDeUso(input: CrearCasoInput): Promise<CasoDeUsoResumen> {
  const data = await req<{ caso: CasoDeUsoResumen }>("/api/casos-de-uso", { method: "POST", body: JSON.stringify(input) });
  return data.caso;
}

export async function verificarConexion(
  casoId: string,
  probeUrl: string
): Promise<{ ok: boolean; nombreSistema?: string; respuestaPrueba?: unknown; error?: string }> {
  try {
    return await req(`/api/casos-de-uso/${casoId}/verificar-conexion`, { method: "POST", body: JSON.stringify({ probeUrl }) });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error desconocido" };
  }
}

export async function estimarCosto(casoId: string, modelos: string[], numCasos?: number): Promise<EstimacionCosto> {
  const data = await req<{ estimacion: EstimacionCosto }>(`/api/casos-de-uso/${casoId}/estimar-costo`, {
    method: "POST",
    body: JSON.stringify({ modelos, numCasos }),
  });
  return data.estimacion;
}

export interface KbDocInput {
  titulo: string;
  contenido: string;
}
export interface DocumentoExistenteInput {
  input: unknown;
  esperado: Record<string, unknown>;
  camposAmbiguos?: string[];
}

export async function iniciarCorrida(
  casoId: string,
  params: { modelos: string[]; kbDocs?: KbDocInput[]; documentosExistentes?: DocumentoExistenteInput[] }
): Promise<{ corridaId: string }> {
  return req(`/api/casos-de-uso/${casoId}/evaluaciones`, { method: "POST", body: JSON.stringify(params) });
}

export async function obtenerProgreso(casoId: string, corridaId: string): Promise<ProgresoCorrida> {
  const data = await req<{ progreso: ProgresoCorrida }>(`/api/casos-de-uso/${casoId}/evaluaciones/${corridaId}/progreso`);
  return data.progreso;
}

export async function obtenerReporte(casoId: string, corridaId: string): Promise<ReporteEvaluacion> {
  const data = await req<{ reporte: ReporteEvaluacion }>(`/api/casos-de-uso/${casoId}/evaluaciones/${corridaId}/reporte`);
  return data.reporte;
}

// --- Módulo 3: calibración del juez ---

export interface PendienteCalibracion {
  resultadoModeloId: string;
  casoDeUsoId: string;
  casoDeUsoNombre: string;
  dominio: string;
  modelo: string;
  question: string;
  context: string;
  systemAnswer: string;
  provisionalExpected: string;
  judgeVerdict: { groundedness: number | null; relevancia: number | null; completitud: number | null; promedio: number | null };
  confidence: number;
}

export interface ResumenCalibracionDominio {
  dominio: string;
  calibrados: number;
  pendientes: number;
  porcentajeAcuerdo: number;
}

export async function obtenerPendientesCalibracion(): Promise<PendienteCalibracion[]> {
  const data = await req<{ pendientes: PendienteCalibracion[] }>("/api/calibracion/pendientes");
  return data.pendientes;
}

export async function obtenerResumenCalibracion(): Promise<ResumenCalibracionDominio[]> {
  const data = await req<{ resumen: ResumenCalibracionDominio[] }>("/api/calibracion/resumen");
  return data.resumen;
}

export async function registrarCalibracion(
  resultadoModeloId: string,
  humanVerdict: "correcta" | "corregida",
  correctedAnswer?: string
): Promise<void> {
  await req(`/api/calibracion/${resultadoModeloId}`, { method: "POST", body: JSON.stringify({ humanVerdict, correctedAnswer }) });
}

// --- Módulo 4: registro de gobernanza ---

export interface FilaLedger {
  casoDeUsoId: string;
  nombre: string;
  tipoTarea: string;
  volumenMensual: number | null;
  modeloProduccion: string | null;
  costoMensualProduccion: number | null;
  ultimaEvaluacion: string | null;
  estado: "optimo" | "cambio_sugerido" | "evaluacion_vieja" | "sin_evaluar";
  modeloRecomendado: string | null;
  ahorroPctVsProduccion: number | null;
  probeConectado: boolean;
}

export interface ResumenGobernanza {
  gastoMensualUsd: number;
  ahorroAcumuladoUsd: number;
  casosActivos: number;
  casosRequierenReevaluacion: number;
}

export interface EventoGobernanza {
  id: string;
  casoDeUsoId: string;
  tipo: string;
  descripcion: string;
  huboImpacto: boolean;
  createdAt: string;
  casoDeUso: { nombre: string };
}

export async function obtenerLedger(): Promise<FilaLedger[]> {
  const data = await req<{ ledger: FilaLedger[] }>("/api/gobernanza/ledger");
  return data.ledger;
}

export async function obtenerResumenGobernanza(): Promise<ResumenGobernanza> {
  const data = await req<{ resumen: ResumenGobernanza }>("/api/gobernanza/resumen");
  return data.resumen;
}

export async function obtenerHistorialEventos(): Promise<EventoGobernanza[]> {
  const data = await req<{ eventos: EventoGobernanza[] }>("/api/gobernanza/eventos");
  return data.eventos;
}

export async function simularEventoNuevoModelo(casoId: string): Promise<{ evento: EventoGobernanza }> {
  return req(`/api/casos-de-uso/${casoId}/eventos/simular-modelo-nuevo`, { method: "POST", body: "{}" });
}

// --- Detalle de casos: set de pruebas + resultado por modelo ---

export interface DocumentoFuente {
  id: string;
  titulo: string;
  contenido: string;
}

export interface CampoComparado {
  clave: string;
  esperado: string;
  obtenido: string | null;
  esAmbiguo: boolean;
  puntaje: number;
}

export interface DetalleEstructural {
  score: number;
  campos: CampoComparado[];
  veredicto: "paso" | "fallo";
  razonamiento: string;
}

export interface ResultadoDetalle {
  resultadoId: string;
  modelo: string;
  respuesta: unknown;
  contextoRecuperado: DocumentoFuente[] | unknown;
  latenciaMs: number;
  costoEstimadoUsd: number;
  scoreEstructural: number | null;
  scoreGroundedness: number | null;
  scoreRelevancia: number | null;
  scoreCompletitud: number | null;
  scorePromedio: number | null;
  confianzaJuez: number | null;
  veredictoJuez: "paso" | "fallo" | null;
  razonamientoJuez: string | null;
  detalleEstructural: DetalleEstructural | null;
}

export interface CasoConDetalle {
  casoPruebaId: string;
  input: unknown;
  dificultad: "simple" | "multi_hop" | "razonamiento" | null;
  esSintetico: boolean;
  documentosFuente: DocumentoFuente[] | null;
  respuestaEsperadaProvisional: string | null;
  resultados: ResultadoDetalle[];
}

export interface CasosConDetalleRespuesta {
  requiereJuez: boolean;
  numModelos: number;
  casos: CasoConDetalle[];
}

export async function obtenerCasosDetalle(casoId: string, corridaId: string): Promise<CasosConDetalleRespuesta> {
  return req(`/api/casos-de-uso/${casoId}/evaluaciones/${corridaId}/casos`);
}

// --- Créditos: gateway de modelos (pago por uso, con margen) ---

export interface MovimientoCreditos {
  id: string;
  tipo: "carga" | "consumo";
  montoUsd: number;
  costoBaseUsd: number | null;
  margenUsd: number | null;
  descripcion: string;
  createdAt: string;
}

export interface ResumenCreditos {
  saldoUsd: number;
  apiKeyGateway: string;
  movimientos: MovimientoCreditos[];
}

export async function obtenerResumenCreditos(organizacionId: string): Promise<ResumenCreditos> {
  const data = await req<{ resumen: ResumenCreditos }>(`/api/organizaciones/${organizacionId}/creditos`);
  return data.resumen;
}

export async function cargarCreditos(organizacionId: string, montoUsd: number): Promise<ResumenCreditos> {
  const data = await req<{ resumen: ResumenCreditos }>(`/api/organizaciones/${organizacionId}/creditos/cargar`, {
    method: "POST",
    body: JSON.stringify({ montoUsd }),
  });
  return data.resumen;
}
