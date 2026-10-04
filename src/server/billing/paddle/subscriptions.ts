import "server-only";

import { ApiError, type Subscription } from "@paddle/paddle-node-sdk";

import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

import { paddleClient, paddleConfig } from "./client";
import { PADDLE_CURRENCIES, checkoutItem, planChangeItem, type BillablePlan } from "./prices";

/**
 * A subscriber's Paddle subscription, managed from the console's Billing page.
 *
 *   subscribe        a checkout (Paddle transaction) for the plan's price — paying
 *                    it creates the Paddle subscription, renewed automatically
 *   change plan      the subscription's item becomes the new plan's price; the
 *                    difference is charged (or credited) pro rata right away
 *   cancel / resume  cancellation at the end of the paid period, or undoing it
 *   manage billing   Paddle's customer portal (card, invoices)
 *
 * Every function takes the signed-in member's own client: who may do this is
 * checked by the database (`paddle_billing_subscription`, billing.write) before
 * Paddle is called with the platform's key. Paddle's webhooks remain the record
 * of payments; a change made here is applied right away from Paddle's own
 * answer, and its webhook later confirms it.
 */
export type BillingFailure = "notConfigured" | "noPermission" | "plan" | "currency" | "noSubscription" | "failed";
export type BillingResult<T = object> = ({ ok: true } & T) | { ok: false; reason: BillingFailure };

const PLAN_COLUMNS = "key, name, price_minor, currency, billing_interval";

function logPaddleError(operation: string, error: unknown) {
  // Paddle's error code only — never request bodies or customer details.
  console.error(`[paddle] ${operation} failed:`, error instanceof ApiError ? `${error.code} (${error.type})` : error instanceof Error ? error.name : "error");
}

async function billingSubscription(supabase: TypedSupabaseClient, tenantId: string) {
  const { data, error } = await supabase.rpc("paddle_billing_subscription", { p_tenant_id: tenantId });
  if (error) return null;
  return data?.[0] ?? null;
}

async function loadPlan(supabase: TypedSupabaseClient, planKey: string): Promise<BillablePlan | null> {
  const { data } = await supabase.from("subscription_plans").select(PLAN_COLUMNS).eq("key", planKey).eq("is_active", true).maybeSingle();
  return (data as BillablePlan | null) ?? null;
}

/** Whether this subscriber's plan renews through a live Paddle subscription (so a plan change updates it). */
export const renewsThroughPaddle = (sub: { paddle_subscription_id: string | null; status: string } | null) =>
  !!sub?.paddle_subscription_id && (sub.status === "active" || sub.status === "past_due");

/** Records Paddle's answer to a change made here (the same function its webhooks use). */
async function applyFromPaddle(sub: Subscription) {
  const scheduled = sub.scheduledChange;
  const planKey = sub.items[0]?.price?.customData?.plan_key;
  await serviceClient().rpc("apply_paddle_subscription_event", {
    p_event_id: `api:${sub.id}:${sub.updatedAt}`,
    p_occurred_at: sub.updatedAt,
    p_paddle_subscription_id: sub.id,
    p_transaction_id: null,
    p_paddle_customer_id: sub.customerId,
    p_status: sub.status,
    p_cancel_at: scheduled?.action === "cancel" ? scheduled.effectiveAt : null,
    p_plan_key: typeof planKey === "string" ? planKey : null,
    p_raw: { source: "api", subscription_id: sub.id, status: sub.status },
  });
}

/** Starts a checkout for a plan: the pending payment to open Paddle's checkout for. */
export async function startPaddleCheckout(
  supabase: TypedSupabaseClient,
  tenantId: string,
  planKey: string,
): Promise<BillingResult<{ paymentId: string; transactionId: string }>> {
  const config = paddleConfig();
  if (!config) return { ok: false, reason: "notConfigured" };
  const current = await billingSubscription(supabase, tenantId);
  if (!current) return { ok: false, reason: "noPermission" };
  const plan = await loadPlan(supabase, planKey);
  if (!plan) return { ok: false, reason: "plan" };
  if (!PADDLE_CURRENCIES.has(plan.currency)) return { ok: false, reason: "currency" };

  const { data: attempt, error } = await supabase.rpc("create_subscription_payment_attempt", {
    p_tenant_id: tenantId,
    p_plan_key: plan.key,
    p_provider: "paddle",
  });
  const payment = attempt?.[0];
  if (error || !payment) return { ok: false, reason: error?.code === "42501" ? "noPermission" : "failed" };

  try {
    const transaction = await paddleClient(config).transactions.create({
      items: [checkoutItem(plan)],
      customerId: current.paddle_customer_id ?? undefined,
      customData: { tenant_id: tenantId, plan_key: plan.key, subscription_payment_id: payment.payment_id },
    });
    const { error: recordError } = await serviceClient().rpc("record_subscription_payment_provider_intent", {
      p_payment_id: payment.payment_id,
      p_provider_intent_id: transaction.id,
    });
    if (recordError) return { ok: false, reason: "failed" };
    return { ok: true, paymentId: payment.payment_id, transactionId: transaction.id };
  } catch (err) {
    logPaddleError("transactions.create", err);
    return { ok: false, reason: "failed" };
  }
}

