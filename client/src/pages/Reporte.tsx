import { useEffect, useState } from "react";
import { obtenerReporte, type ReporteEvaluacion } from "../lib/api.js";
import { ParetoChart } from "../components/ParetoChart.js";

const ETIQUETA_TAG: Record<string, { texto: string; clase: string }> = {
  optimo: { texto: "óptimo", clase: "bg-marca text-white" },
  valor: { texto: "valor", clase: "bg-azul/15 text-azul" },
  maxima_precision: { texto: "máxima precisión", clase: "bg-ambar/15 text-ambar" },
  open: { texto: "open", clase: "bg-violeta/15 text-violeta" },
};

interface Props {
  casoId: string;
  corridaId: string;
  onVolver: () => void;
  onIrAGobernanza: () => void;
}

export function Reporte({ casoId, corridaId, onVolver, onIrAGobernanza }: Props) {
  const [reporte, setReporte] = useState<ReporteEvaluacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    obtenerReporte(casoId, corridaId)
      .then(setReporte)
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }, [casoId, corridaId]);

  if (error) {
    return <div className="rounded-card border border-coral/30 bg-coral/5 p-4 text-sm text-coral">{error}</div>;
  }
  if (!reporte) {
    return <p className="text-sm text-tinta/50">Cargando reporte…</p>;
  }

  const nombresPorModelo = Object.fromEntries(reporte.filas.map((f) => [f.modelo, f.nombre]));
  const precisionMax = Math.max(...reporte.filas.map((f) => f.precision), 0.001);

  return (
    <div>
      <button onClick={onVolver} className="text-sm text-tinta/50 hover:text-tinta print:hidden">
        ← Volver a casos de uso
      </button>

      {/* Encabezado solo para la versión impresa/PDF, ya que el header con navegación se oculta al imprimir. */}
      <div className="mb-6 hidden border-b border-linea pb-4 print:block">
        <p className="font-display text-lg font-medium">Vectora — Reporte de evaluación</p>
        <p className="text-xs text-tinta/50">
          Generado el {new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })}
        </p>
      </div>

      {reporte.veredicto && (
        <div className="mt-4 rounded-card border border-marca/30 bg-marca-tinte p-6 shadow-sutil">
          <p className="text-xs font-medium uppercase tracking-wide text-marca">Veredicto</p>
          <h1 className="mt-1 font-display text-2xl font-medium">
            Usa <span className="text-marca">{reporte.veredicto.nombreRecomendado}</span>
          </h1>
          <p className="mt-2 text-sm text-tinta/70">{reporte.veredicto.justificacion}</p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metrica etiqueta="Precisión" valor={`${(reporte.veredicto.precision * 100).toFixed(1)}%`} />
            <Metrica etiqueta="Costo / 1K" valor={`$${reporte.veredicto.costoPor1KUsd}`} />
            <Metrica etiqueta="Latencia p95" valor={`${reporte.veredicto.latenciaP95Ms} ms`} />
            <Metrica
              etiqueta="Ahorro vs. producción"
              valor={reporte.veredicto.ahorroPctVsProduccion !== null ? `${reporte.veredicto.ahorroPctVsProduccion}%` : "—"}
            />
          </div>
        </div>
      )}

      {reporte.calloutReferenciaProvisional && (
        <div className="mt-4 rounded-card border border-ambar/30 bg-ambar/5 p-4 text-sm text-ambar">
          Las respuestas esperadas de este reporte fueron generadas por IA a partir del knowledge base (referencia provisional). Se refinan con
          validación humana en el módulo de calibración.
        </div>
      )}

      {reporte.esRag && (
        <div className="mt-3 rounded-card border border-azul/30 bg-azul/5 p-4 text-sm text-azul">
          El retrieval es el mismo del sistema del cliente e idéntico entre modelos — lo único que varía entre corridas es la generación. La
          precisión mostrada aísla esa diferencia.
        </div>
      )}

      <section className="mt-8">
        <h2 className="font-display text-xl font-medium">Comparación de modelos</h2>
        <p className="mt-1 text-sm text-tinta/60">Ordenados por ajuste al caso de uso, no por precisión pura.</p>
        <div className="mt-4 overflow-x-auto rounded-card border border-linea bg-superficie shadow-sutil">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-linea text-left text-xs text-tinta/50">
                <th className="px-4 py-2 font-medium">Modelo</th>
                <th className="px-4 py-2 font-medium">Precisión</th>
                <th className="px-4 py-2 font-medium">Latencia p95</th>
                <th className="px-4 py-2 font-medium">Costo / 1K</th>
                <th className="px-4 py-2 font-medium">Tag</th>
              </tr>
            </thead>
            <tbody>
              {reporte.filas.map((f) => (
                <tr key={f.modelo} className="border-b border-linea last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{f.nombre}</div>
                    <div className="font-mono text-xs text-tinta/50">{f.proveedor}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-linea">
                        <div className="h-full rounded-full bg-marca" style={{ width: `${(f.precision / precisionMax) * 100}%` }} />
                      </div>
                      <span className="font-mono text-xs">{(f.precision * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{f.latenciaP95Ms} ms</td>
                  <td className="px-4 py-3 font-mono text-xs">${f.costoPor1KUsd}</td>
                  <td className="px-4 py-3">
                    {f.tag && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ETIQUETA_TAG[f.tag]!.clase}`}>{ETIQUETA_TAG[f.tag]!.texto}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl font-medium">Frontera costo vs. precisión</h2>
        <div className="mt-4 rounded-card border border-linea bg-superficie p-5 shadow-sutil">
          <ParetoChart puntos={reporte.pareto} nombresPorModelo={nombresPorModelo} />
        </div>
      </section>

      <div className="mt-8 flex gap-3 print:hidden">
        <button onClick={() => window.print()} className="rounded-card border border-linea px-4 py-2 text-sm font-medium hover:border-marca/40">
          Exportar PDF
        </button>
        <button
          onClick={onIrAGobernanza}
          title="Configura alertas por evento para este caso en el módulo de gobernanza"
          className="rounded-card border border-linea px-4 py-2 text-sm font-medium hover:border-marca/40"
        >
          Programar re-evaluación por evento →
        </button>
      </div>
    </div>
  );
}

function Metrica({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <div className="text-xs text-tinta/50">{etiqueta}</div>
      <div className="font-mono text-lg font-medium">{valor}</div>
    </div>
  );
}
