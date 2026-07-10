import { useState } from "react";

const TIPOS_TAREA: { valor: string; etiqueta: string; ayuda: string }[] = [
  { valor: "rag", etiqueta: "RAG", ayuda: "Responde preguntas usando un knowledge base propio." },
  { valor: "soporte_conversacional", etiqueta: "Soporte conversacional", ayuda: "Bot de atención al cliente, con o sin retrieval." },
  { valor: "extraccion", etiqueta: "Extracción", ayuda: "Extrae campos estructurados de documentos existentes." },
  { valor: "clasificacion", etiqueta: "Clasificación", ayuda: "Clasifica documentos o transacciones existentes." },
  { valor: "generacion", etiqueta: "Generación", ayuda: "Genera o resume contenido a partir de un documento existente." },
];

export interface DatosCasoDeUso {
  nombre: string;
  descripcion: string;
  tipoTarea: string;
  dominio: string;
  volumenMensual?: number;
  modeloProduccion?: string;
  costoMensualProduccion?: number;
}

interface Props {
  onSiguiente: (datos: DatosCasoDeUso) => void;
  enviando: boolean;
  error: string | null;
}

export function PasoCasoDeUso({ onSiguiente, enviando, error }: Props) {
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [tipoTarea, setTipoTarea] = useState("rag");
  const [dominio, setDominio] = useState("");
  const [volumenMensual, setVolumenMensual] = useState("");
  const [modeloProduccion, setModeloProduccion] = useState("");
  const [costoMensualProduccion, setCostoMensualProduccion] = useState("");

  const puedeContinuar = nombre.trim().length > 0 && descripcion.trim().length > 0 && dominio.trim().length > 0;

  return (
    <div className="space-y-5">
      <div>
        <label className="text-sm font-medium">Nombre del caso de uso</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Bot de soporte al cliente"
          className="mt-1 w-full rounded-card border border-linea bg-superficie px-3 py-2 text-sm outline-none focus:border-marca"
        />
      </div>

      <div>
        <label className="text-sm font-medium">Descripción</label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={3}
          placeholder="¿Qué hace este sistema? ¿Quién lo usa?"
          className="mt-1 w-full rounded-card border border-linea bg-superficie px-3 py-2 text-sm outline-none focus:border-marca"
        />
      </div>

      <div>
        <label className="text-sm font-medium">Tipo de tarea</label>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TIPOS_TAREA.map((t) => (
            <button
              key={t.valor}
              type="button"
              onClick={() => setTipoTarea(t.valor)}
              className={`rounded-card border p-3 text-left text-sm transition ${
                tipoTarea === t.valor ? "border-marca bg-marca-tinte" : "border-linea bg-superficie hover:border-marca/40"
              }`}
            >
              <div className="font-medium">{t.etiqueta}</div>
              <div className="mt-0.5 text-xs text-tinta/60">{t.ayuda}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">Dominio</label>
          <input
            value={dominio}
            onChange={(e) => setDominio(e.target.value)}
            placeholder="Ej: soporte_fintech, legal"
            className="mt-1 w-full rounded-card border border-linea bg-superficie px-3 py-2 text-sm outline-none focus:border-marca"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Volumen mensual (opcional)</label>
          <input
            value={volumenMensual}
            onChange={(e) => setVolumenMensual(e.target.value)}
            type="number"
            placeholder="Ej: 38000"
            className="mt-1 w-full rounded-card border border-linea bg-superficie px-3 py-2 text-sm outline-none focus:border-marca"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">Modelo actual en producción (opcional)</label>
          <input
            value={modeloProduccion}
            onChange={(e) => setModeloProduccion(e.target.value)}
            placeholder="Ej: gpt-4o"
            className="mt-1 w-full rounded-card border border-linea bg-superficie px-3 py-2 text-sm outline-none focus:border-marca"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Costo mensual actual USD (opcional)</label>
          <input
            value={costoMensualProduccion}
            onChange={(e) => setCostoMensualProduccion(e.target.value)}
            type="number"
            placeholder="Ej: 850"
            className="mt-1 w-full rounded-card border border-linea bg-superficie px-3 py-2 text-sm outline-none focus:border-marca"
          />
        </div>
      </div>

      {error && <div className="rounded-card border border-coral/30 bg-coral/5 p-3 text-sm text-coral">{error}</div>}

      <div className="flex justify-end">
        <button
          disabled={!puedeContinuar || enviando}
          onClick={() =>
            onSiguiente({
              nombre: nombre.trim(),
              descripcion: descripcion.trim(),
              tipoTarea,
              dominio: dominio.trim(),
              volumenMensual: volumenMensual ? Number(volumenMensual) : undefined,
              modeloProduccion: modeloProduccion.trim() || undefined,
              costoMensualProduccion: costoMensualProduccion ? Number(costoMensualProduccion) : undefined,
            })
          }
          className="rounded-card bg-marca px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {enviando ? "Creando…" : "Continuar"}
        </button>
      </div>
    </div>
  );
}
