const WIDTH = 320;
const HEIGHT = 96;

interface Props {
  title: string;
  /** Null days are left as gaps: no data is not zero (FR-034). */
  values: readonly (number | null)[];
  /** The protein chart's goal for each day. */
  goals?: readonly (number | null)[];
  summary: string;
}

/** Plain bars, one per day, in inline SVG: no chart library (research R19). The table beside it holds the same values. */
export function TrendChart({ title, values, goals, summary }: Props) {
  const top = Math.max(1, ...values.map((v) => v ?? 0), ...(goals ?? []).map((g) => g ?? 0));
  const step = WIDTH / values.length;
  const y = (value: number) => HEIGHT - (value / top) * HEIGHT;

  return (
    <figure className="trend-chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title}: ${summary}`}>
        {values.map((value, index) =>
          value === null ? null : (
            <rect
              key={index}
              className="trend-bar"
              x={index * step + step * 0.1}
              y={y(value)}
              width={step * 0.8}
              height={HEIGHT - y(value)}
            />
          ),
        )}
        {goals?.map((goal, index) =>
          goal === null ? null : (
            <line
              key={index}
              className="trend-goal"
              x1={index * step}
              x2={(index + 1) * step}
              y1={y(goal)}
              y2={y(goal)}
            />
          ),
        )}
      </svg>
    </figure>
  );
}
