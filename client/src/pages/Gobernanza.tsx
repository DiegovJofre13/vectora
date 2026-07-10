import { useEffect, useState } from "react";
import {
  obtenerHistorialEventos,
  obtenerLedger,
  obtenerResumenGobernanza,
  simularEventoNuevoModelo,
  type EventoGobernanza,
  type FilaLedger,
  type ResumenGobernanza,
} from "../lib/api.js";

const ETIQUETA_ESTADO: Record<string, { texto: string; clase: string }> = {
  optimo: { texto: "óptimo", clase: "bg-marca text-white" },
  cambio_sugerido: { texto: "cambio sugerido", clase: "bg-ambar/15 text-ambar" },
  evaluacion_vieja: { texto: "evaluación vieja", clase: "bg-coral/15 text-coral" },
  sin_evaluar: { texto: "sin evaluar", clase: "bg-tinta/10 text-tinta/50" },
};

function formatoUsd(v: number): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function formatoFecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

export function Gobernanza() {
  const [ledger, setLedger] = useState<FilaLedger[] | null>(null);
  const [resumen, setResumen] = useState<ResumenGobernanza | null>(null);
  const [eventos, setEventos] = useState<EventoGobernanza[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [simulando, setSimulando] = useState<string | null>(null);
  const [mensajeSimulacion, setMensajeSimulacion] = useState<string | null>(null);

  function cargar() {
    Promise.all([obtenerLedger(), obtenerResumenGobernanza(), obtenerHistorialEventos()])
      .then(([l, r, e]) => {
        setLedger(l);
        setResumen(r);
        setEventos(e);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }

  useEffect(cargar, []);

  async function handleSimular(casoDeUsoId: string) {
    setSimulando(casoDeUsoId);
    setMensajeSimulacion(null);
    try {
      const { evento } = await simularEventoNuevoModelo(casoDeUsoId);
      setMensajeSimulacion(evento.descripcion);
      cargar();
    } catch (err) {
      setMensajeSimulacion(err instanceof Error ? err.message : "No se pudo simular el evento.");
    } finally {
      setSimulando(null);
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl font-medium">Registro de decisiones</h1>
      <p className="mt-1 text-tinta/60">El gobierno de tu stack de IA: qué corre en producción, qué costó, y qué cambió.</p>

      {error && <div className="mt-6 rounded-card border border-coral/30 bg-coral/5 p-4 text-sm text-coral">{error}</div>}

      {resumen && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <TarjetaResumen etiqueta="Gasto mensual de IA" valor={formatoUsd(resumen.gastoMensualUsd)} />
          <TarjetaResumen etiqueta="Ahorro acumulado" valor={formatoUsd(resumen.ahorroAcumuladoUsd)} acento="text-marca" />
          <TarjetaResumen etiqueta="Casos activos" valor={String(resumen.casosActivos)} />
          <TarjetaResumen etiqueta="Requieren re-evaluación" valor={String(resumen.casosRequierenReevaluacion)} acento="text-ambar" />
        </div>
      )}

      {mensajeSimulacion && <div className="mt-4 rounded-card border border-azul/30 bg-azul/5 p-3 text-sm text-azul">{mensajeSimulacion}</div>}

      <h2 className="mt-8 font-display text-xl font-medium">Casos de uso en producción</h2>

      {ledger && ledger.length === 0 && (
        <div className="mt-4 rounded-card border border-dashed border-linea p-10 text-center text-sm text-tinta/60">
          Todavía no hay casos de uso conectados. Crea uno desde la pestaña "Casos de uso".
        </div>
      )}

      {(!ledger || ledger.length > 0) && (
      <div className="mt-4 overflow-x-auto rounded-card border border-linea bg-superficie shadow-sutil">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-linea text-left text-xs text-tinta/50">
              <th className="px-4 py-2 font-medium">Caso</th>
              <th className="px-4 py-2 font-medium">Volumen/mes</th>
              <th className="px-4 py-2 font-medium">Modelo prod.</th>
              <th className="px-4 py-2 font-medium">Costo/mes</th>
              <th className="px-4 py-2 font-medium">Última evaluación</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 font-medium">Evento</th>
            </tr>
          </thead>
          <tbody>
            {ledger?.map((f) => {
              const estado = ETIQUETA_ESTADO[f.estado]!;
              return (
                <tr key={f.casoDeUsoId} className="border-b border-linea last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{f.nombre}</div>
                    <div className="font-mono text-xs text-tinta/50">{f.tipoTarea}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{f.volumenMensual?.toLocaleString("es-CL") ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{f.modeloProduccion ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{f.costoMensualProduccion !== null ? formatoUsd(f.costoMensualProduccion) : "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{formatoFecha(f.ultimaEvaluacion)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estado.clase}`}>{estado.texto}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleSimular(f.casoDeUsoId)}
                      disabled={!f.probeConectado || simulando !== null}
                      title={f.probeConectado ? "Simula que salió un modelo nuevo y re-corre este caso" : "Conecta el sistema para habilitar alertas por evento"}
                      className="whitespace-nowrap rounded-card border border-linea px-3 py-1.5 text-xs font-medium hover:border-marca/40 disabled:opacity-30"
                    >
                      {simulando === f.casoDeUsoId ? "Simulando… (~1 min)" : "Simular modelo nuevo"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      <h2 className="mt-8 font-display text-xl font-medium">Historial de eventos</h2>
      <div className="mt-4 space-y-2">
        {eventos.length === 0 && <p className="text-sm text-tinta/50">Todavía no hay eventos registrados.</p>}
        {eventos.map((e) => (
          <div key={e.id} className="flex items-start gap-3 rounded-card border border-linea bg-superficie p-4 shadow-sutil">
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${e.huboImpacto ? "bg-ambar" : "bg-marca"}`} />
            <div className="flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{e.casoDeUso.nombre}</span>
                <span className="font-mono text-xs text-tinta/40">{formatoFecha(e.createdAt)}</span>
              </div>
              <p className="mt-0.5 text-sm text-tinta/70">{e.descripcion}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TarjetaResumen({ etiqueta, valor, acento }: { etiqueta: string; valor: string; acento?: string }) {
  return (
    <div className="rounded-card border border-linea bg-superficie p-4 shadow-sutil">
      <div className="text-xs text-tinta/50">{etiqueta}</div>
      <div className={`font-mono text-xl font-medium ${acento ?? ""}`}>{valor}</div>
    </div>
  );
}
