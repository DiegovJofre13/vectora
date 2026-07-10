import { useEffect, useRef, useState } from "react";
import { estimarCosto, iniciarCorrida, obtenerProgreso, type EstimacionCosto, type ProgresoCorrida } from "../../lib/api.js";
import type { DatosConexionModelos } from "./PasoConectarModelos.js";

interface Props {
  casoId: string;
  requiereGenerador: boolean;
  datos: DatosConexionModelos;
  onVolver: () => void;
  onCompletado: (corridaId: string) => void;
}

export function PasoCorrer({ casoId, requiereGenerador, datos, onVolver, onCompletado }: Props) {
  const [estimacion, setEstimacion] = useState<EstimacionCosto | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [progreso, setProgreso] = useState<ProgresoCorrida | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const numCasos = requiereGenerador ? 30 : Math.max(datos.documentosExistentes?.length ?? 1, 1);

  useEffect(() => {
    estimarCosto(casoId, datos.modelos, numCasos)
      .then(setEstimacion)
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo estimar el costo de la corrida."));
    return () => {
      if (intervaloRef.current) clearInterval(intervaloRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCorrer() {
    setCorriendo(true);
    setError(null);
    try {
      const { corridaId } = await iniciarCorrida(casoId, datos);
      intervaloRef.current = setInterval(async () => {
        try {
          const p = await obtenerProgreso(casoId, corridaId);
          setProgreso(p);
          if (p.estado === "completado") {
            if (intervaloRef.current) clearInterval(intervaloRef.current);
            onCompletado(corridaId);
          } else if (p.estado === "error") {
            if (intervaloRef.current) clearInterval(intervaloRef.current);
            setError("La corrida terminó con errores. Revisa la conexión con tu sistema.");
            setCorriendo(false);
          }
        } catch (err) {
          if (intervaloRef.current) clearInterval(intervaloRef.current);
          setError(err instanceof Error ? err.message : "Error consultando el progreso.");
          setCorriendo(false);
        }
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la corrida.");
      setCorriendo(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-medium">Correr evaluación</h2>
        <p className="mt-1 text-sm text-tinta/60">
          Vectora va a ejercer tu sistema real con cada modelo del panel, {numCasos} casos × {datos.modelos.length} modelos.
        </p>
      </div>

      {estimacion && !corriendo && (
        <div className="rounded-card border border-linea bg-fondo p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-tinta/60">Costo estimado</span>
            <span className="font-mono text-2xl font-medium">${estimacion.costoTotalUsd.toFixed(2)} USD</span>
          </div>
          <div className="mt-3 space-y-1">
            {estimacion.costoPorModelo.map((m) => (
              <div key={m.modelo} className="flex justify-between font-mono text-xs text-tinta/60">
                <span>{m.modelo}</span>
                <span>${m.costoUsd.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {corriendo && progreso && (
        <div className="rounded-card border border-linea bg-fondo p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-tinta/60">Progreso</span>
            <span className="font-mono text-sm">
              {progreso.completados} / {progreso.numCasos * progreso.numModelos} casos
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {Object.entries(progreso.porModelo).map(([modelo, completados]) => (
              <div key={modelo}>
                <div className="flex justify-between font-mono text-xs text-tinta/60">
                  <span>{modelo}</span>
                  <span>
                    {completados}/{progreso.numCasos}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-linea">
                  <div
                    className="h-full rounded-full bg-marca transition-all"
                    style={{ width: `${Math.min(100, (completados / progreso.numCasos) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-tinta/50">Ejerciendo tu sistema real vía el probe, con casos {requiereGenerador ? "sintéticos" : "reales"}.</p>
        </div>
      )}

      {error && <div className="rounded-card border border-coral/30 bg-coral/5 p-3 text-sm text-coral">{error}</div>}

      <div className="flex justify-between">
        <button
          onClick={onVolver}
          disabled={corriendo}
          className="rounded-card border border-linea px-5 py-2 text-sm font-medium hover:border-marca/40 disabled:opacity-40"
        >
          Volver
        </button>
        <button
          onClick={handleCorrer}
          disabled={corriendo || !estimacion}
          className="rounded-card bg-marca px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {corriendo ? "Corriendo…" : "Confirmar y correr evaluación"}
        </button>
      </div>
    </div>
  );
}
