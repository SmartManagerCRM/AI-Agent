/**
 * Whether a tenant is currently entitled to use the Agent (spec §98 Phase
 * 7). Deliberately pure — no I/O — so it never trusts a cached flag: the
 * caller re-reads `subscriptions` fresh every time (src/server/ai/gateway.ts,
 * src/server/agent-public/tenant.ts) and this function just does the date
 * math, the same "never trust stale state" discipline
 * `create_order_from_cart` already applies to prices. `tenants.status` is a
 * separate, administrative concern (Super Admin suspending/closing a
 * business) — this is about billing/trial state only.
 *
 * A trial ends at `trialEndsAt` OR when it used up its conversations or AI
 * allowance first — that earlier end is recorded server-side
 * (`subscriptions.trial_limit_reached_at`, by `app.usage_snapshot`).
 */
export type SubscriptionSnapshot = {
  status: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  /** Set when the trial's conversation or AI allowance ran out before its end date. */
  trialLimitReachedAt?: string | null;
};

export function isEntitled(subscription: SubscriptionSnapshot | null, now: Date = new Date()): boolean {
  if (!subscription) return false;
  if (subscription.status === "trialing") {
    return new Date(subscription.trialEndsAt) > now && !subscription.trialLimitReachedAt;
  }
  if (subscription.status === "active") {
    return subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) > now : true;
  }
  return false;
}
