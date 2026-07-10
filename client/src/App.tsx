import { useEffect, useState } from "react";
import { CompassIcon } from "./components/CompassIcon.js";
import { listarCasosDeUso, obtenerSalud, type CasoDeUsoResumen } from "./lib/api.js";

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

function formatoClp(valor: number | null): string {
  if (valor === null) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(valor);
}

export default function App() {
  const [casos, setCasos] = useState<CasoDeUsoResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([obtenerSalud(), listarCasosDeUso()])
      .then(([, listaCasos]) => setCasos(listaCasos))
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-linea bg-superficie">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
          <CompassIcon size={22} className="text-marca" />
          <span className="font-display text-lg font-medium tracking-tight">Vectora</span>
          <span className="ml-2 text-sm text-tinta/50">qué modelo conviene, con evidencia</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="font-display text-3xl font-medium">Casos de uso</h1>
        <p className="mt-1 text-tinta/60">Esqueleto de Fase 1 — datos reales del server, sembrados con el cliente ficticio Fintech Andina.</p>

        {error && (
          <div className="mt-6 rounded-card border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
            No se pudo conectar al server ({error}). ¿Está corriendo <code className="font-mono">npm run dev:server</code>?
          </div>
        )}

        {!error && !casos && <p className="mt-6 text-sm text-tinta/50">Cargando…</p>}

        {casos && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {casos.map((caso) => {
              const estado = ETIQUETA_ESTADO[caso.estado] ?? { texto: caso.estado, color: "text-tinta/60" };
              return (
                <div key={caso.id} className="rounded-card border border-linea bg-superficie p-5 shadow-sutil">
                  <div className="flex items-start justify-between">
                    <h2 className="font-display text-lg font-medium">{caso.nombre}</h2>
                    <span className={`text-xs font-medium ${estado.color}`}>{estado.texto}</span>
                  </div>
                  <p className="mt-1 text-sm text-tinta/60">{caso.descripcion}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-tinta/70">
                    <span className="rounded-full bg-marca-tinte px-2 py-0.5 text-marca">
                      {ETIQUETA_TIPO[caso.tipoTarea] ?? caso.tipoTarea}
                    </span>
                    <span>modelo prod.: {caso.modeloProduccion ?? "—"}</span>
                    <span>costo/mes: {formatoClp(caso.costoMensualProduccion)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
