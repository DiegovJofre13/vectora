import { useEffect, useState } from "react";
import { listarCasosDeUso, type CasoDeUsoResumen } from "../lib/api.js";

interface CasoConEvaluaciones extends CasoDeUsoResumen {
  evaluaciones: { id: string; estado: string }[];
}

const ETIQUETA_TIPO: Record<string, string> = {
  rag: "RAG",
  soporte_conversacional: "Soporte conversacional",
  extraccion: "Extracción",
  clasificacion: "Clasificación",
  generacion: "Generación",
};

const ETIQUETA_ESTADO: Record<string, { texto: string; color: string }> = {
  borrador: { texto: "Borrador", color: "text-tinta/60" },
  conectado: { texto: "Conectado", color: "text-azul" },
  evaluado: { texto: "Evaluado", color: "text-marca" },
};

function formatoUsd(valor: number | null): string {
  if (valor === null) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(valor);
}

interface Props {
  onNuevoCaso: () => void;
  onVerReporte: (casoId: string, corridaId: string) => void;
}

export function ListaCasos({ onNuevoCaso, onVerReporte }: Props) {
  const [casos, setCasos] = useState<CasoConEvaluaciones[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarCasosDeUso()
      .then((data) => setCasos(data as CasoConEvaluaciones[]))
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }, []);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium">Casos de uso</h1>
          <p className="mt-1 text-tinta/60">Qué modelo conviene para cada caso, con evidencia real de tu propio sistema.</p>
        </div>
        <button
          onClick={onNuevoCaso}
          className="whitespace-nowrap rounded-card bg-marca px-4 py-2 text-sm font-medium text-white shadow-sutil hover:bg-marca/90"
        >
          + Nuevo caso de uso
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-card border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
          No se pudo conectar al server ({error}). ¿Está corriendo <code className="font-mono">npm run dev:server</code>?
        </div>
      )}

      {!error && !casos && <p className="mt-6 text-sm text-tinta/50">Cargando…</p>}

      {casos && casos.length === 0 && (
        <div className="mt-8 rounded-card border border-dashed border-linea p-10 text-center">
          <p className="font-display text-lg">Todavía no hay casos de uso</p>
          <p className="mt-1 text-sm text-tinta/60">Conecta tu primer sistema para saber qué modelo te conviene.</p>
          <button onClick={onNuevoCaso} className="mt-4 rounded-card bg-marca px-4 py-2 text-sm font-medium text-white">
            + Nuevo caso de uso
          </button>
        </div>
      )}

      {casos && casos.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {casos.map((caso) => {
            const estado = ETIQUETA_ESTADO[caso.estado] ?? { texto: caso.estado, color: "text-tinta/60" };
            const ultimaEvaluacion = caso.evaluaciones[0];
            const clickable = caso.estado === "evaluado" && ultimaEvaluacion;
            return (
              <div
                key={caso.id}
                onClick={() => clickable && onVerReporte(caso.id, ultimaEvaluacion.id)}
                className={`rounded-card border border-linea bg-superficie p-5 shadow-sutil ${clickable ? "cursor-pointer hover:border-marca/40" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <h2 className="font-display text-lg font-medium">{caso.nombre}</h2>
                  <span className={`text-xs font-medium ${estado.color}`}>{estado.texto}</span>
                </div>
                <p className="mt-1 text-sm text-tinta/60">{caso.descripcion}</p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-tinta/70">
                  <span className="rounded-full bg-marca-tinte px-2 py-0.5 text-marca">{ETIQUETA_TIPO[caso.tipoTarea] ?? caso.tipoTarea}</span>
                  <span>modelo prod.: {caso.modeloProduccion ?? "—"}</span>
                  <span>costo/mes: {formatoUsd(caso.costoMensualProduccion)}</span>
                </div>
                {clickable && <p className="mt-3 text-xs font-medium text-marca">Ver reporte →</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
