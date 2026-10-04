"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { mockPaymentProvider, signMockWebhookPayload } from "@/server/payments/mock";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

import { paddleConfig } from "./paddle/client";
import {
  cancelPaddleSubscription,
  changePaddlePlan,
  paddlePortalUrl,
  renewsThroughPaddle,
  resumePaddleSubscription,
  startPaddleCheckout,
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
 * renewing through Paddle, a plan change (charged pro rata). Without it: the
 * built-in test checkout.
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
    if (renewsThroughPaddle(current?.[0] ?? null)) {
      const changed = await changePaddlePlan(supabase, tenant.id, parsed.data.planKey);
      redirect(`${billing}?paddle=${changed.ok ? "planChanged" : changed.reason}`);
    }
    const checkout = await startPaddleCheckout(supabase, tenant.id, parsed.data.planKey);
    if (!checkout.ok) redirect(`${billing}?paddle=${checkout.reason}`);
    redirect(`${billing}/pay/${checkout.paymentId}`);
  }

  const result = await initiateSubscriptionPayment(supabase, parsed.data.tenantId, parsed.data.planKey);
  if (!result.ok) return;

  redirect(`/${parsed.data.locale}/${parsed.data.slug}/${result.checkoutPath}`);
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
  // Once real payments (Paddle) are set up, the test checkout can never mark a plan paid.
  if (paddleConfig()) return;

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
  }

  redirect(`/${parsed.data.locale}/${parsed.data.slug}/billing/pay/${parsed.data.paymentId}`);
}
