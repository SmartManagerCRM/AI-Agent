/**
 * Whether a tenant is currently entitled to use the Agent (spec §98 Phase
 * 7). Deliberately pure — no I/O — so it never trusts a cached flag: the
 * caller re-reads `subscriptions` fresh every time (src/server/ai/gateway.ts,
 * src/server/agent-public/tenant.ts) and this function just does the date
 * math, the same "never trust stale state" discipline
 * `create_order_from_cart` already applies to prices. `tenants.status` is a
 * separate, administrative concern (Super Admin suspending/closing a
 * business) — this is about billing/trial state only.
 */
export type SubscriptionSnapshot = {
  status: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: string;
  currentPeriodEnd: string | null;
};

export function isEntitled(subscription: SubscriptionSnapshot | null, now: Date = new Date()): boolean {
  if (!subscription) return false;
  if (subscription.status === "trialing") return new Date(subscription.trialEndsAt) > now;
  if (subscription.status === "active") {
    return subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) > now : true;
  }
  return false;
}
