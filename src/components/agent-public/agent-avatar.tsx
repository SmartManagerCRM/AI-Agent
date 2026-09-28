const PALETTE = ["#0f766e", "#7c3aed", "#b45309", "#be123c", "#1d4ed8", "#0e7490", "#4d7c0f", "#9333ea"];

/** Deterministic color from the business name — never a random/fake photo, just a stable, distinct identity mark. */
function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

type Props = { businessName: string; size?: number; className?: string };

/**
 * Persistent AI identity mark (spec §4) — a simple robot glyph on a
 * business-derived color, not a fabricated avatar image (no real image
 * field exists for this yet). Same mark is reused in the page header and
 * every chat bubble so the AI identity stays visually consistent
 * throughout the experience.
 */
export function AgentAvatar({ businessName, size = 40, className = "" }: Props) {
  const color = colorFor(businessName || "agent");
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: color }}
      aria-hidden="true"
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none">
        <rect x="4" y="8" width="16" height="12" rx="4" fill="currentColor" opacity="0.95" />
        <circle cx="9" cy="14" r="1.6" fill={color} />
        <circle cx="15" cy="14" r="1.6" fill={color} />
        <rect x="10.5" y="17" width="3" height="1.4" rx="0.7" fill={color} />
        <rect x="11" y="3" width="2" height="4" rx="1" fill="currentColor" />
        <circle cx="12" cy="2.5" r="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}
