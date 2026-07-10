import { useState } from "react";
import { PasoCasoDeUso, type DatosCasoDeUso } from "../components/stepper/PasoCasoDeUso.js";
import { PasoConectarModelos, type DatosConexionModelos } from "../components/stepper/PasoConectarModelos.js";
import { PasoCorrer } from "../components/stepper/PasoCorrer.js";
import { crearCasoDeUso, crearOrganizacion, listarOrganizaciones, type CasoDeUsoResumen } from "../lib/api.js";

interface Props {
  onCancelar: () => void;
  onCompletado: (casoId: string, corridaId: string) => void;
}

const PASOS = ["Caso de uso", "Conectar y elegir modelos", "Correr evaluación", "Reporte"];

export function NuevoCaso({ onCancelar, onCompletado }: Props) {
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [caso, setCaso] = useState<CasoDeUsoResumen | null>(null);
  const [datosConexion, setDatosConexion] = useState<DatosConexionModelos | null>(null);
  const [enviandoPaso1, setEnviandoPaso1] = useState(false);
  const [errorPaso1, setErrorPaso1] = useState<string | null>(null);

  async function handlePaso1(datos: DatosCasoDeUso) {
    setEnviandoPaso1(true);
    setErrorPaso1(null);
    try {
      const organizaciones = await listarOrganizaciones();
      // Onboarding vacío real: si es la primera vez que se usa Vectora (sin seed), se
      // provisiona una organización por defecto en vez de bloquear al usuario nuevo.
      const organizacionId = organizaciones[0]?.id ?? (await crearOrganizacion("Mi organización")).id;
      const nuevoCaso = await crearCasoDeUso({ organizacionId, ...datos });
      setCaso(nuevoCaso);
      setPaso(2);
    } catch (err) {
      setErrorPaso1(err instanceof Error ? err.message : "No se pudo crear el caso de uso.");
    } finally {
      setEnviandoPaso1(false);
    }
  }

  return (
    <div>
      <button onClick={onCancelar} className="text-sm text-tinta/50 hover:text-tinta">
        ← Volver a casos de uso
      </button>

      <div className="mt-4 flex items-center gap-2">
        {PASOS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs ${
                i + 1 <= paso ? "bg-marca text-white" : "border border-linea text-tinta/40"
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-xs ${i + 1 === paso ? "font-medium text-tinta" : "text-tinta/40"}`}>{label}</span>
            {i < PASOS.length - 1 && <div className="h-px w-6 bg-linea" />}
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-card border border-linea bg-superficie p-6 shadow-sutil">
        {paso === 1 && <PasoCasoDeUso onSiguiente={handlePaso1} enviando={enviandoPaso1} error={errorPaso1} />}

        {paso === 2 && caso && (
          <PasoConectarModelos
            casoId={caso.id}
            tipoTarea={caso.tipoTarea}
            requiereGenerador={caso.requiereGenerador}
            nombre={caso.nombre}
            descripcion={caso.descripcion}
            volumenMensual={caso.volumenMensual ?? undefined}
            onVolver={() => setPaso(1)}
            onSiguiente={(datos) => {
              setDatosConexion(datos);
              setPaso(3);
            }}
          />
        )}

        {paso === 3 && caso && datosConexion && (
          <PasoCorrer
            casoId={caso.id}
            requiereGenerador={caso.requiereGenerador}
            datos={datosConexion}
            onVolver={() => setPaso(2)}
            onCompletado={(corridaId) => onCompletado(caso.id, corridaId)}
          />
        )}
      </div>
    </div>
  );
}