/** Moves a Paddle subscription to another plan, charging the difference pro rata now. */
export async function changePaddlePlan(supabase: TypedSupabaseClient, tenantId: string, planKey: string): Promise<BillingResult> {
  const config = paddleConfig();
  if (!config) return { ok: false, reason: "notConfigured" };
  const current = await billingSubscription(supabase, tenantId);
  if (!current) return { ok: false, reason: "noPermission" };
  if (!renewsThroughPaddle(current)) return { ok: false, reason: "noSubscription" };
  const plan = await loadPlan(supabase, planKey);
  if (!plan) return { ok: false, reason: "plan" };
  if (!PADDLE_CURRENCIES.has(plan.currency)) return { ok: false, reason: "currency" };
  try {
    const sub = await paddleClient(config).subscriptions.update(current.paddle_subscription_id!, {
      items: [planChangeItem(plan)],
      prorationBillingMode: "prorated_immediately",
      customData: { tenant_id: tenantId, plan_key: plan.key },
    });
    await applyFromPaddle(sub);
    return { ok: true };
  } catch (err) {
    logPaddleError("subscriptions.update", err);
    return { ok: false, reason: "failed" };
  }
}

/** Cancels at the end of the paid period (the plan stays active until then). */
export async function cancelPaddleSubscription(supabase: TypedSupabaseClient, tenantId: string): Promise<BillingResult> {
  const config = paddleConfig();
  if (!config) return { ok: false, reason: "notConfigured" };
  const current = await billingSubscription(supabase, tenantId);
  if (!current) return { ok: false, reason: "noPermission" };
  if (!renewsThroughPaddle(current)) return { ok: false, reason: "noSubscription" };
  try {
    const sub = await paddleClient(config).subscriptions.cancel(current.paddle_subscription_id!, { effectiveFrom: "next_billing_period" });
    await applyFromPaddle(sub);
    return { ok: true };
  } catch (err) {
    logPaddleError("subscriptions.cancel", err);
    return { ok: false, reason: "failed" };
  }
}

/** Undoes a scheduled cancellation: the subscription renews again. */
export async function resumePaddleSubscription(supabase: TypedSupabaseClient, tenantId: string): Promise<BillingResult> {
  const config = paddleConfig();
  if (!config) return { ok: false, reason: "notConfigured" };
  const current = await billingSubscription(supabase, tenantId);
  if (!current) return { ok: false, reason: "noPermission" };
  if (!renewsThroughPaddle(current)) return { ok: false, reason: "noSubscription" };
  try {
    const sub = await paddleClient(config).subscriptions.update(current.paddle_subscription_id!, { scheduledChange: null });
    await applyFromPaddle(sub);
    return { ok: true };
  } catch (err) {
    logPaddleError("subscriptions.update", err);
    return { ok: false, reason: "failed" };
  }
}

/** A one-time link to Paddle's customer portal (payment method, invoices). */
export async function paddlePortalUrl(supabase: TypedSupabaseClient, tenantId: string): Promise<BillingResult<{ url: string }>> {
  const config = paddleConfig();
  if (!config) return { ok: false, reason: "notConfigured" };
  const current = await billingSubscription(supabase, tenantId);
  if (!current) return { ok: false, reason: "noPermission" };
  if (!current.paddle_customer_id) return { ok: false, reason: "noSubscription" };
  try {
    const session = await paddleClient(config).customerPortalSessions.create(
      current.paddle_customer_id,
      current.paddle_subscription_id ? [current.paddle_subscription_id] : [],
    );
    return { ok: true, url: session.urls.general.overview };
  } catch (err) {
    logPaddleError("customerPortalSessions.create", err);
    return { ok: false, reason: "failed" };
  }
}
