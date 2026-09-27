"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signMockWebhookPayload } from "@/server/payments/mock";
import { paymentProvider } from "@/server/payments/service";
import { processProviderWebhook } from "@/server/payments/webhook";
import { serviceClient } from "@/server/supabase/clients";

const schema = z.object({
  paymentId: z.uuid(),
  outcome: z.enum(["succeeded", "failed"]),
});

/**
 * The mock checkout page's only action (`src/app/agent/pay/[paymentId]/page.tsx`).
 * It never marks the payment itself — it has the mock provider sign a
 * webhook payload and hands it to the exact same verification path a real
 * provider's own server-to-server call would go through
 * (`processProviderWebhook`). That is what keeps "an order only becomes
 * paid through server-side verification" true even for a fake provider:
 * this action's own belief about the outcome carries no weight by itself.
 */
export async function simulateMockPaymentAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({ paymentId: formData.get("paymentId"), outcome: formData.get("outcome") });
  if (!parsed.success) return;

  const supabase = serviceClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("provider, provider_intent_id, amount_minor, currency, status")
    .eq("id", parsed.data.paymentId)
    .maybeSingle();

  if (payment?.provider === "mock" && payment.provider_intent_id && payment.status === "pending") {
    const { body, signature } = signMockWebhookPayload({
      providerIntentId: payment.provider_intent_id,
      eventId: `evt_${randomUUID()}`,
      status: parsed.data.outcome,
      amountMinor: payment.amount_minor,
      currency: payment.currency,
    });
    await processProviderWebhook(paymentProvider, body, signature);
  }

  redirect(`/pay/${parsed.data.paymentId}`);
}
