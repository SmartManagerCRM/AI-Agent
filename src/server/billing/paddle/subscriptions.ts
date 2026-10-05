import "server-only";

import { ApiError, type Subscription, type UpdateSubscriptionRequestBody } from "@paddle/paddle-node-sdk";

import { planChangeDirection, type PlanForChange } from "@/lib/billing/plan-change";
import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

import { paddleClient, paddleConfig } from "./client";
import { PADDLE_CURRENCIES, checkoutItem, planChangeItem, type BillablePlan } from "./prices";

/**
 * A subscriber's Paddle subscription, managed from the console's Billing page.
 *
 *   subscribe        a checkout (Paddle transaction) for the plan's price — paying
 *                    it creates the Paddle subscription, renewed automatically
 *   upgrade          right away: the difference for the rest of the period is
 *                    charged pro rata to the payment method on file first, and
 *                    the upgrade happens only if that payment succeeds
 *   downgrade        at the next billing cycle: the lower plan's price is set
 *                    for the next renewal (nothing billed or refunded now); the
 *                    current plan stays until then (scheduled in the database)
 *   cancel / resume  cancellation at the end of the paid period, or undoing it
 *   manage billing   Paddle's customer portal (card, invoices)
 *
 * Every function takes the signed-in member's own client: who may do this is
 * checked by the database (`paddle_billing_subscription`, billing.write) before
 * Paddle is called with the platform's key. Paddle's webhooks remain the record
 * of payments; a change made here is applied right away from Paddle's own
 * answer, and its webhook later confirms it.
 */
export type BillingFailure =
  | "notConfigured"
  | "noPermission"
  | "plan"
  | "currency"
  | "noSubscription"
  | "failed"
  /** The upgrade's payment was declined: nothing changed. */
  | "paymentDeclined"
  /** A downgrade is already scheduled, or a cancellation is pending: no other plan change until it is withdrawn. */
  | "changePending"
  /** The upgrade path for a lower plan, or the downgrade path for a higher one. */
  | "wrongDirection";
export type BillingResult<T = object> = ({ ok: true } & T) | { ok: false; reason: BillingFailure };

const PLAN_COLUMNS = "key, name, price_minor, currency, billing_interval";
const CHANGE_COLUMNS = "key, price_minor, currency, billing_interval, plan_family";

/**
 * Paddle doesn't know this subscription or customer: it belongs to another
 * Paddle account — e.g. one made in the sandbox, after switching to live.
 * The link is then ignored (a new checkout makes a new one, replacing it).
 * Paddle answers 404 `not_found` (https://developer.paddle.com/errors/shared/not_found).
 */
export const notInThisPaddleAccount = (error: unknown) => error instanceof ApiError && error.code === "not_found";

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

