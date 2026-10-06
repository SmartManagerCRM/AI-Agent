/**
 * One plan allowance at a glance: a ring and a bar filled to `percent`, the
 * headline value, and a status in words (on track / getting close / limit
 * reached) so the color never carries the meaning alone. Server component.
 */
export type UsageLevel = "ok" | "high" | "full";

export function usageLevel(percent: number): UsageLevel {
  return percent >= 100 ? "full" : percent >= 80 ? "high" : "ok";
}

// Literal class names (Tailwind only generates classes it can read in the source).
const BAR = { ok: "bg-emerald-500", high: "bg-amber-400", full: "bg-red-500" } as const;
const RING = { ok: "stroke-emerald-500", high: "stroke-amber-400", full: "stroke-red-500" } as const;
const BADGE = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  high: "bg-amber-50 text-amber-900 ring-amber-200",
  full: "bg-red-50 text-red-800 ring-red-200",
} as const;

export function UsageMeter({
  title,
  value,
  percent,
  caption,
  status,
  ariaLabel,
  testId,
}: {
  title: string;
  /** The headline: "320 / 1,000" or "37%". */
  value: string;
  /** 0–100; null when there is no limit (no ring, no bar). */
  percent: number | null;
  caption: string;
  /** The status in words, per level. */
  status: Record<UsageLevel, string>;
  ariaLabel: string;
  testId: string;
}) {
  const level = percent === null ? "ok" : usageLevel(percent);
  const shown = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4" data-testid={testId}>
      {percent !== null && (
        <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0 -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="8" className="stroke-slate-100" />
          {shown > 0 && (
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              className={RING[level]}
              strokeDasharray={`${(shown / 100) * circumference} ${circumference}`}
            />
          )}
        </svg>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-700">{title}</p>
          {percent !== null && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${BADGE[level]}`}>{status[level]}</span>}
        </div>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900" dir="ltr">
          {value}
        </p>
        {percent !== null && (
          <div
            className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100"
            role="meter"
            aria-label={ariaLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={shown}
          >
            {shown > 0 && <div className={`h-full rounded-full ${BAR[level]}`} style={{ width: `${shown}%` }} />}
          </div>
        )}
        <p className="mt-1.5 text-xs text-slate-500">{caption}</p>
      </div>
    </div>
  );
}
