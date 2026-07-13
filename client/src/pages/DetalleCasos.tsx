import { useEffect, useMemo, useState } from "react";
import {
  obtenerCasosDetalle,
  obtenerCatalogo,
  type CasoConDetalle,
  type CasosConDetalleRespuesta,
  type ModeloCatalogo,
  type ResultadoDetalle,
} from "../lib/api.js";

const ETIQUETA_DIFICULTAD: Record<string, { texto: string; clase: string }> = {
  simple: { texto: "simple", clase: "bg-azul/15 text-azul" },
  multi_hop: { texto: "multi-hop", clase: "bg-ambar/15 text-ambar" },
  razonamiento: { texto: "razonamiento", clase: "bg-violeta/15 text-violeta" },
};

const UMBRAL_BAJA_CONFIANZA = 0.65;
const UMBRAL_DISCREPANCIA = 0.3;

function resumirInput(input: unknown, profundidad = 0): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && profundidad < 2) {
    const obj = input as Record<string, unknown>;
    if ("documento" in obj) return resumirInput(obj["documento"], profundidad + 1);
    if (typeof obj["resumen"] === "string") return obj["resumen"];
    if (typeof obj["id"] === "string" && Object.keys(obj).length === 1) return obj["id"];
    return JSON.stringify(obj);
  }
  return String(input);
}

function formatearRespuesta(respuesta: unknown): string {
  if (typeof respuesta === "string") return respuesta;
  return JSON.stringify(respuesta, null, 2);
}

function scoreDe(r: ResultadoDetalle): number | null {
  return r.scoreEstructural ?? r.scorePromedio ?? null;
}

function veredictoDe(r: ResultadoDetalle): "paso" | "fallo" | null {
  return r.veredictoJuez ?? r.detalleEstructural?.veredicto ?? null;
}

function razonamientoDe(r: ResultadoDetalle): string | null {
  return r.razonamientoJuez ?? r.detalleEstructural?.razonamiento ?? null;
}

interface Flags {
  algunFallo: boolean;
  bajaConfianza: boolean;
  discrepan: boolean;
}

function calcularFlags(caso: CasoConDetalle): Flags {
  const scores = caso.resultados.map(scoreDe).filter((s): s is number => s !== null);
  const algunFallo = caso.resultados.some((r) => veredictoDe(r) === "fallo");
  const bajaConfianza = caso.resultados.some((r) => r.confianzaJuez !== null && r.confianzaJuez < UMBRAL_BAJA_CONFIANZA);
  const discrepan = scores.length >= 2 && Math.max(...scores) - Math.min(...scores) > UMBRAL_DISCREPANCIA;
  return { algunFallo, bajaConfianza, discrepan };
}

function ScoreBar({ etiqueta, valor }: { etiqueta: string; valor: number | null }) {
  if (valor === null) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-tinta/50">{etiqueta}</span>
      <div className="flex items-center gap-1.5">
        <div className="h-1 w-16 overflow-hidden rounded-full bg-linea">
          <div className="h-full rounded-full bg-tinta/50" style={{ width: `${valor * 100}%` }} />
        </div>
        <span className="w-9 text-right font-mono">{Math.round(valor * 100)}%</span>
      </div>
    </div>
  );
}

