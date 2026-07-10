import { useState } from "react";

const SNIPPETS: Record<string, { etiqueta: string; codigo: string }> = {
  rag: {
    etiqueta: "Patrón A — bot RAG",
    codigo: `import { probe } from "@vectora/probe";

async function responderConsulta(pregunta, ctx) {
  const docs = await miVectorStore.buscar(pregunta, { k: 5 });
  const prompt = construirPrompt(pregunta, docs);
  const respuesta = await probe.wrap(ctx, (modelo) =>
    miClienteLLM.completar({ modelo, prompt }));
  return { respuesta, contextoRecuperado: docs };
}
probe.register(responderConsulta);`,
  },
  estructural: {
    etiqueta: "Patrón B — extracción/clasificación",
    codigo: `import { probe } from "@vectora/probe";

async function extraerDatos(input, ctx) {
  const prompt = \`Extrae los campos relevantes:\\n\${input.documento}\`;
  const json = await probe.wrap(ctx, (modelo) =>
    miClienteLLM.completarJSON({ modelo, prompt }));
  return { respuesta: json };
}
probe.register(extraerDatos);`,
  },
  api: {
    etiqueta: "Patrón C — sistema detrás de una API HTTP",
    codigo: `import { probe } from "@vectora/probe";

async function responderViaAPI(pregunta, ctx) {
  const modelo = probe.modeloActual(ctx);
  const r = await fetch("https://mi-backend.interno/chat", {
    method: "POST", body: JSON.stringify({ pregunta, modelo }) });
  const data = await r.json();
  return { respuesta: data.texto, contextoRecuperado: data.contexto };
}
probe.register(responderViaAPI);`,
  },
};

export function SnippetProbe({ tipoSugerido }: { tipoSugerido: "rag" | "estructural" }) {
  const [activo, setActivo] = useState<keyof typeof SNIPPETS>(tipoSugerido);
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    await navigator.clipboard.writeText(SNIPPETS[activo]!.codigo);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  return (
    <div className="rounded-card border border-linea bg-tinta text-fondo">
      <div className="flex items-center justify-between border-b border-fondo/10 px-3 py-2">
        <div className="flex gap-1">
          {(Object.keys(SNIPPETS) as (keyof typeof SNIPPETS)[]).map((key) => (
            <button
              key={key}
              onClick={() => setActivo(key)}
              className={`rounded px-2 py-1 text-xs ${activo === key ? "bg-fondo/15 text-fondo" : "text-fondo/50 hover:text-fondo/80"}`}
            >
              {SNIPPETS[key]!.etiqueta}
            </button>
          ))}
        </div>
        <button onClick={copiar} className="rounded bg-fondo/10 px-2 py-1 text-xs hover:bg-fondo/20">
          {copiado ? "¡Copiado!" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">{SNIPPETS[activo]!.codigo}</pre>
    </div>
  );
}
