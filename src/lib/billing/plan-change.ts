/**
 * Whether moving from one plan to another is an upgrade (applies now, the
 * difference charged pro rata) or a downgrade (applies at the next billing
 * cycle, nothing refunded for the current one). The same rule as the
 * database's `app.plan_change_direction`
 * (supabase/migrations/20261013100000_plan_changes.sql), which also enforces
 * it — keep both in step.
 *
 * A plan's tier is its family's monthly price (Starter < Growth < Pro), so an
 * annual plan is the same tier as its monthly one. Annual → monthly is always
 * a downgrade; monthly → annual of the same tier is an upgrade.
 */

export type PlanForChange = {
  key: string;
  price_minor: number;
  currency: string;
  billing_interval: string;
  plan_family?: string | null;
};

export type PlanChangeDirection = "upgrade" | "downgrade" | "same";

function tierPrice(plan: PlanForChange, plans: readonly PlanForChange[]): number {
  const family = plans.find((p) => p.key === plan.plan_family && p.billing_interval === "month" && p.currency === plan.currency);
  if (family) return family.price_minor;
  return plan.billing_interval === "year" ? plan.price_minor / 12 : plan.price_minor;
}

export function planChangeDirection(fromKey: string, toKey: string, plans: readonly PlanForChange[]): PlanChangeDirection {
  if (fromKey === toKey) return "same";
  const from = plans.find((p) => p.key === fromKey);
  const to = plans.find((p) => p.key === toKey);
  if (!from || !to) return "upgrade";
  if (from.billing_interval === "year" && to.billing_interval === "month") return "downgrade";
  const fromTier = tierPrice(from, plans);
  const toTier = tierPrice(to, plans);
  if (toTier > fromTier) return "upgrade";
  if (toTier < fromTier) return "downgrade";
  if (from.billing_interval === "month" && to.billing_interval === "year") return "upgrade";
  return to.price_minor < from.price_minor ? "downgrade" : "upgrade";
}
