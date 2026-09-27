"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signMockWebhookPayload } from "@/server/payments/mock";
import { paymentProvider } from "@/server/payments/service";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

import { processSubscriptionProviderWebhook } from "./webhook";
import { initiateSubscriptionPayment } from "./service";

const subscribeSchema = z.object({
  tenantId: z.uuid(),
  planKey: z.string().trim().min(1).max(60),
  locale: z.string(),
  slug: z.string().min(1),
});

/** Starts a subscription payment for the chosen plan and sends the owner to its checkout page. */
export async function subscribeAction(formData: FormData): Promise<void> {
  const parsed = subscribeSchema.safeParse({
    tenantId: formData.get("tenantId"),
    planKey: formData.get("planKey"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const result = await initiateSubscriptionPayment(supabase, parsed.data.tenantId, parsed.data.planKey);
  if (!result.ok) return;

  redirect(`/${parsed.data.locale}/t/${parsed.data.slug}/${result.checkoutPath}`);
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
    await processSubscriptionProviderWebhook(paymentProvider, body, signature);
  }

  redirect(`/${parsed.data.locale}/t/${parsed.data.slug}/billing/pay/${parsed.data.paymentId}`);
}
