import { useState } from "react";
import { CompassIcon } from "./components/CompassIcon.js";
import { ListaCasos } from "./pages/ListaCasos.js";
import { NuevoCaso } from "./pages/NuevoCaso.js";
import { Reporte } from "./pages/Reporte.js";

export type Vista =
  | { tipo: "lista" }
  | { tipo: "nuevo" }
  | { tipo: "reporte"; casoId: string; corridaId: string };

export default function App() {
  const [vista, setVista] = useState<Vista>({ tipo: "lista" });

  return (
    <div className="min-h-screen">
      <header className="border-b border-linea bg-superficie">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
          <button className="flex items-center gap-2" onClick={() => setVista({ tipo: "lista" })}>
            <CompassIcon size={22} className="text-marca" />
            <span className="font-display text-lg font-medium tracking-tight">Vectora</span>
          </button>
          <span className="ml-2 text-sm text-tinta/50">qué modelo conviene, con evidencia</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {vista.tipo === "lista" && <ListaCasos onNuevoCaso={() => setVista({ tipo: "nuevo" })} onVerReporte={(casoId, corridaId) => setVista({ tipo: "reporte", casoId, corridaId })} />}
        {vista.tipo === "nuevo" && (
          <NuevoCaso
            onCancelar={() => setVista({ tipo: "lista" })}
            onCompletado={(casoId, corridaId) => setVista({ tipo: "reporte", casoId, corridaId })}
          />
        )}
        {vista.tipo === "reporte" && <Reporte casoId={vista.casoId} corridaId={vista.corridaId} onVolver={() => setVista({ tipo: "lista" })} />}
      </main>
    </div>
  );
}
