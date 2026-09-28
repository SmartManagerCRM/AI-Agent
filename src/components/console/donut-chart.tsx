type Segment = { label: string; count: number; color: string };

const SIZE = 160;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP_DEG = 3;

/** Donut with a center total and a legend carrying label + count + percentage — dataviz skill: identity never color-alone. */
export function DonutChart({ segments, centerLabel }: { segments: Segment[]; centerLabel: string }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);

  let cumulativeDeg = -90;
  const arcs = segments.map((segment) => {
    const fraction = total > 0 ? segment.count / total : 0;
    const sweepDeg = fraction * 360;
    const startDeg = cumulativeDeg;
    cumulativeDeg += sweepDeg;
    const visibleSweep = Math.max(0, sweepDeg - (segments.length > 1 ? GAP_DEG : 0));
    const dashArray = `${(visibleSweep / 360) * CIRCUMFERENCE} ${CIRCUMFERENCE}`;
    const dashOffset = -((startDeg + 90) / 360) * CIRCUMFERENCE;
    return { ...segment, dashArray, dashOffset };
  });

  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#e5e5e5" strokeWidth={STROKE} />
          {total > 0 &&
            arcs.map((arc) => (
              <circle
                key={arc.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={arc.color}
                strokeWidth={STROKE}
                strokeDasharray={arc.dashArray}
                strokeDashoffset={arc.dashOffset}
                strokeLinecap="butt"
              />
            ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-slate-900">{total}</span>
          <span className="text-xs text-slate-500">{centerLabel}</span>
        </div>
      </div>
      <ul className="flex flex-1 flex-col gap-2 text-sm">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
              {segment.label}
            </span>
            <span className="flex items-center gap-2 font-medium text-slate-900">
              {segment.count}
              <span className="text-xs font-normal text-slate-400">
                {total > 0 ? `${Math.round((segment.count / total) * 100)}%` : "0%"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
