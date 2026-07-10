import { useState } from "react";
import { CompassIcon } from "./components/CompassIcon.js";
import { ListaCasos } from "./pages/ListaCasos.js";
import { NuevoCaso } from "./pages/NuevoCaso.js";
import { Reporte } from "./pages/Reporte.js";
import { Calibracion } from "./pages/Calibracion.js";
import { Gobernanza } from "./pages/Gobernanza.js";

export type Vista =
  | { tipo: "lista" }
  | { tipo: "nuevo" }
  | { tipo: "reporte"; casoId: string; corridaId: string }
  | { tipo: "calibracion" }
  | { tipo: "gobernanza" };

const TABS: { tipo: "lista" | "calibracion" | "gobernanza"; etiqueta: string }[] = [
  { tipo: "lista", etiqueta: "Casos de uso" },
  { tipo: "calibracion", etiqueta: "Calibrar el juez" },
  { tipo: "gobernanza", etiqueta: "Gobernanza" },
];

export default function App() {
  const [vista, setVista] = useState<Vista>({ tipo: "lista" });
  const tabActivo = vista.tipo === "reporte" || vista.tipo === "nuevo" ? "lista" : vista.tipo;

  return (
    <div className="min-h-screen">
      <header className="border-b border-linea bg-superficie print:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
          <button className="flex items-center gap-2" onClick={() => setVista({ tipo: "lista" })}>
            <CompassIcon size={22} className="text-marca" />
            <span className="font-display text-lg font-medium tracking-tight">Vectora</span>
          </button>
          <span className="ml-2 text-sm text-tinta/50">qué modelo conviene, con evidencia</span>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 px-6">
          {TABS.map((t) => (
            <button
              key={t.tipo}
              onClick={() => setVista({ tipo: t.tipo })}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
                tabActivo === t.tipo ? "border-marca text-marca" : "border-transparent text-tinta/50 hover:text-tinta"
              }`}
            >
              {t.etiqueta}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {vista.tipo === "lista" && (
          <ListaCasos onNuevoCaso={() => setVista({ tipo: "nuevo" })} onVerReporte={(casoId, corridaId) => setVista({ tipo: "reporte", casoId, corridaId })} />
        )}
        {vista.tipo === "nuevo" && (
          <NuevoCaso
            onCancelar={() => setVista({ tipo: "lista" })}
            onCompletado={(casoId, corridaId) => setVista({ tipo: "reporte", casoId, corridaId })}
          />
        )}
        {vista.tipo === "reporte" && (
          <Reporte
            casoId={vista.casoId}
            corridaId={vista.corridaId}
            onVolver={() => setVista({ tipo: "lista" })}
            onIrAGobernanza={() => setVista({ tipo: "gobernanza" })}
          />
        )}
        {vista.tipo === "calibracion" && <Calibracion />}
        {vista.tipo === "gobernanza" && <Gobernanza />}
      </main>
    </div>
  );
}
