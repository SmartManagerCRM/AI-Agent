"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { sendSubscriptionEmailsSoon } from "@/server/email/subscription-queue";
import { mockPaymentProvider, signMockWebhookPayload } from "@/server/payments/mock";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

import { paddleConfig, paddleIntended } from "./paddle/client";
import {
  cancelPaddleDowngrade,
  cancelPaddleSubscription,
  paddlePortalUrl,
  planChangeDirectionFor,
  renewsThroughPaddle,
  resumePaddleSubscription,
  schedulePaddleDowngrade,
  startPaddleCheckout,
  upgradePaddlePlan,
} from "./paddle/subscriptions";
import { processSubscriptionProviderWebhook } from "./webhook";
import { initiateSubscriptionPayment } from "./service";

const subscribeSchema = z.object({
  tenantId: z.uuid(),
  planKey: z.string().trim().min(1).max(60),
  locale: z.string(),
  slug: z.string().min(1),
});

/**
 * Starts a subscription payment for the chosen plan and sends the owner to its
 * checkout page. With Paddle set up: a Paddle checkout — or, for a plan already
 * renewing through Paddle, a plan change: an upgrade goes to its confirmation
 * page (the pro-rata amount charged now), a downgrade is scheduled for the
 * next billing cycle. Without it: the built-in test checkout.
 */
export async function subscribeAction(formData: FormData): Promise<void> {
  const parsed = subscribeSchema.safeParse({
    tenantId: formData.get("tenantId"),
    planKey: formData.get("planKey"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const billing = `/${parsed.data.locale}/${parsed.data.slug}/billing`;

  if (paddleConfig()) {
    const { data: current } = await supabase.rpc("paddle_billing_subscription", { p_tenant_id: tenant.id });
    const sub = current?.[0] ?? null;
    if (sub && renewsThroughPaddle(sub)) {
      const direction = await planChangeDirectionFor(supabase, sub.plan_key, parsed.data.planKey);
      if (direction === "same") redirect(billing);
      if (direction === "upgrade") redirect(`${billing}/change/${encodeURIComponent(parsed.data.planKey)}`);
      const scheduled = await schedulePaddleDowngrade(supabase, tenant.id, parsed.data.planKey);
      if (scheduled.ok) sendSubscriptionEmailsSoon();
      // "noSubscription": the linked one isn't in this Paddle account (e.g. a sandbox one after going live) — subscribe anew.
      if (scheduled.ok || scheduled.reason !== "noSubscription") redirect(`${billing}?paddle=${scheduled.ok ? "downgradeScheduled" : scheduled.reason}`);
    }
    const checkout = await startPaddleCheckout(supabase, tenant.id, parsed.data.planKey);
    if (!checkout.ok) redirect(`${billing}?paddle=${checkout.reason}`);
    redirect(`${billing}/pay/${checkout.paymentId}`);
  }
  // Paddle keys set but not usable (missing or mismatched): no payments — never the test checkout.
  if (paddleIntended()) redirect(`${billing}?paddle=notConfigured`);

  const result = await initiateSubscriptionPayment(supabase, parsed.data.tenantId, parsed.data.planKey);
  if (!result.ok) return;

  redirect(`/${parsed.data.locale}/${parsed.data.slug}/${result.checkoutPath}`);
}

/**
 * The upgrade's confirmation page → "Pay and upgrade": the pro-rata difference
 * is charged to the payment method on file; the plan changes only if it is paid.
 */
export async function confirmUpgradeAction(formData: FormData): Promise<void> {
  const parsed = subscribeSchema.omit({ tenantId: true }).safeParse({
    planKey: formData.get("planKey"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const billing = `/${parsed.data.locale}/${parsed.data.slug}/billing`;
  const result = await upgradePaddlePlan(supabase, tenant.id, parsed.data.planKey);
  if (result.ok) {
    sendSubscriptionEmailsSoon();
    redirect(`${billing}?paddle=upgraded`);
  }
  if (result.reason === "paymentDeclined") redirect(`${billing}/change/${encodeURIComponent(parsed.data.planKey)}?declined=1`);
  redirect(`${billing}?paddle=${result.reason}`);
}

const manageSchema = z.object({ locale: z.string(), slug: z.string().min(1) });

/** Billing page: cancel at the end of the paid period, undo it, or open Paddle's customer portal. */
async function manage(formData: FormData, run: "cancel" | "resume" | "portal"): Promise<void> {
  const parsed = manageSchema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const billing = `/${parsed.data.locale}/${parsed.data.slug}/billing`;
  if (run === "portal") {
    const portal = await paddlePortalUrl(supabase, tenant.id);
    redirect(portal.ok ? portal.url : `${billing}?paddle=${portal.reason}`);
  }
  const result = run === "cancel" ? await cancelPaddleSubscription(supabase, tenant.id) : await resumePaddleSubscription(supabase, tenant.id);
  if (result.ok) sendSubscriptionEmailsSoon();
  redirect(`${billing}?paddle=${result.ok ? (run === "cancel" ? "canceled" : "resumed") : result.reason}`);
}

export async function cancelSubscriptionAction(formData: FormData): Promise<void> {
  await manage(formData, "cancel");
}

export async function resumeSubscriptionAction(formData: FormData): Promise<void> {
  await manage(formData, "resume");
}

export async function manageBillingAction(formData: FormData): Promise<void> {
  await manage(formData, "portal");
}

/** Withdraws a scheduled downgrade: the current plan renews as it is. */
export async function keepCurrentPlanAction(formData: FormData): Promise<void> {
  const parsed = manageSchema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const result = await cancelPaddleDowngrade(supabase, tenant.id);
  if (result.ok) sendSubscriptionEmailsSoon();
  redirect(`/${parsed.data.locale}/${parsed.data.slug}/billing?paddle=${result.ok ? "downgradeCanceled" : result.reason}`);
}

const simulateSchema = z.object({
  paymentId: z.uuid(),
  outcome: z.enum(["succeeded", "failed"]),
  locale: z.string(),
  slug: z.string().min(1),
});

/**
 * The console mock checkout page's only action
 * (`src/app/console/[locale]/t/[slug]/billing/pay/[paymentId]/page.tsx`),
 * mirroring `simulateMockPaymentAction` (Phase 6): it never marks the
 * payment itself, only has the mock provider sign a webhook and hands it
 * to the same verification path a real provider's own call would go
 * through.
 */
export async function simulateMockSubscriptionPaymentAction(formData: FormData): Promise<void> {
  const parsed = simulateSchema.safeParse({
    paymentId: formData.get("paymentId"),
    outcome: formData.get("outcome"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;
  // Once real payments (Paddle) are set up — even misconfigured — the test checkout can never mark a plan paid.
  if (paddleIntended()) return;

  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { data: payment } = await supabase
    .from("subscription_payments")
    .select("provider, provider_intent_id, amount_minor, currency, status")
    .eq("id", parsed.data.paymentId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (payment?.provider === "mock" && payment.provider_intent_id && payment.status === "pending") {
    const { body, signature } = signMockWebhookPayload({
      providerIntentId: payment.provider_intent_id,
      eventId: `evt_${randomUUID()}`,
      status: parsed.data.outcome,
      amountMinor: payment.amount_minor,
      currency: payment.currency,
    });
    await processSubscriptionProviderWebhook(mockPaymentProvider, body, signature);
    sendSubscriptionEmailsSoon();
  }

  redirect(`/${parsed.data.locale}/${parsed.data.slug}/billing/pay/${parsed.data.paymentId}`);
}
