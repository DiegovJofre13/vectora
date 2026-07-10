import { useEffect, useState } from "react";
import {
  obtenerPendientesCalibracion,
  obtenerResumenCalibracion,
  registrarCalibracion,
  type PendienteCalibracion,
  type ResumenCalibracionDominio,
} from "../lib/api.js";

function nivelDeDuda(confianza: number): { texto: string; color: string } {
  if (confianza < 0.4) return { texto: "duda alta", color: "bg-coral/15 text-coral" };
  if (confianza < 0.55) return { texto: "duda media", color: "bg-ambar/15 text-ambar" };
  return { texto: "duda leve", color: "bg-azul/15 text-azul" };
}

function ScoreMini({ etiqueta, valor }: { etiqueta: string; valor: number | null }) {
  if (valor === null) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-tinta/50">{etiqueta}</span>
      <div className="flex items-center gap-1.5">
        <div className="h-1 w-16 overflow-hidden rounded-full bg-linea">
          <div className="h-full rounded-full bg-tinta/50" style={{ width: `${valor * 100}%` }} />
        </div>
        <span className="font-mono">{Math.round(valor * 100)}%</span>
      </div>
    </div>
  );
}

function TarjetaPendiente({ item, onResuelto }: { item: PendienteCalibracion; onResuelto: () => void }) {
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [textoCorregido, setTextoCorregido] = useState(item.provisionalExpected);
  const [enviando, setEnviando] = useState(false);
  const duda = nivelDeDuda(item.confidence);

  async function marcarCorrecta() {
    setEnviando(true);
    await registrarCalibracion(item.resultadoModeloId, "correcta");
    onResuelto();
  }

  async function guardarCorreccion() {
    setEnviando(true);
    await registrarCalibracion(item.resultadoModeloId, "corregida", textoCorregido);
    onResuelto();
  }

  return (
    <div className="rounded-card border border-linea bg-superficie p-5 shadow-sutil">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{item.question}</p>
          <p className="mt-0.5 font-mono text-xs text-tinta/50">
            {item.casoDeUsoNombre} · modelo: {item.modelo}
          </p>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${duda.color}`}>
          {duda.texto} ({Math.round(item.confidence * 100)}%)
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-card bg-fondo p-3">
          <p className="text-xs font-medium text-tinta/50">Contexto recuperado</p>
          <p className="mt-1 max-h-24 overflow-y-auto text-xs text-tinta/70">{item.context || "—"}</p>
        </div>
        <div className="rounded-card bg-fondo p-3">
          <p className="text-xs font-medium text-tinta/50">Respuesta del sistema</p>
          <p className="mt-1 max-h-24 overflow-y-auto text-xs text-tinta/70">{item.systemAnswer}</p>
        </div>
      </div>

      <div className="mt-3 rounded-card bg-fondo p-3">
        <p className="text-xs font-medium text-tinta/50">Veredicto del juez</p>
        <div className="mt-2 space-y-1">
          <ScoreMini etiqueta="groundedness" valor={item.judgeVerdict.groundedness} />
          <ScoreMini etiqueta="relevancia" valor={item.judgeVerdict.relevancia} />
          <ScoreMini etiqueta="completitud" valor={item.judgeVerdict.completitud} />
        </div>
      </div>

      {!corrigiendo ? (
        <div className="mt-4 flex gap-2">
          <button
            onClick={marcarCorrecta}
            disabled={enviando}
            className="rounded-card bg-marca px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Es correcta
          </button>
          <button
            onClick={() => setCorrigiendo(true)}
            disabled={enviando}
            className="rounded-card border border-linea px-4 py-2 text-sm font-medium hover:border-marca/40 disabled:opacity-40"
          >
            Corregir
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <label className="text-xs font-medium text-tinta/60">Respuesta correcta</label>
          <textarea
            value={textoCorregido}
            onChange={(e) => setTextoCorregido(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-card border border-linea px-3 py-2 text-sm outline-none focus:border-marca"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={guardarCorreccion}
              disabled={enviando}
              className="rounded-card bg-marca px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Guardar corrección
            </button>
            <button onClick={() => setCorrigiendo(false)} className="rounded-card border border-linea px-4 py-2 text-sm font-medium">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Calibracion() {
  const [pendientes, setPendientes] = useState<PendienteCalibracion[] | null>(null);
  const [resumen, setResumen] = useState<ResumenCalibracionDominio[]>([]);
  const [error, setError] = useState<string | null>(null);

  function cargar() {
    Promise.all([obtenerPendientesCalibracion(), obtenerResumenCalibracion()])
      .then(([p, r]) => {
        setPendientes(p);
        setResumen(r);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }

  useEffect(cargar, []);

  const totalCalibrados = resumen.reduce((acc, r) => acc + r.calibrados, 0);
  const promedioAcuerdo = resumen.length > 0 ? resumen.reduce((acc, r) => acc + r.porcentajeAcuerdo * r.calibrados, 0) / Math.max(totalCalibrados, 1) : 0;

  return (
    <div>
      <h1 className="font-display text-3xl font-medium">Calibrar el juez</h1>
      <p className="mt-1 text-tinta/60">
        Solo los juicios de baja confianza (&lt;65%) necesitan revisión humana. Cada corrección persiste ligada al dominio y alimenta la
        calibración futura del juez.
      </p>

      {error && <div className="mt-6 rounded-card border border-coral/30 bg-coral/5 p-4 text-sm text-coral">{error}</div>}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <TarjetaResumen etiqueta="Juicios calibrados" valor={String(totalCalibrados)} />
        <TarjetaResumen etiqueta="Acuerdo juez-experto" valor={`${promedioAcuerdo.toFixed(1)}%`} />
        <TarjetaResumen etiqueta="Pendientes ahora" valor={String(pendientes?.length ?? "—")} />
        <TarjetaResumen etiqueta="Dominios calibrados" valor={String(resumen.length)} />
      </div>

      {resumen.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-card border border-linea bg-superficie">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-linea text-left text-xs text-tinta/50">
                <th className="px-4 py-2 font-medium">Dominio</th>
                <th className="px-4 py-2 font-medium">Calibrados</th>
                <th className="px-4 py-2 font-medium">Pendientes</th>
                <th className="px-4 py-2 font-medium">% acuerdo</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => (
                <tr key={r.dominio} className="border-b border-linea last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{r.dominio}</td>
                  <td className="px-4 py-2">{r.calibrados}</td>
                  <td className="px-4 py-2">{r.pendientes}</td>
                  <td className="px-4 py-2">{r.porcentajeAcuerdo}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 font-display text-xl font-medium">Cola de calibración</h2>

      {pendientes && pendientes.length === 0 && (
        <div className="mt-4 rounded-card border border-dashed border-linea p-10 text-center text-sm text-tinta/60">
          No hay juicios de baja confianza pendientes de calibrar en este momento.
        </div>
      )}

      <div className="mt-4 space-y-4">
        {pendientes?.map((item) => (
          <TarjetaPendiente key={item.resultadoModeloId} item={item} onResuelto={cargar} />
        ))}
      </div>
    </div>
  );
}

function TarjetaResumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-card border border-linea bg-superficie p-4 shadow-sutil">
      <div className="text-xs text-tinta/50">{etiqueta}</div>
      <div className="font-mono text-xl font-medium">{valor}</div>
    </div>
  );
}
