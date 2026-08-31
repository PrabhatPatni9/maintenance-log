const INNER_MS = 45_000;
const OUTER_MS = 5_000;
const SIZE = 220;
const BTN = 96;
const INNER_R = BTN / 2 + 20;
const OUTER_R = INNER_R + 10;

/**
 * The signature element (DESIGN.md): a 45 second inner fill, then a thin
 * outer arc sweeps the 5 second grace tail. The operator is never told
 * capture secretly runs long — the second ring is the whole reassurance.
 */
export function CaptureRing({ elapsedMs }: { elapsedMs: number }) {
  const innerFrac = Math.min(elapsedMs / INNER_MS, 1);
  const outerFrac = Math.min(Math.max(elapsedMs - INNER_MS, 0) / OUTER_MS, 1);

  const innerC = 2 * Math.PI * INNER_R;
  const outerC = 2 * Math.PI * OUTER_R;

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ display: 'block' }}>
      <g transform={`translate(${SIZE / 2}, ${SIZE / 2}) rotate(-90)`}>
        <circle r={OUTER_R} fill="none" stroke="var(--line)" strokeWidth={3} />
        <circle r={INNER_R} fill="none" stroke="var(--line)" strokeWidth={6} />
        <circle
          r={INNER_R}
          fill="none"
          stroke="var(--amber)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={innerC}
          strokeDashoffset={innerC * (1 - innerFrac)}
          style={{ transition: 'stroke-dashoffset 100ms linear' }}
        />
        {innerFrac >= 1 && (
          <circle
            r={OUTER_R}
            fill="none"
            stroke="#f8cf85"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={outerC}
            strokeDashoffset={outerC * (1 - outerFrac)}
            style={{ transition: 'stroke-dashoffset 100ms linear' }}
          />
        )}
      </g>
    </svg>
  );
}

export const CAPTURE_RING_SIZE = SIZE;
export const CAPTURE_HARD_STOP_MS = INNER_MS + OUTER_MS;
export const CAPTURE_INNER_MS = INNER_MS;
