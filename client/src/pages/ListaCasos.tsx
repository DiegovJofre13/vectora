import { useEffect, useState, type MouseEvent } from "react";
import { archivarCaso, desarchivarCaso, eliminarCaso, listarCasosDeUso, type CasoDeUsoResumen } from "../lib/api.js";

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
  const [verArchivados, setVerArchivados] = useState(false);
  const [accionEnCurso, setAccionEnCurso] = useState<string | null>(null);

  function recargar() {
    listarCasosDeUso(verArchivados)
      .then((data) => setCasos(data as CasoConEvaluaciones[]))
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }

  useEffect(recargar, [verArchivados]);

  async function handleArchivar(e: MouseEvent, casoId: string, archivado: boolean) {
    e.stopPropagation();
    setAccionEnCurso(casoId);
    try {
      await (archivado ? desarchivarCaso(casoId) : archivarCaso(casoId));
      recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo archivar el caso.");
    } finally {
      setAccionEnCurso(null);
    }
  }

  async function handleEliminar(e: MouseEvent, casoId: string, nombre: string) {
    e.stopPropagation();
    if (!window.confirm(`¿Borrar "${nombre}" permanentemente? Esto no se puede deshacer.`)) return;
    setAccionEnCurso(casoId);
    try {
      const res = await eliminarCaso(casoId);
      if (!res.ok) throw new Error(res.error ?? "No se pudo borrar el caso.");
      recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el caso.");
    } finally {
      setAccionEnCurso(null);
    }
  }

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

      <label className="mt-4 flex items-center gap-2 text-sm text-tinta/60">
        <input type="checkbox" checked={verArchivados} onChange={(e) => setVerArchivados(e.target.checked)} />
        Ver archivados
      </label>

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
            const puedeEliminar = caso.estado === "borrador" && caso.evaluaciones.length === 0;
            const ocupado = accionEnCurso === caso.id;
            return (
              <div
                key={caso.id}
                onClick={() => clickable && onVerReporte(caso.id, ultimaEvaluacion.id)}
                className={`rounded-card border border-linea bg-superficie p-5 shadow-sutil ${clickable ? "cursor-pointer hover:border-marca/40" : ""} ${caso.archivado ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <h2 className="font-display text-lg font-medium">{caso.nombre}</h2>
                  <span className={`text-xs font-medium ${estado.color}`}>{caso.archivado ? "Archivado" : estado.texto}</span>
                </div>
                <p className="mt-1 text-sm text-tinta/60">{caso.descripcion}</p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-tinta/70">
                  <span className="rounded-full bg-marca-tinte px-2 py-0.5 text-marca">{ETIQUETA_TIPO[caso.tipoTarea] ?? caso.tipoTarea}</span>
                  <span>modelo prod.: {caso.modeloProduccion ?? "—"}</span>
                  <span>costo/mes: {formatoUsd(caso.costoMensualProduccion)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  {clickable && <p className="text-xs font-medium text-marca">Ver reporte →</p>}
                  <div className="ml-auto flex gap-3">
                    <button
                      onClick={(e) => handleArchivar(e, caso.id, caso.archivado)}
                      disabled={ocupado}
                      className="text-xs text-tinta/50 hover:text-tinta disabled:opacity-40"
                    >
                      {caso.archivado ? "Desarchivar" : "Archivar"}
                    </button>
                    {puedeEliminar && (
                      <button
                        onClick={(e) => handleEliminar(e, caso.id, caso.nombre)}
                        disabled={ocupado}
                        className="text-xs text-coral hover:underline disabled:opacity-40"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
