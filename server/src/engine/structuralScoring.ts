/**
 * Scoring estructural para extracción/clasificación: determinista, campo por
 * campo, sin juez LLM salvo para campos declarados como ambiguos (ej. un
 * resumen), donde se usa similitud léxica en vez de igualdad exacta. Más
 * barato y más confiable que un juez para este tipo de tarea.
 */

function normalizarValor(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function similitudTexto(a: string, b: string): number {
  const wa = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const wb = new Set(b.split(/\s+/).filter((w) => w.length > 2));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let interseccion = 0;
  for (const w of wa) if (wb.has(w)) interseccion++;
  return interseccion / new Set([...wa, ...wb]).size;
}

export interface OpcionesScoringEstructural {
  /** Valores esperados por campo. */
  camposEsperados: Record<string, unknown>;
  /** Campos que se comparan por similitud de texto en vez de igualdad exacta (ej. "resumen", "motivo"). */
  camposAmbiguos?: string[];
}

export function scoreEstructural(respuestaModelo: unknown, opciones: OpcionesScoringEstructural): number {
  const claves = Object.keys(opciones.camposEsperados);
  if (claves.length === 0) return 0;

  if (typeof respuestaModelo !== "object" || respuestaModelo === null || Array.isArray(respuestaModelo)) {
    return 0; // se esperaba un objeto estructurado y no llegó
  }

  const respuesta = respuestaModelo as Record<string, unknown>;
  const ambiguos = new Set(opciones.camposAmbiguos ?? []);

  let puntos = 0;
  for (const clave of claves) {
    if (!(clave in respuesta)) continue; // campo faltante = 0 puntos para ese campo

    const esperado = normalizarValor(opciones.camposEsperados[clave]);
    const obtenido = normalizarValor(respuesta[clave]);

    if (ambiguos.has(clave)) {
      puntos += similitudTexto(esperado, obtenido);
    } else {
      puntos += esperado === obtenido ? 1 : 0;
    }
  }

  return Number((puntos / claves.length).toFixed(3));
}
