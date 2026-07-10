interface PuntoPareto {
  modelo: string;
  costoPor1KUsd: number;
  precision: number;
  esFrontera: boolean;
  esRecomendado: boolean;
}

interface Props {
  puntos: PuntoPareto[];
  nombresPorModelo: Record<string, string>;
}

const ANCHO = 560;
const ALTO = 300;
const MARGEN = { top: 20, right: 24, bottom: 40, left: 48 };

export function ParetoChart({ puntos, nombresPorModelo }: Props) {
  if (puntos.length === 0) return null;

  const costoMax = Math.max(...puntos.map((p) => p.costoPor1KUsd)) * 1.15 || 1;
  const precisionMax = 1;
  const anchoUtil = ANCHO - MARGEN.left - MARGEN.right;
  const altoUtil = ALTO - MARGEN.top - MARGEN.bottom;

  const x = (costo: number) => MARGEN.left + (costo / costoMax) * anchoUtil;
  const y = (precision: number) => MARGEN.top + altoUtil - (precision / precisionMax) * altoUtil;

  const puntosFrontera = puntos
    .filter((p) => p.esFrontera)
    .slice()
    .sort((a, b) => a.costoPor1KUsd - b.costoPor1KUsd);

  const gridY = [0, 0.25, 0.5, 0.75, 1];
  const gridX = [0, 0.25, 0.5, 0.75, 1].map((f) => Number((f * costoMax).toFixed(4)));

  return (
    <div>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full" role="img" aria-label="Frontera de Pareto costo vs. precisión">
        {/* Grid recesivo */}
        {gridY.map((g) => (
          <line key={`gy-${g}`} x1={MARGEN.left} x2={ANCHO - MARGEN.right} y1={y(g)} y2={y(g)} stroke="#ddd8cb" strokeWidth={1} />
        ))}
        {gridX.map((g) => (
          <line key={`gx-${g}`} x1={x(g)} x2={x(g)} y1={MARGEN.top} y2={ALTO - MARGEN.bottom} stroke="#ddd8cb" strokeWidth={1} />
        ))}

        {/* Ejes */}
        <line x1={MARGEN.left} x2={ANCHO - MARGEN.right} y1={ALTO - MARGEN.bottom} y2={ALTO - MARGEN.bottom} stroke="#14201c" strokeOpacity={0.3} strokeWidth={1.5} />
        <line x1={MARGEN.left} x2={MARGEN.left} y1={MARGEN.top} y2={ALTO - MARGEN.bottom} stroke="#14201c" strokeOpacity={0.3} strokeWidth={1.5} />

        {gridY.map((g) => (
          <text key={`ly-${g}`} x={MARGEN.left - 8} y={y(g)} textAnchor="end" dominantBaseline="middle" className="fill-tinta/50" fontSize={10} fontFamily="'JetBrains Mono', monospace">
            {Math.round(g * 100)}%
          </text>
        ))}
        {gridX.map((g) => (
          <text key={`lx-${g}`} x={x(g)} y={ALTO - MARGEN.bottom + 16} textAnchor="middle" className="fill-tinta/50" fontSize={10} fontFamily="'JetBrains Mono', monospace">
            ${g.toFixed(3)}
          </text>
        ))}
        <text x={ANCHO / 2} y={ALTO - 4} textAnchor="middle" className="fill-tinta/50" fontSize={10}>
          costo por 1K tokens (USD)
        </text>
        <text x={12} y={MARGEN.top - 6} className="fill-tinta/50" fontSize={10}>
          precisión
        </text>

        {/* Línea de frontera */}
        {puntosFrontera.length > 1 && (
          <polyline
            points={puntosFrontera.map((p) => `${x(p.costoPor1KUsd)},${y(p.precision)}`).join(" ")}
            fill="none"
            stroke="#3a6b8a"
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        )}

        {/* Puntos — la posición del label (arriba/abajo) se decide evitando los ya colocados,
            no solo alternando por orden: dos modelos con precisión parecida (aunque su costo
            difiera) quedan a alturas de píxel cercanas y sus labels chocan si solo alternamos
            por costo. */}
        {(() => {
          const puntosPx = puntos.map((p) => ({ p, px: x(p.costoPor1KUsd), py: y(p.precision) }));
          const DIST_MIN_X = 70;
          const DIST_MIN_Y = 18;
          // Se siembra con las posiciones de los ticks del eje Y: si no, un punto barato con precisión
          // cercana a un 25/50/75/100% termina con su label encima del número del eje.
          const colocados: { px: number; py: number }[] = gridY.map((g) => ({ px: MARGEN.left - 8, py: y(g) }));

          return puntosPx
            .slice()
            .sort((a, b) => a.px - b.px)
            .map(({ p, px, py }) => {
              const radio = p.esRecomendado ? 8 : 6;
              const candidatoArriba = py - radio - 6;
              const chocaArriba = colocados.some((c) => Math.abs(c.px - px) < DIST_MIN_X && Math.abs(c.py - candidatoArriba) < DIST_MIN_Y);
              const labelY = chocaArriba ? py + radio + 14 : candidatoArriba;
              colocados.push({ px, py: labelY });

              const color = p.esRecomendado ? "#1f6b52" : p.esFrontera ? "#3a6b8a" : "#14201c";
              const opacidad = p.esRecomendado || p.esFrontera ? 1 : 0.45;

              return (
                <g key={p.modelo}>
                  <circle cx={px} cy={py} r={radio} fill={color} fillOpacity={opacidad} stroke="#f6f4ee" strokeWidth={2}>
                    <title>
                      {nombresPorModelo[p.modelo] ?? p.modelo}: {(p.precision * 100).toFixed(1)}% precisión, ${p.costoPor1KUsd}/1K
                    </title>
                  </circle>
                  <text x={px} y={labelY} textAnchor="middle" fontSize={10} className="fill-tinta" fontWeight={p.esRecomendado ? 600 : 400}>
                    {nombresPorModelo[p.modelo] ?? p.modelo}
                  </text>
                </g>
              );
            });
        })()}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-tinta/60">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-marca" /> recomendado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-azul" /> frontera de pareto
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-tinta/45" /> dominado
        </span>
      </div>
    </div>
  );
}
