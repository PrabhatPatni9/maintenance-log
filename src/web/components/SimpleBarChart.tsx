const HEIGHT = 140;
const BAR_GAP = 4;
const LABEL_H = 20;

/**
 * A plain hand-rolled SVG bar chart — no charting library, same reasoning
 * as CaptureRing: one small, purpose-built component beats a dependency for
 * something this simple, and keeps the bundle an operator downloads over
 * patchy 4G small (CLAUDE.md "Success is measured by one thing"). Width is
 * a plain prop rather than measured, since the dashboard's layout is
 * already a fixed max-width column.
 */
export function SimpleBarChart({
  data,
  width = 320,
  valueSuffix = '',
}: {
  data: { label: string; value: number }[];
  width?: number;
  valueSuffix?: string;
}) {
  if (data.length === 0) return null;
  // A meter correction or replacement can make a day's derived consumption
  // come out negative (see meter-readings.ts's PATCH) — clamped to 0 for
  // display rather than an invalid negative SVG height (the browser drops
  // the whole <rect> silently, which just looks like a missing bar, but
  // still throws in the console).
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = Math.max(4, width / data.length - BAR_GAP);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${HEIGHT + LABEL_H}`} style={{ display: 'block' }}>
      {data.map((d, i) => {
        const barH = Math.max(0, (d.value / max) * (HEIGHT - 18));
        const x = i * (barW + BAR_GAP);
        const y = HEIGHT - barH;
        return (
          <g key={i}>
            <title>
              {d.label}: {d.value.toFixed(1)}
              {valueSuffix}
            </title>
            <rect x={x} y={y} width={barW} height={barH} fill="var(--amber)" rx={2} />
            <text
              x={x + barW / 2}
              y={y - 4}
              textAnchor="middle"
              fontSize={10}
              fill="var(--ink)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {d.value >= 100 ? Math.round(d.value) : d.value.toFixed(1)}
            </text>
            {(i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 6) === 0) && (
              <text x={x + barW / 2} y={HEIGHT + 14} textAnchor="middle" fontSize={9} fill="var(--steel)">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
      <line x1={0} y1={HEIGHT} x2={width} y2={HEIGHT} stroke="var(--line)" strokeWidth={1} />
    </svg>
  );
}
