import { useEffect, useState } from "react";
import {
  cargarCreditos,
  listarOrganizaciones,
  obtenerHistorialEventos,
  obtenerLedger,
  obtenerResumenCreditos,
  obtenerResumenGobernanza,
  simularEventoNuevoModelo,
  type EventoGobernanza,
  type FilaLedger,
  type ResumenCreditos,
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

function formatoUsdPreciso(v: number): string {
  return `US$${v.toFixed(4)}`;
}

function formatoFecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function enmascarar(key: string): string {
  return `${key.slice(0, 12)}${"•".repeat(16)}${key.slice(-4)}`;
}

export function Gobernanza() {
  const [ledger, setLedger] = useState<FilaLedger[] | null>(null);
  const [resumen, setResumen] = useState<ResumenGobernanza | null>(null);
  const [eventos, setEventos] = useState<EventoGobernanza[]>([]);
  const [organizacionId, setOrganizacionId] = useState<string | null>(null);
  const [creditos, setCreditos] = useState<ResumenCreditos | null>(null);
  const [mostrarKey, setMostrarKey] = useState(false);
  const [montoCarga, setMontoCarga] = useState("20");
  const [cargandoCredito, setCargandoCredito] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCreditos, setErrorCreditos] = useState<string | null>(null);
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

    listarOrganizaciones()
      .then((orgs) => {
        const orgId = orgs[0]?.id;
        if (!orgId) return;
        setOrganizacionId(orgId);
        return obtenerResumenCreditos(orgId).then(setCreditos);
      })
      .catch((err) => setErrorCreditos(err instanceof Error ? err.message : "No se pudieron cargar los créditos."));
  }

  useEffect(cargar, []);

  async function handleCargarCreditos() {
    if (!organizacionId) return;
    const monto = Number(montoCarga);
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorCreditos("Ingresa un monto válido mayor a 0.");
      return;
    }
    setCargandoCredito(true);
    setErrorCreditos(null);
    try {
      const nuevoResumen = await cargarCreditos(organizacionId, monto);
      setCreditos(nuevoResumen);
    } catch (err) {
      setErrorCreditos(err instanceof Error ? err.message : "No se pudo cargar el saldo.");
    } finally {
      setCargandoCredito(false);
    }
  }

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

      <h2 className="mt-8 font-display text-xl font-medium">Créditos</h2>
      <p className="mt-1 text-sm text-tinta/60">
        Pago por uso del gateway de modelos: cada llamada que pasa por Vectora (en vez de la key propia del cliente) descuenta de acá — costo real
        del proveedor más margen. Sin créditos, no se pueden correr evaluaciones nuevas.
      </p>

      {errorCreditos && <div className="mt-4 rounded-card border border-coral/30 bg-coral/5 p-3 text-sm text-coral">{errorCreditos}</div>}

      {creditos && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-card border border-linea bg-superficie p-5 shadow-sutil">
            <div className="text-xs text-tinta/50">Saldo disponible</div>
            <div className={`font-mono text-3xl font-medium ${creditos.saldoUsd <= 0 ? "text-coral" : "text-tinta"}`}>
              {formatoUsd(creditos.saldoUsd)}
            </div>
            {creditos.saldoUsd <= 0 && <p className="mt-1 text-xs text-coral">Sin saldo: las corridas nuevas se van a bloquear.</p>}

            <div className="mt-4 flex gap-2">
              <input
                value={montoCarga}
                onChange={(e) => setMontoCarga(e.target.value)}
                type="number"
                min="1"
                className="w-28 rounded-card border border-linea px-3 py-2 text-sm outline-none focus:border-marca"
              />
              <button
                onClick={handleCargarCreditos}
                disabled={cargandoCredito}
                className="rounded-card bg-marca px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {cargandoCredito ? "Cargando…" : "Cargar créditos"}
              </button>
            </div>
            <p className="mt-1 text-xs text-tinta/40">Sin pago real — esto solo simula la carga para poder probar el gateway.</p>
          </div>

          <div className="rounded-card border border-linea bg-superficie p-5 shadow-sutil">
            <div className="text-xs text-tinta/50">API key para el gateway (VECTORA_API_KEY)</div>
            <div className="mt-1 flex items-center gap-2 font-mono text-sm">
              <code className="flex-1 truncate rounded bg-fondo px-2 py-1">{mostrarKey ? creditos.apiKeyGateway : enmascarar(creditos.apiKeyGateway)}</code>
              <button onClick={() => setMostrarKey((v) => !v)} className="shrink-0 text-xs text-marca hover:underline">
                {mostrarKey ? "ocultar" : "mostrar"}
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(creditos.apiKeyGateway)}
                className="shrink-0 rounded-card border border-linea px-2 py-1 text-xs hover:border-marca/40"
              >
                copiar
              </button>
            </div>
            <p className="mt-3 text-xs text-tinta/50">
              Pásala como <code className="font-mono">VECTORA_API_KEY</code> en el entorno del sistema del cliente para que use{" "}
              <code className="font-mono">probe.completar()</code> en vez de su propia key de proveedor. Ver{" "}
              <code className="font-mono">docs/CONECTAR-SISTEMA-REAL.md</code>.
            </p>
          </div>
        </div>
      )}

      {creditos && creditos.movimientos.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-card border border-linea bg-superficie shadow-sutil">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-linea text-left text-xs text-tinta/50">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Descripción</th>
                <th className="px-4 py-2 font-medium">Costo base</th>
                <th className="px-4 py-2 font-medium">Margen</th>
                <th className="px-4 py-2 font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {creditos.movimientos.map((m) => (
                <tr key={m.id} className="border-b border-linea last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-tinta/50">{formatoFecha(m.createdAt)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.tipo === "carga" ? "bg-marca/15 text-marca" : "bg-azul/15 text-azul"}`}>
                      {m.tipo}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-tinta/70">{m.descripcion}</td>
                  <td className="px-4 py-2 font-mono text-xs text-tinta/50">{m.costoBaseUsd !== null ? formatoUsdPreciso(m.costoBaseUsd) : "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-tinta/50">{m.margenUsd !== null ? formatoUsdPreciso(m.margenUsd) : "—"}</td>
                  <td className={`px-4 py-2 font-mono text-xs ${m.tipo === "carga" ? "text-marca" : "text-tinta"}`}>
                    {m.tipo === "carga" ? "+" : "−"}
                    {formatoUsdPreciso(m.montoUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
