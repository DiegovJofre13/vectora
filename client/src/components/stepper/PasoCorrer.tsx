import { useEffect, useRef, useState } from "react";
import {
  confirmarYCorrer,
  editarCasoPrueba,
  estimarCosto,
  generarDataset,
  obtenerCasosDetalle,
  obtenerProgreso,
  type CasoConDetalle,
  type EstimacionCosto,
  type ProgresoCorrida,
} from "../../lib/api.js";
import type { DatosConexionModelos } from "./PasoConectarModelos.js";

interface Props {
  casoId: string;
  requiereGenerador: boolean;
  datos: DatosConexionModelos;
  onVolver: () => void;
  onCompletado: (corridaId: string) => void;
  onVerCasos: (corridaId: string) => void;
}

type Fase = "estimando" | "generando" | "revisando" | "confirmando" | "corriendo" | "error";

interface FilaSinteticaProps {
  caso: CasoConDetalle;
  onGuardar: (cambios: { pregunta?: string; respuestaEsperadaProvisional?: string }) => void;
}

function FilaSintetica({ caso, onGuardar }: FilaSinteticaProps) {
  const preguntaInicial = typeof caso.input === "string" ? caso.input : JSON.stringify(caso.input);
  const [pregunta, setPregunta] = useState(preguntaInicial);
  const [respuesta, setRespuesta] = useState(caso.respuestaEsperadaProvisional ?? "");
  const ultimaPreguntaGuardada = useRef(preguntaInicial);
  const ultimaRespuestaGuardada = useRef(caso.respuestaEsperadaProvisional ?? "");

  return (
    <div className="rounded-card border border-linea p-3">
      {caso.dificultad && (
        <span className="rounded-full bg-marca-tinte px-2 py-0.5 text-[10px] font-medium text-marca">{caso.dificultad.replace("_", "-")}</span>
      )}
      <label className="mt-2 block text-xs font-medium text-tinta/50">Pregunta</label>
      <textarea
        value={pregunta}
        onChange={(e) => setPregunta(e.target.value)}
        onBlur={() => {
          if (pregunta !== ultimaPreguntaGuardada.current) {
            ultimaPreguntaGuardada.current = pregunta;
            onGuardar({ pregunta });
          }
        }}
        rows={2}
        className="mt-1 w-full rounded border border-linea px-2 py-1 text-sm outline-none focus:border-marca"
      />
      <label className="mt-2 block text-xs font-medium text-tinta/50">Respuesta esperada (provisional)</label>
      <textarea
        value={respuesta}
        onChange={(e) => setRespuesta(e.target.value)}
        onBlur={() => {
          if (respuesta !== ultimaRespuestaGuardada.current) {
            ultimaRespuestaGuardada.current = respuesta;
            onGuardar({ respuestaEsperadaProvisional: respuesta });
          }
        }}
        rows={2}
        className="mt-1 w-full rounded border border-linea px-2 py-1 text-xs text-tinta/70 outline-none focus:border-marca"
      />
    </div>
  );
}

