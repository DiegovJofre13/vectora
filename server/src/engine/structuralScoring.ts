/**
 * Scoring estructural para extracción/clasificación: determinista, campo por
 * campo, sin juez LLM salvo para campos declarados como ambiguos (ej. un
 * resumen), donde se usa similitud léxica en vez de igualdad exacta. Más
 * barato y más confiable que un juez para este tipo de tarea.
 */

/** Bajo este score, el veredicto binario es "fallo". Más estricto que el del juez: acá casi todo es igualdad exacta. */
const UMBRAL_APROBACION = 0.75;

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

export interface CampoComparado {
  clave: string;
  esperado: string;
  obtenido: string | null;
  esAmbiguo: boolean;
  puntaje: number;
}

export interface DetalleScoringEstructural {
  score: number;
  campos: CampoComparado[];
  veredicto: "paso" | "fallo";
  razonamiento: string;
}

export function scoreEstructuralConDetalle(respuestaModelo: unknown, opciones: OpcionesScoringEstructural): DetalleScoringEstructural {
  const claves = Object.keys(opciones.camposEsperados);
  const ambiguos = new Set(opciones.camposAmbiguos ?? []);

  if (claves.length === 0) {
    return { score: 0, campos: [], veredicto: "fallo", razonamiento: "No hay campos esperados definidos para este caso." };
  }

  const esObjeto = typeof respuestaModelo === "object" && respuestaModelo !== null && !Array.isArray(respuestaModelo);
  if (!esObjeto) {
    return {
      score: 0,
      campos: claves.map((clave) => ({ clave, esperado: normalizarValor(opciones.camposEsperados[clave]), obtenido: null, esAmbiguo: ambiguos.has(clave), puntaje: 0 })),
      veredicto: "fallo",
      razonamiento: "Se esperaba un objeto estructurado y la respuesta del modelo no lo es (llegó texto libre o un tipo distinto).",
    };
  }

  const respuesta = respuestaModelo as Record<string, unknown>;
  const campos: CampoComparado[] = claves.map((clave) => {
    const esAmbiguo = ambiguos.has(clave);
    const esperado = normalizarValor(opciones.camposEsperados[clave]);
    if (!(clave in respuesta)) {
      return { clave, esperado, obtenido: null, esAmbiguo, puntaje: 0 };
    }
    const obtenido = normalizarValor(respuesta[clave]);
    const puntaje = esAmbiguo ? Number(similitudTexto(esperado, obtenido).toFixed(3)) : esperado === obtenido ? 1 : 0;
    return { clave, esperado, obtenido, esAmbiguo, puntaje };
  });

  const score = Number((campos.reduce((acc, c) => acc + c.puntaje, 0) / claves.length).toFixed(3));
  const veredicto: "paso" | "fallo" = score >= UMBRAL_APROBACION ? "paso" : "fallo";

  const faltantes = campos.filter((c) => c.obtenido === null);
  const incorrectos = campos.filter((c) => c.obtenido !== null && c.puntaje < 1);
  const partes: string[] = [];
  if (faltantes.length > 0) partes.push(`Faltaron los campos: ${faltantes.map((c) => c.clave).join(", ")}.`);
  if (incorrectos.length > 0) {
    partes.push(
      incorrectos
        .map((c) => (c.esAmbiguo ? `"${c.clave}" tiene ${Math.round(c.puntaje * 100)}% de similitud con lo esperado` : `"${c.clave}" no coincide (esperado "${c.esperado}", obtuvo "${c.obtenido}")`))
        .join("; ") + "."
    );
  }
  if (partes.length === 0) partes.push("Todos los campos coinciden con lo esperado.");

  return { score, campos, veredicto, razonamiento: partes.join(" ") };
}