function TarjetaModelo({ resultado, nombre }: { resultado: ResultadoDetalle; nombre: string }) {
  const veredicto = veredictoDe(resultado);
  const razonamiento = razonamientoDe(resultado);

  return (
    <div className="min-w-[260px] flex-1 rounded-card border border-linea bg-fondo p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{nombre}</span>
        {veredicto && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${veredicto === "paso" ? "bg-marca text-white" : "bg-coral/15 text-coral"}`}>
            {veredicto === "paso" ? "pasó" : "falló"}
          </span>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-tinta/80">{formatearRespuesta(resultado.respuesta)}</p>

      {resultado.detalleEstructural && (
        <div className="mt-3 space-y-1 border-t border-linea pt-2">
          {resultado.detalleEstructural.campos.map((c) => (
            <div key={c.clave} className="flex items-center justify-between text-xs">
              <span className="font-mono text-tinta/50">{c.clave}</span>
              <span className={c.puntaje >= 1 ? "text-marca" : c.puntaje > 0 ? "text-ambar" : "text-coral"}>
                {c.puntaje >= 1 ? "✓" : c.puntaje > 0 ? `~${Math.round(c.puntaje * 100)}%` : "✗"} {c.obtenido ?? "(faltante)"}
              </span>
            </div>
          ))}
        </div>
      )}

      {(resultado.scoreGroundedness !== null || resultado.scoreRelevancia !== null || resultado.scoreCompletitud !== null) && (
        <div className="mt-3 space-y-1 border-t border-linea pt-2">
          <ScoreBar etiqueta="groundedness" valor={resultado.scoreGroundedness} />
          <ScoreBar etiqueta="relevancia" valor={resultado.scoreRelevancia} />
          <ScoreBar etiqueta="completitud" valor={resultado.scoreCompletitud} />
          {resultado.confianzaJuez !== null && <ScoreBar etiqueta="confianza del juez" valor={resultado.confianzaJuez} />}
        </div>
      )}

      {razonamiento && <p className="mt-3 border-t border-linea pt-2 text-xs italic text-tinta/60">{razonamiento}</p>}

      <div className="mt-3 flex justify-between border-t border-linea pt-2 font-mono text-xs text-tinta/50">
        <span>{resultado.latenciaMs} ms</span>
        <span>${resultado.costoEstimadoUsd.toFixed(6)}</span>
      </div>
    </div>
  );
}

function FilaCaso({ caso, nombresPorModelo, indice }: { caso: CasoConDetalle; nombresPorModelo: Record<string, string>; indice: number }) {
  const [abierto, setAbierto] = useState(false);
  const flags = calcularFlags(caso);
  const dificultad = caso.dificultad ? ETIQUETA_DIFICULTAD[caso.dificultad] : null;

  return (
    <div className={`rounded-card border bg-superficie shadow-sutil ${flags.algunFallo ? "border-coral/40" : flags.discrepan || flags.bajaConfianza ? "border-ambar/40" : "border-linea"}`}>
      <button onClick={() => setAbierto((v) => !v)} className="flex w-full items-start justify-between gap-3 p-4 text-left">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-tinta/40">#{indice + 1}</span>
            {dificultad && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${dificultad.clase}`}>{dificultad.texto}</span>}
            {caso.documentosFuente && caso.documentosFuente.length > 0 && (
              <span className="text-xs text-tinta/40">
                de: {caso.documentosFuente.map((d) => d.titulo).join(", ")}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium">{resumirInput(caso.input)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {flags.algunFallo && <span className="rounded-full bg-coral/15 px-2 py-0.5 text-xs font-medium text-coral">falló</span>}
          {flags.bajaConfianza && <span className="rounded-full bg-ambar/15 px-2 py-0.5 text-xs font-medium text-ambar">baja confianza</span>}
          {flags.discrepan && <span className="rounded-full bg-violeta/15 px-2 py-0.5 text-xs font-medium text-violeta">discrepancia</span>}
          <span className="text-tinta/40">{abierto ? "▲" : "▼"}</span>
        </div>
      </button>

      {abierto && (
        <div className="border-t border-linea p-4">
          {caso.respuestaEsperadaProvisional && (
            <div className="mb-3 rounded-card bg-marca-tinte p-3 text-sm">
              <p className="text-xs font-medium text-marca">Respuesta esperada (provisional)</p>
              <p className="mt-1 text-tinta/80">{caso.respuestaEsperadaProvisional}</p>
            </div>
          )}
          {caso.documentosFuente && caso.documentosFuente.length > 0 && (
            <div className="mb-3 rounded-card bg-fondo p-3 text-sm">
              <p className="text-xs font-medium text-tinta/50">Contexto recuperado</p>
              {caso.documentosFuente.map((d) => (
                <p key={d.id} className="mt-1 text-tinta/70">
                  <span className="font-medium">{d.titulo}:</span> {d.contenido}
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {caso.resultados.map((r) => (
              <TarjetaModelo key={r.resultadoId} resultado={r} nombre={nombresPorModelo[r.modelo] ?? r.modelo} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Filtro = "fallo" | "baja_confianza" | "discrepancia";

interface Props {
  casoId: string;
  corridaId: string;
  onVolver: () => void;
}

export function DetalleCasos({ casoId, corridaId, onVolver }: Props) {
  const [datos, setDatos] = useState<CasosConDetalleRespuesta | null>(null);
  const [catalogo, setCatalogo] = useState<ModeloCatalogo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Set<Filtro>>(new Set());

  useEffect(() => {
    Promise.all([obtenerCasosDetalle(casoId, corridaId), obtenerCatalogo()])
      .then(([d, c]) => {
        setDatos(d);
        setCatalogo(c);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }, [casoId, corridaId]);

  const nombresPorModelo = useMemo(() => Object.fromEntries(catalogo.map((m) => [m.id, m.nombre])), [catalogo]);

  const casosFiltrados = useMemo(() => {
    if (!datos) return [];
    if (filtros.size === 0) return datos.casos;
    return datos.casos.filter((caso) => {
      const flags = calcularFlags(caso);
      if (filtros.has("fallo") && !flags.algunFallo) return false;
      if (filtros.has("baja_confianza") && !flags.bajaConfianza) return false;
      if (filtros.has("discrepancia") && !flags.discrepan) return false;
      return true;
    });
  }, [datos, filtros]);

  function toggleFiltro(f: Filtro) {
    setFiltros((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  if (error) {
    return <div className="rounded-card border border-coral/30 bg-coral/5 p-4 text-sm text-coral">{error}</div>;
  }

  return (
    <div>
      <button onClick={onVolver} className="text-sm text-tinta/50 hover:text-tinta">
        ← Volver
      </button>

      <h1 className="mt-4 font-display text-3xl font-medium">Set de pruebas y resultados</h1>
      <p className="mt-1 text-tinta/60">
        {datos ? `${datos.casos.length} casos generados × ${datos.numModelos} modelos.` : "Cargando…"} Cada pregunta muestra de qué documento del
        knowledge base salió — esa trazabilidad es el dato que valida la evaluación.
      </p>

      {datos && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => toggleFiltro("fallo")}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${filtros.has("fallo") ? "border-coral bg-coral/10 text-coral" : "border-linea text-tinta/60 hover:border-coral/40"}`}
          >
            Algún modelo falló
          </button>
          <button
            onClick={() => toggleFiltro("baja_confianza")}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${filtros.has("baja_confianza") ? "border-ambar bg-ambar/10 text-ambar" : "border-linea text-tinta/60 hover:border-ambar/40"}`}
          >
            Baja confianza del juez
          </button>
          <button
            onClick={() => toggleFiltro("discrepancia")}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${filtros.has("discrepancia") ? "border-violeta bg-violeta/10 text-violeta" : "border-linea text-tinta/60 hover:border-violeta/40"}`}
          >
            Los modelos discrepan
          </button>
          {filtros.size > 0 && (
            <button onClick={() => setFiltros(new Set())} className="rounded-full px-3 py-1.5 text-xs text-tinta/40 hover:text-tinta/70">
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto self-center text-xs text-tinta/40">
            {casosFiltrados.length} de {datos.casos.length} casos
          </span>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {casosFiltrados.map((caso, i) => (
          <FilaCaso key={caso.casoPruebaId} caso={caso} nombresPorModelo={nombresPorModelo} indice={datos!.casos.indexOf(caso)} />
        ))}
        {datos && casosFiltrados.length === 0 && (
          <div className="rounded-card border border-dashed border-linea p-10 text-center text-sm text-tinta/60">
            Ningún caso coincide con los filtros elegidos.
          </div>
        )}
      </div>
    </div>
  );
}
