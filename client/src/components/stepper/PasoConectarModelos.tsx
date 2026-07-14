import { useEffect, useMemo, useState } from "react";
import { SnippetProbe } from "./SnippetProbe.js";
import {
  estimarCosto,
  obtenerCatalogo,
  sugerirModelosApi,
  verificarConexion,
  type DocumentoExistenteInput,
  type EstimacionCosto,
  type KbDocInput,
  type ModeloCatalogo,
} from "../../lib/api.js";

const KB_EJEMPLO: KbDocInput[] = [
  { titulo: "Política de devoluciones", contenido: "Las devoluciones de transferencias mal dirigidas se procesan en un plazo máximo de 5 días hábiles desde que el usuario reporta el error en la app." },
  { titulo: "Bloqueo y reposición de tarjetas", contenido: "Una tarjeta se bloquea automáticamente tras 3 intentos fallidos de clave. La reposición física demora entre 5 y 7 días hábiles, sin costo la primera vez al año." },
  { titulo: "Límites de transferencia", contenido: "El límite diario de transferencias para cuentas verificadas es de 5.000.000 CLP. Sin verificación completa, el límite es de 500.000 CLP diarios." },
];

interface DocExistenteForm {
  documentoTexto: string;
  campos: { clave: string; valor: string }[];
}

const DOCS_EJEMPLO: DocExistenteForm[] = [
  { documentoTexto: "Factura N°1023, RUT 76.123.456-7, monto $150.000, fecha 05-01-2026", campos: [{ clave: "rut", valor: "76.123.456-7" }, { clave: "monto", valor: "150000" }, { clave: "folio", valor: "1023" }] },
  { documentoTexto: "Factura N°1024, RUT 77.998.111-2, monto $89.500, fecha 06-01-2026", campos: [{ clave: "rut", valor: "77.998.111-2" }, { clave: "monto", valor: "89500" }, { clave: "folio", valor: "1024" }] },
];

export interface DatosConexionModelos {
  probeUrl: string;
  modelos: string[];
  kbDocs?: KbDocInput[];
  documentosExistentes?: DocumentoExistenteInput[];
}

interface Props {
  casoId: string;
  tipoTarea: string;
  requiereGenerador: boolean;
  nombre: string;
  descripcion: string;
  volumenMensual?: number;
  onSiguiente: (datos: DatosConexionModelos) => void;
  onVolver: () => void;
}

