/**
 * Heurística de sugerencia de modelos para el paso 2 del stepper (Módulo 1).
 *
 * Este es el ÚNICO punto de contacto para la sugerencia de panel. Hoy son
 * reglas simples por tipo de tarea/riesgo/volumen; el día que la sugerencia
 * pase a ser data-driven (entrenada sobre qué modelo ganó históricamente en
 * casos similares), se reemplaza el cuerpo de esta función y nada más —
 * la UI y el resto del motor no la conocen por dentro, solo su firma.
 */

export interface CasoDeUsoParaSugerencia {
  tipoTarea: string;
  nombre: string;
  descripcion: string;
  volumenMensual?: number | null;
}

const REGEX_ALTO_RIESGO = /legal|salud|m[eé]dic|cr[eé]dito|fraude|compliance|regulat|normativ/i;
const REGEX_ALTO_VOLUMEN = /soporte|masivo|alto volumen|call ?center|mesa de ayuda/i;

export function sugerirModelos(caso: CasoDeUsoParaSugerencia): string[] {
  const texto = `${caso.nombre} ${caso.descripcion}`;
  const altoRiesgo = REGEX_ALTO_RIESGO.test(texto);
  const altoVolumen = (caso.volumenMensual ?? 0) > 5000 || REGEX_ALTO_VOLUMEN.test(texto);

  if (altoRiesgo) {
    // Tarea de alto riesgo: prioriza precisión máxima, con un intermedio de respaldo para comparar costo.
    return ["gpt-4o", "claude-3-5-sonnet", "gemini-1-5-flash"];
  }

  if (altoVolumen) {
    // Alto volumen: prioriza baratos-suficientes + una alternativa open-weights.
    return ["gpt-4o-mini", "gemini-1-5-flash", "llama-3-1-70b"];
  }

  // Caso general: un intermedio, un barato, y el frontera como techo de comparación.
  return ["claude-3-5-sonnet", "gpt-4o-mini", "gpt-4o"];
}
