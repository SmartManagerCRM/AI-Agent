/**
 * A membership's state as the business reads it. "Expired" is never stored:
 * it follows from the renewal date and the plan's grace period, so it is
 * always current.
 */
export type MemberState = "active" | "expiring" | "grace" | "expired" | "trial" | "upcoming" | "paused" | "cancelled";

/** Days before the renewal date when a membership shows as "renews soon". */
export const EXPIRING_DAYS = 7;

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000);
}

export function memberState(
  m: { status: "active" | "paused" | "cancelled"; start_date: string; end_date: string | null; payment_status: string },
  graceDays: number,
  today: string,
): MemberState {
  if (m.status === "cancelled") return "cancelled";
  if (m.status === "paused") return "paused";
  if (m.start_date > today) return "upcoming";
  if (m.end_date === null) return "active";
  const left = daysBetween(today, m.end_date);
  if (left < -graceDays) return "expired";
  if (left < 0) return "grace";
  if (m.payment_status === "trial") return "trial";
  if (left <= EXPIRING_DAYS) return "expiring";
  return "active";
}

/** "Every month", "Every 3 months", "No expiry". */
export function periodLabel(period: "none" | "day" | "week" | "month" | "year", count: number): string {
  if (period === "none") return "No expiry";
  return count === 1 ? `Every ${period}` : `Every ${count} ${period}s`;
}
