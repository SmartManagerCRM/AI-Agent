import "server-only";

import { serviceClient } from "@/server/supabase/clients";
import { agentLog } from "./diagnostics";

/**
 * AIUsageGuard — the one place usage limits are enforced before any LLM
 * call: on paid plans the conversation limit (after its grace period) and
 * the hard AI cost cap; on trials the trial's conversations and AI
 * allowance, either of which ends the trial. Everything is decided in the
 * database:
 *
 *   check   → `ai_usage_check`   (records the grace-period start, or the
 *                                 trial's early end, server-side)
 *   reserve → `reserve_ai_cost`  (per-subscriber row lock: concurrent calls
 *                                 can't collectively overshoot the cap)
 *   settle  → `settle_ai_cost`   (replaces the reservation with the real cost)
 *
 * Lapsed subscriptions come back "not governed" — entitlement already
 * refuses them.
 *
 * No result is cached: every decision is per call, per tenant.
 */
export type UsageLimit = "conversation_limit" | "ai_cost_limit" | "ai_response_limit";

export type UsageGate = { governed: boolean; blocked: UsageLimit | null; trialEnded: boolean };

export type Reservation = { allowed: true; reservationId: string | null } | { allowed: false; reason: UsageLimit };

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Before deciding to call the LLM at all. Fails closed: a guard error never turns into an unmetered AI call. */
export async function checkAiUsage(tenantId: string): Promise<UsageGate> {
  const { data, error } = await serviceClient().rpc("ai_usage_check", { p_tenant_id: tenantId });
  if (error) {
    agentLog("usage_guard_error", { tenant_id: tenantId, step: "check", error_code: error.code ?? "UNKNOWN" });
    return { governed: true, blocked: "ai_cost_limit", trialEnded: false };
  }
  const snap = asObject(data);
  if (snap.is_trial === true && snap.trial_ended === true)
    return { governed: true, blocked: "ai_cost_limit", trialEnded: true };
  if (snap.is_paid !== true && snap.is_trial !== true) return { governed: false, blocked: null, trialEnded: false };
  if (snap.conversation_state === "blocked")
    return { governed: true, blocked: "conversation_limit", trialEnded: false };
  // AI is limited by the cost cap or by the plan's monthly AI responses (decided in the database).
  if (snap.ai_state === "blocked")
    return { governed: true, blocked: snap.ai_block_reason === "responses" ? "ai_response_limit" : "ai_cost_limit", trialEnded: false };
  return { governed: true, blocked: null, trialEnded: false };
}

/** Before each model call: reserve its worst-case cost. */
export async function reserveAiCall(tenantId: string, estimateUsd: number): Promise<Reservation> {
  const { data, error } = await serviceClient().rpc("reserve_ai_cost", {
    p_tenant_id: tenantId,
    p_estimate_usd: estimateUsd,
  });
  if (error) {
    agentLog("usage_guard_error", { tenant_id: tenantId, step: "reserve", error_code: error.code ?? "UNKNOWN" });
    return { allowed: false, reason: "ai_cost_limit" };
  }
  const r = asObject(data);
  if (r.allowed === true)
    return { allowed: true, reservationId: typeof r.reservation_id === "string" ? r.reservation_id : null };
  return { allowed: false, reason: r.reason === "conversation_limit" ? "conversation_limit" : "ai_cost_limit" };
}

/** After each model call: record its actual cost (0 when it failed) and release the reservation. */
export async function settleAiCall(tenantId: string, reservationId: string, actualUsd: number): Promise<void> {
  const { error } = await serviceClient().rpc("settle_ai_cost", {
    p_tenant_id: tenantId,
    p_reservation_id: reservationId,
    p_actual_usd: actualUsd,
  });
  if (error)
    agentLog("usage_guard_error", { tenant_id: tenantId, step: "settle", error_code: error.code ?? "UNKNOWN" });
}
