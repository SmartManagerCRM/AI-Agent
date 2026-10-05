/**
 * The Subscribers list's row color: a subscriber's AI Agent spend this month
 * against their own monthly AI cost cap (the plan's, or their individual one).
 *   green ≤ 50% · yellow 51–70% · orange 71–90% · red above 90%
 * No color without a cap (nothing to compare with).
 */
export type AiUsageBand = "green" | "yellow" | "orange" | "red";

export function aiUsageBand(used: number, cap: number | null): AiUsageBand | null {
  if (cap === null || !Number.isFinite(cap)) return null;
  if (cap <= 0) return "red";
  const percent = (100 * used) / cap;
  if (percent <= 50) return "green";
  if (percent <= 70) return "yellow";
  if (percent <= 90) return "orange";
  return "red";
}

export const AI_USAGE_ROW: Record<AiUsageBand, string> = {
  green: "bg-emerald-100",
  yellow: "bg-yellow-100",
  orange: "bg-orange-100",
  red: "bg-red-100",
};

export const AI_USAGE_DOT: Record<AiUsageBand, string> = {
  green: "bg-emerald-400",
  yellow: "bg-yellow-400",
  orange: "bg-orange-400",
  red: "bg-red-500",
};