/** The subscriber's own plan, even one no longer offered (to keep renewing it). */
async function loadAnyPlan(supabase: TypedSupabaseClient, planKey: string): Promise<BillablePlan | null> {
  const { data } = await supabase.from("subscription_plans").select(PLAN_COLUMNS).eq("key", planKey).maybeSingle();
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
    const paddle = paddleClient(config);
    let customerId = current.paddle_customer_id ?? undefined;
    if (customerId) {
      try {
        await paddle.customers.get(customerId);
      } catch (err) {
        if (!notInThisPaddleAccount(err)) throw err;
        customerId = undefined;
      }
    }
    const transaction = await paddle.transactions.create({
      items: [checkoutItem(plan)],
      customerId,
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

/** Whether moving to this plan is an upgrade or a downgrade (the database's own rule — app.plan_change_direction). */
export async function planChangeDirectionFor(supabase: TypedSupabaseClient, fromKey: string, toKey: string) {
  const { data } = await supabase.from("subscription_plans").select(CHANGE_COLUMNS);
  return planChangeDirection(fromKey, toKey, (data ?? []) as PlanForChange[]);
}

type ChangeContext = {
  config: NonNullable<ReturnType<typeof paddleConfig>>;
  current: NonNullable<Awaited<ReturnType<typeof billingSubscription>>>;
  plan: BillablePlan;
};

/** The subscription and the plan for a plan change in this direction, or why it can't be made. */
async function changeContext(
  supabase: TypedSupabaseClient,
  tenantId: string,
  planKey: string,
  direction: "upgrade" | "downgrade",
): Promise<BillingResult<ChangeContext>> {
  const config = paddleConfig();
  if (!config) return { ok: false, reason: "notConfigured" };
  const current = await billingSubscription(supabase, tenantId);
  if (!current) return { ok: false, reason: "noPermission" };
  if (!renewsThroughPaddle(current)) return { ok: false, reason: "noSubscription" };
  if (current.scheduled_plan_key || current.cancel_at) return { ok: false, reason: "changePending" };
  // A downgrade is scheduled at the end of a paid period: not while a renewal payment is overdue.
  if (direction === "downgrade" && current.status !== "active") return { ok: false, reason: "noSubscription" };
  const plan = await loadPlan(supabase, planKey);
  if (!plan) return { ok: false, reason: "plan" };
  if (!PADDLE_CURRENCIES.has(plan.currency)) return { ok: false, reason: "currency" };
  if ((await planChangeDirectionFor(supabase, current.plan_key, plan.key)) !== direction) return { ok: false, reason: "wrongDirection" };
  return { ok: true, config, current, plan };
}

/** An upgrade: charged pro rata now, and refused by Paddle (nothing changes) if that payment fails. */
const upgradeBody = (tenantId: string, plan: BillablePlan): UpdateSubscriptionRequestBody => ({
  items: [planChangeItem(plan)],
  prorationBillingMode: "prorated_immediately",
  onPaymentFailure: "prevent_change",
  customData: { tenant_id: tenantId, plan_key: plan.key },
});

/** Paddle's answer when the card on file was declined (https://developer.paddle.com/errors/subscriptions/subscription_payment_declined). */
const paymentDeclined = (error: unknown) => error instanceof ApiError && error.code === "subscription_payment_declined";

export type UpgradeQuote = {
  /** Charged now, tax included (Paddle's smallest currency unit). */
  dueNowMinor: number;
  currency: string;
  /** For the new plan, for the rest of the period. */
  chargeMinor: number | null;
  /** Credit for the unused part of the current plan. */
  creditMinor: number | null;
  /** The period the charge covers ends then (the renewal date). */
  periodEnd: string | null;
};

const minor = (amount: string | null | undefined) => {
  const value = Number(amount);
  return amount != null && Number.isFinite(value) ? value : null;
};

/** What an upgrade costs now (Paddle's own pro-rata calculation, nothing charged). */
export async function previewPaddleUpgrade(
  supabase: TypedSupabaseClient,
  tenantId: string,
  planKey: string,
): Promise<BillingResult<{ quote: UpgradeQuote; plan: BillablePlan; currentPlanKey: string }>> {
  const context = await changeContext(supabase, tenantId, planKey, "upgrade");
  if (!context.ok) return context;
  const { config, current, plan } = context;
  try {
    const preview = await paddleClient(config).subscriptions.previewUpdate(current.paddle_subscription_id!, upgradeBody(tenantId, plan));
    const totals = preview.immediateTransaction?.details.totals;
    const dueNow = minor(totals?.grandTotal);
    if (dueNow === null) return { ok: false, reason: "failed" };
    return {
      ok: true,
      plan,
      currentPlanKey: current.plan_key,
      quote: {
        dueNowMinor: dueNow,
        currency: totals?.currencyCode ?? plan.currency,
        chargeMinor: minor(preview.updateSummary?.charge.amount),
        creditMinor: minor(preview.updateSummary?.credit.amount),
        periodEnd: preview.immediateTransaction?.billingPeriod?.endsAt ?? preview.nextBilledAt ?? null,
      },
    };
  } catch (err) {
    if (notInThisPaddleAccount(err)) return { ok: false, reason: "noSubscription" };
    logPaddleError("subscriptions.previewUpdate", err);
    return { ok: false, reason: "failed" };
  }
}

/** Upgrades now: the pro-rata difference is charged first; the plan changes only once it is paid. */
export async function upgradePaddlePlan(supabase: TypedSupabaseClient, tenantId: string, planKey: string): Promise<BillingResult> {
  const context = await changeContext(supabase, tenantId, planKey, "upgrade");
  if (!context.ok) return context;
  const { config, current, plan } = context;
  try {
    const sub = await paddleClient(config).subscriptions.update(current.paddle_subscription_id!, upgradeBody(tenantId, plan));
    await applyFromPaddle(sub);
    return { ok: true };
  } catch (err) {
    if (paymentDeclined(err)) return { ok: false, reason: "paymentDeclined" };
    if (notInThisPaddleAccount(err)) return { ok: false, reason: "noSubscription" };
    logPaddleError("subscriptions.update", err);
    return { ok: false, reason: "failed" };
  }
}

const sameInstant = (a: string | null, b: string | null) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

/**
 * Sets the plan Paddle bills at the next renewal, billing and refunding
 * nothing now, and keeping the renewal date (a change of billing cycle —
 * annual to monthly — included).
 */
async function setNextRenewalPlan(config: ChangeContext["config"], subscriptionId: string, tenantId: string, plan: BillablePlan): Promise<Subscription> {
  const paddle = paddleClient(config);
  const before = await paddle.subscriptions.get(subscriptionId);
  const body: UpdateSubscriptionRequestBody = {
    items: [planChangeItem(plan)],
    prorationBillingMode: "do_not_bill",
    customData: { tenant_id: tenantId, plan_key: plan.key },
  };
  if (before.nextBilledAt && before.billingCycle.interval !== plan.billing_interval) body.nextBilledAt = before.nextBilledAt;
  let sub = await paddle.subscriptions.update(subscriptionId, body);
  // The paid period always runs to its end: put the renewal date back if the change moved it.
  if (before.nextBilledAt && !sameInstant(sub.nextBilledAt, before.nextBilledAt)) {
    sub = await paddle.subscriptions.update(subscriptionId, { nextBilledAt: before.nextBilledAt, prorationBillingMode: "do_not_bill" });
  }
  return sub;
}

/**
 * A downgrade at the next billing cycle: Paddle will bill the lower plan at
 * the next renewal; until then the current plan stays (the database waits for
 * that renewal). Nothing is refunded or credited for the current period.
 */
export async function schedulePaddleDowngrade(
  supabase: TypedSupabaseClient,
  tenantId: string,
  planKey: string,
): Promise<BillingResult<{ effectiveAt: string }>> {
  const context = await changeContext(supabase, tenantId, planKey, "downgrade");
  if (!context.ok) return context;
  const { config, current, plan } = context;
  let sub: Subscription;
  try {
    sub = await setNextRenewalPlan(config, current.paddle_subscription_id!, tenantId, plan);
  } catch (err) {
    if (notInThisPaddleAccount(err)) return { ok: false, reason: "noSubscription" };
    logPaddleError("subscriptions.update (downgrade)", err);
    return { ok: false, reason: "failed" };
  }
  const { data: effectiveAt, error } = await supabase.rpc("schedule_plan_downgrade", { p_tenant_id: tenantId, p_plan_key: plan.key });
  if (error || !effectiveAt) {
    // Not recorded: Paddle goes back to renewing the current plan.
    const currentPlan = await loadAnyPlan(supabase, current.plan_key);
    if (currentPlan) {
      try {
        await setNextRenewalPlan(config, current.paddle_subscription_id!, tenantId, currentPlan);
      } catch (err) {
        logPaddleError("subscriptions.update (downgrade undo)", err);
      }
    }
    return { ok: false, reason: error?.code === "42501" ? "noPermission" : "failed" };
  }
  await applyFromPaddle(sub);
  return { ok: true, effectiveAt };
}

/** Withdraws a scheduled downgrade: Paddle renews the current plan again. */
export async function cancelPaddleDowngrade(supabase: TypedSupabaseClient, tenantId: string): Promise<BillingResult> {
  const config = paddleConfig();
  if (!config) return { ok: false, reason: "notConfigured" };
  const current = await billingSubscription(supabase, tenantId);
  if (!current) return { ok: false, reason: "noPermission" };
  if (!current.scheduled_plan_key) return { ok: true };
  const plan = await loadAnyPlan(supabase, current.plan_key);
  if (!plan) return { ok: false, reason: "plan" };
  let sub: Subscription | null = null;
  if (renewsThroughPaddle(current)) {
    try {
      sub = await setNextRenewalPlan(config, current.paddle_subscription_id!, tenantId, plan);
    } catch (err) {
      if (!notInThisPaddleAccount(err)) {
        logPaddleError("subscriptions.update (keep plan)", err);
        return { ok: false, reason: "failed" };
      }
    }
  }
  const { error } = await supabase.rpc("cancel_plan_downgrade", { p_tenant_id: tenantId });
  if (error) return { ok: false, reason: error.code === "42501" ? "noPermission" : "failed" };
  if (sub) await applyFromPaddle(sub);
  return { ok: true };
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
    if (notInThisPaddleAccount(err)) return { ok: false, reason: "noSubscription" };
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
    if (notInThisPaddleAccount(err)) return { ok: false, reason: "noSubscription" };
    logPaddleError("subscriptions.update", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Whether a linked Paddle subscription exists in this Paddle account (the
 * Billing page shows its renewal and management only then). Unsure (Paddle
 * unreachable) counts as yes.
 */
export async function paddleSubscriptionKnown(subscriptionId: string): Promise<boolean> {
  const config = paddleConfig();
  if (!config) return false;
  try {
    await paddleClient(config).subscriptions.get(subscriptionId);
    return true;
  } catch (err) {
    if (notInThisPaddleAccount(err)) return false;
    logPaddleError("subscriptions.get", err);
    return true;
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
    if (notInThisPaddleAccount(err)) return { ok: false, reason: "noSubscription" };
    logPaddleError("customerPortalSessions.create", err);
    return { ok: false, reason: "failed" };
  }
}