export function PasoConectarModelos({ casoId, tipoTarea, requiereGenerador, nombre, descripcion, volumenMensual, onSiguiente, onVolver }: Props) {
  const [probeUrl, setProbeUrl] = useState(requiereGenerador ? "http://localhost:4501" : "http://localhost:4502");
  const [verificando, setVerificando] = useState(false);
  const [verificado, setVerificado] = useState(false);
  const [nombreSistema, setNombreSistema] = useState<string | null>(null);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);

  const [catalogo, setCatalogo] = useState<ModeloCatalogo[]>([]);
  const [sugeridos, setSugeridos] = useState<string[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [estimacion, setEstimacion] = useState<EstimacionCosto | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);

  const [kbDocs, setKbDocs] = useState<KbDocInput[]>([]);
  const [docsExistentes, setDocsExistentes] = useState<DocExistenteForm[]>([]);

  useEffect(() => {
    obtenerCatalogo()
      .then(setCatalogo)
      .catch((err) => setErrorCatalogo(err instanceof Error ? err.message : "No se pudo cargar el catálogo de modelos."));
    sugerirModelosApi({ tipoTarea, nombre, descripcion, volumenMensual })
      .then((s) => {
        setSugeridos(s);
        setSeleccionados(new Set(s));
      })
      .catch(() => {
        // La sugerencia es un extra de UX, no bloquea el flujo si falla: el usuario igual puede elegir modelos a mano.
      });
  }, [tipoTarea, nombre, descripcion, volumenMensual]);

  const numCasos = requiereGenerador ? 30 : Math.max(docsExistentes.length, 1);

  useEffect(() => {
    if (seleccionados.size === 0) {
      setEstimacion(null);
      return;
    }
    estimarCosto(casoId, [...seleccionados], numCasos).then(setEstimacion).catch(() => setEstimacion(null));
  }, [seleccionados, casoId, numCasos]);

  async function handleVerificar() {
    setVerificando(true);
    setErrorConexion(null);
    const res = await verificarConexion(casoId, probeUrl);
    setVerificando(false);
    if (res.ok) {
      setVerificado(true);
      setNombreSistema(res.nombreSistema ?? null);
    } else {
      setVerificado(false);
      setErrorConexion(res.error ?? "No se pudo verificar la conexión.");
    }
  }

  function toggleModelo(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const insumosListos = requiereGenerador ? kbDocs.length > 0 : docsExistentes.length > 0;
  const puedeContinuar = verificado && seleccionados.size >= 2 && insumosListos;

  const documentosExistentesPayload: DocumentoExistenteInput[] = useMemo(
    () =>
      docsExistentes.map((d) => ({
        input: { documento: d.documentoTexto },
        esperado: Object.fromEntries(d.campos.filter((c) => c.clave.trim()).map((c) => [c.clave.trim(), c.valor])),
      })),
    [docsExistentes]
  );

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display text-xl font-medium">1. Instala el SDK y declara tus ganchos</h2>
        <p className="mt-1 text-sm text-tinta/60">
          <code className="rounded bg-marca-tinte px-1.5 py-0.5 font-mono text-xs text-marca">npm install @vectora/probe</code> en el proyecto de tu
          sistema, y declara <code className="font-mono text-xs">register</code> + <code className="font-mono text-xs">completar</code> según tu
          patrón — el gateway de Vectora hace la llamada real al modelo, no necesitas tu propia API key de proveedor:
        </p>
        <div className="mt-3">
          <SnippetProbe tipoSugerido={requiereGenerador ? "rag" : "estructural"} />
        </div>
      </section>

      <section>
        <h2 className="font-display text-xl font-medium">2. Conecta tu sistema</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={probeUrl}
            onChange={(e) => {
              setProbeUrl(e.target.value);
              setVerificado(false);
            }}
            placeholder="http://localhost:4501"
            className="flex-1 rounded-card border border-linea bg-superficie px-3 py-2 font-mono text-sm outline-none focus:border-marca"
          />
          <button
            onClick={handleVerificar}
            disabled={verificando || !probeUrl}
            className="whitespace-nowrap rounded-card border border-linea px-4 py-2 text-sm font-medium hover:border-marca disabled:opacity-40"
          >
            {verificando ? "Verificando…" : "Verificar conexión"}
          </button>
        </div>
        {verificado && (
          <p className="mt-2 text-sm text-marca">✓ Conectado{nombreSistema ? ` a "${nombreSistema}"` : ""}. La función registrada respondió correctamente.</p>
        )}
        {errorConexion && <p className="mt-2 text-sm text-coral">{errorConexion}</p>}
      </section>

      <section>
        <h2 className="font-display text-xl font-medium">3. {requiereGenerador ? "Knowledge base" : "Documentos existentes con respuesta conocida"}</h2>
        <p className="mt-1 text-sm text-tinta/60">
          {requiereGenerador
            ? "El agente generador lee estos documentos y produce ~30 preguntas realistas con dificultad escalonada."
            : "Cada documento necesita su respuesta ya verificada, para poder comparar el resultado de cada modelo contra ella."}
        </p>

        {requiereGenerador ? (
          <div className="mt-3 space-y-3">
            {kbDocs.map((doc, i) => (
              <div key={i} className="rounded-card border border-linea p-3">
                <div className="flex items-center justify-between gap-2">
                  <input
                    value={doc.titulo}
                    onChange={(e) => setKbDocs((prev) => prev.map((d, idx) => (idx === i ? { ...d, titulo: e.target.value } : d)))}
                    placeholder="Título del documento"
                    className="flex-1 rounded border border-linea px-2 py-1 text-sm font-medium outline-none focus:border-marca"
                  />
                  <button onClick={() => setKbDocs((prev) => prev.filter((_, idx) => idx !== i))} className="text-xs text-coral">
                    quitar
                  </button>
                </div>
                <textarea
                  value={doc.contenido}
                  onChange={(e) => setKbDocs((prev) => prev.map((d, idx) => (idx === i ? { ...d, contenido: e.target.value } : d)))}
                  rows={2}
                  placeholder="Contenido del documento"
                  className="mt-2 w-full rounded border border-linea px-2 py-1 text-sm outline-none focus:border-marca"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button
                onClick={() => setKbDocs((prev) => [...prev, { titulo: "", contenido: "" }])}
                className="rounded-card border border-dashed border-linea px-3 py-1.5 text-sm hover:border-marca/40"
              >
                + Agregar documento
              </button>
              <button onClick={() => setKbDocs(KB_EJEMPLO)} className="rounded-card px-3 py-1.5 text-sm text-marca hover:underline">
                Usar KB de ejemplo
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {docsExistentes.map((doc, i) => (
              <div key={i} className="rounded-card border border-linea p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-tinta/50">Documento {i + 1}</span>
                  <button onClick={() => setDocsExistentes((prev) => prev.filter((_, idx) => idx !== i))} className="text-xs text-coral">
                    quitar
                  </button>
                </div>
                <textarea
                  value={doc.documentoTexto}
                  onChange={(e) => setDocsExistentes((prev) => prev.map((d, idx) => (idx === i ? { ...d, documentoTexto: e.target.value } : d)))}
                  rows={2}
                  placeholder="Texto o descripción del documento"
                  className="mt-2 w-full rounded border border-linea px-2 py-1 text-sm outline-none focus:border-marca"
                />
                <div className="mt-2 space-y-1">
                  {doc.campos.map((c, ci) => (
                    <div key={ci} className="flex gap-2">
                      <input
                        value={c.clave}
                        onChange={(e) =>
                          setDocsExistentes((prev) =>
                            prev.map((d, idx) => (idx === i ? { ...d, campos: d.campos.map((cc, cci) => (cci === ci ? { ...cc, clave: e.target.value } : cc)) } : d))
                          )
                        }
                        placeholder="campo (ej: rut)"
                        className="w-1/3 rounded border border-linea px-2 py-1 font-mono text-xs outline-none focus:border-marca"
                      />
                      <input
                        value={c.valor}
                        onChange={(e) =>
                          setDocsExistentes((prev) =>
                            prev.map((d, idx) => (idx === i ? { ...d, campos: d.campos.map((cc, cci) => (cci === ci ? { ...cc, valor: e.target.value } : cc)) } : d))
                          )
                        }
                        placeholder="valor esperado"
                        className="flex-1 rounded border border-linea px-2 py-1 font-mono text-xs outline-none focus:border-marca"
                      />
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setDocsExistentes((prev) => prev.map((d, idx) => (idx === i ? { ...d, campos: [...d.campos, { clave: "", valor: "" }] } : d)))
                    }
                    className="text-xs text-marca hover:underline"
                  >
                    + campo esperado
                  </button>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button
                onClick={() => setDocsExistentes((prev) => [...prev, { documentoTexto: "", campos: [{ clave: "", valor: "" }] }])}
                className="rounded-card border border-dashed border-linea px-3 py-1.5 text-sm hover:border-marca/40"
              >
                + Agregar documento
              </button>
              <button onClick={() => setDocsExistentes(DOCS_EJEMPLO)} className="rounded-card px-3 py-1.5 text-sm text-marca hover:underline">
                Usar ejemplos de muestra
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display text-xl font-medium">4. Elige los modelos a comparar</h2>
        <p className="mt-1 text-sm text-tinta/60">Mínimo 2. Los marcados con borde vienen sugeridos para este tipo de caso.</p>
        {errorCatalogo && <div className="mt-3 rounded-card border border-coral/30 bg-coral/5 p-3 text-sm text-coral">{errorCatalogo}</div>}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {catalogo.map((m) => {
            const marcado = seleccionados.has(m.id);
            const esSugerido = sugeridos.includes(m.id);
            return (
              <label
                key={m.id}
                className={`flex cursor-pointer items-start gap-2 rounded-card border p-3 text-sm ${
                  marcado ? "border-marca bg-marca-tinte" : esSugerido ? "border-marca/40" : "border-linea"
                }`}
              >
                <input type="checkbox" checked={marcado} onChange={() => toggleModelo(m.id)} className="mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.nombre}</span>
                    {esSugerido && <span className="rounded-full bg-marca px-1.5 py-0.5 text-[10px] font-medium text-white">sugerido</span>}
                    {m.openWeights && <span className="rounded-full bg-violeta/15 px-1.5 py-0.5 text-[10px] font-medium text-violeta">open</span>}
                  </div>
                  <div className="font-mono text-xs text-tinta/50">
                    {m.proveedor} · ${m.precioPor1KUsd}/1K · {m.tier}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {estimacion && (
          <div className="mt-4 rounded-card border border-linea bg-fondo p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-tinta/60">Costo estimado de la corrida</span>
              <span className="font-mono text-lg font-medium">${estimacion.costoTotalUsd.toFixed(2)} USD</span>
            </div>
            <p className="mt-1 text-xs text-tinta/50">
              {estimacion.numCasos} casos × {estimacion.numModelos} modelos
            </p>
          </div>
        )}
      </section>

      <div className="flex justify-between">
        <button onClick={onVolver} className="rounded-card border border-linea px-5 py-2 text-sm font-medium hover:border-marca/40">
          Volver
        </button>
        <button
          disabled={!puedeContinuar}
          onClick={() =>
            onSiguiente({
              probeUrl,
              modelos: [...seleccionados],
              kbDocs: requiereGenerador ? kbDocs : undefined,
              documentosExistentes: requiereGenerador ? undefined : documentosExistentesPayload,
            })
          }
          className="rounded-card bg-marca px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}