function FilaExistente({ caso }: { caso: CasoConDetalle }) {
  const envoltura = caso.input as { documento?: unknown; esperado?: Record<string, unknown> } | null;
  return (
    <div className="rounded-card border border-linea p-3 text-sm">
      <p className="font-mono text-xs text-tinta/70">{JSON.stringify(envoltura?.documento ?? caso.input)}</p>
      {envoltura?.esperado && (
        <div className="mt-2 space-y-0.5">
          {Object.entries(envoltura.esperado).map(([clave, valor]) => (
            <div key={clave} className="flex gap-2 font-mono text-xs text-tinta/50">
              <span className="font-medium">{clave}:</span>
              <span>{String(valor)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PasoCorrer({ casoId, requiereGenerador, datos, onVolver, onCompletado, onVerCasos }: Props) {
  const [fase, setFase] = useState<Fase>("estimando");
  const [estimacion, setEstimacion] = useState<EstimacionCosto | null>(null);
  const [corridaId, setCorridaId] = useState<string | null>(null);
  const [casos, setCasos] = useState<CasoConDetalle[]>([]);
  const [progreso, setProgreso] = useState<ProgresoCorrida | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const numCasos = requiereGenerador ? 30 : Math.max(datos.documentosExistentes?.length ?? 1, 1);

  useEffect(() => {
    estimarCosto(casoId, datos.modelos, numCasos, requiereGenerador ? datos.kbDocs : undefined)
      .then(setEstimacion)
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo estimar el costo de la corrida."));
    return () => {
      if (intervaloRef.current) clearInterval(intervaloRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerarDataset() {
    setFase("generando");
    setError(null);
    try {
      const { corridaId: nuevoId } = await generarDataset(casoId, datos);
      setCorridaId(nuevoId);
      const detalle = await obtenerCasosDetalle(casoId, nuevoId);
      setCasos(detalle.casos);
      setFase("revisando");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el dataset.");
      setFase("estimando");
    }
  }

  function handleGuardarCaso(casoPruebaId: string, cambios: { pregunta?: string; respuestaEsperadaProvisional?: string }) {
    if (!corridaId) return;
    editarCasoPrueba(casoId, corridaId, casoPruebaId, cambios).catch((err) => {
      setError(err instanceof Error ? err.message : "No se pudo guardar el cambio.");
    });
  }

  async function handleConfirmar() {
    if (!corridaId) return;
    setFase("confirmando");
    setError(null);
    try {
      const res = await confirmarYCorrer(casoId, corridaId);
      if (!res.ok) throw new Error(res.error ?? "No se pudo confirmar la corrida.");
      setFase("corriendo");
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
            setFase("error");
          }
        } catch (err) {
          if (intervaloRef.current) clearInterval(intervaloRef.current);
          setError(err instanceof Error ? err.message : "Error consultando el progreso.");
          setFase("error");
        }
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar la corrida.");
      setFase("revisando");
    }
  }

  const corriendoOConfirmando = fase === "corriendo" || fase === "confirmando";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-medium">Correr evaluación</h2>
        <p className="mt-1 text-sm text-tinta/60">
          Vectora va a ejercer tu sistema real con cada modelo del panel, {numCasos} casos × {datos.modelos.length} modelos.
        </p>
      </div>

      {estimacion && fase === "estimando" && (
        <div className="rounded-card border border-linea bg-fondo p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-tinta/60">Costo estimado</span>
            <span className="font-mono text-2xl font-medium">${estimacion.costoTotalUsd.toFixed(2)} USD</span>
          </div>
          <div className="mt-3 space-y-1">
            {estimacion.costoGeneracionUsd !== undefined && (
              <div className="flex justify-between font-mono text-xs text-tinta/60">
                <span>Generar el dataset (LLM)</span>
                <span>${estimacion.costoGeneracionUsd.toFixed(4)}</span>
              </div>
            )}
            {estimacion.costoPorModelo.map((m) => (
              <div key={m.modelo} className="flex justify-between font-mono text-xs text-tinta/60">
                <span>{m.modelo}</span>
                <span>${m.costoUsd.toFixed(4)}</span>
              </div>
            ))}
          </div>
          {estimacion.costoGeneracionUsd !== undefined && (
            <p className="mt-3 text-xs text-tinta/50">
              "Generar el dataset" se cobra al hacer click en "Generar dataset" (abajo); el resto se cobra al confirmar y correr.
            </p>
          )}
        </div>
      )}

      {fase === "revisando" && (
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-display text-lg font-medium">Revisa el set de pruebas antes de correr</h3>
            {estimacion && <span className="font-mono text-sm text-tinta/60">${estimacion.costoTotalUsd.toFixed(2)} USD estimado</span>}
          </div>
          <p className="mb-3 text-sm text-tinta/60">
            {requiereGenerador
              ? "Un LLM generó estas preguntas a partir de tu knowledge base (ya se cobró esa generación). Podés editarlas — y la respuesta esperada provisional — antes de confirmar y gastar la corrida contra el panel de modelos."
              : "Estos son los documentos que vas a evaluar."}
          </p>
          <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {casos.map((caso) =>
              caso.esSintetico ? (
                <FilaSintetica key={caso.casoPruebaId} caso={caso} onGuardar={(cambios) => handleGuardarCaso(caso.casoPruebaId, cambios)} />
              ) : (
                <FilaExistente key={caso.casoPruebaId} caso={caso} />
              )
            )}
          </div>
        </div>
      )}

      {fase === "corriendo" && progreso && (
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
          {corridaId && (
            <button onClick={() => onVerCasos(corridaId)} className="mt-3 text-xs font-medium text-marca hover:underline">
              Ver el set de casos generado (no hace falta esperar a que termine) →
            </button>
          )}
        </div>
      )}

      {error && <div className="rounded-card border border-coral/30 bg-coral/5 p-3 text-sm text-coral">{error}</div>}

      <div className="flex justify-between">
        <button
          onClick={onVolver}
          disabled={corriendoOConfirmando}
          className="rounded-card border border-linea px-5 py-2 text-sm font-medium hover:border-marca/40 disabled:opacity-40"
        >
          Volver
        </button>
        {fase === "revisando" || fase === "confirmando" ? (
          <button
            onClick={handleConfirmar}
            disabled={fase === "confirmando"}
            className="rounded-card bg-marca px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {fase === "confirmando" ? "Confirmando…" : "Confirmar y correr evaluación"}
          </button>
        ) : (
          <button
            onClick={handleGenerarDataset}
            disabled={fase === "generando" || fase === "corriendo" || !estimacion}
            className="rounded-card bg-marca px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {fase === "generando" ? "Generando…" : fase === "corriendo" ? "Corriendo…" : "Generar dataset"}
          </button>
        )}
      </div>
    </div>
  );
}
