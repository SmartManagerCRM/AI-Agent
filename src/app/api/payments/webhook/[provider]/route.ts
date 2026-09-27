import { NextResponse, type NextRequest } from "next/server";

import { processSubscriptionProviderWebhook } from "@/server/billing/webhook";
import { mockPaymentProvider } from "@/server/payments/mock";
import type { PaymentProvider } from "@/server/payments/provider";
import { processProviderWebhook } from "@/server/payments/webhook";

const PROVIDERS: Record<string, PaymentProvider> = {
  mock: mockPaymentProvider,
};

/**
 * The real webhook endpoint a payment provider calls (spec §64, §98 Phase
 * 7). It lives under `/api/` so the host-based proxy (src/proxy.ts) never
 * rewrites or locale-redirects it — a provider calling this needs a
 * stable path on whatever host serves the app. Adding a real provider
 * later means adding its `PaymentProvider` implementation to the map
 * above; this route and the verification paths it calls into do not
 * change.
 *
 * One provider intent belongs to exactly one domain — an order payment
 * (`src/server/payments/webhook.ts`) or a subscription payment
 * (`src/server/billing/webhook.ts`) — and only this route is allowed to
 * know both exist: it tries the order domain first, and only tries the
 * subscription domain when that domain genuinely has no matching payment
 * (`NOT_FOUND`), never on a real error (an invalid signature or an
 * amount/currency mismatch is definitive either way). This mirrors how a
 * real provider integration dispatches one webhook endpoint across
 * multiple kinds of `payment_intent` by looking up which one an event's
 * id actually belongs to.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerKey } = await params;
  const provider = PROVIDERS[providerKey];
  if (!provider) return NextResponse.json({ error: "unknown provider" }, { status: 404 });

  const rawBody = await request.text();
  const signature = request.headers.get(provider.webhookSignatureHeader);

  const orderOutcome = await processProviderWebhook(provider, rawBody, signature);
  if (orderOutcome.ok) return NextResponse.json({ received: orderOutcome.result });
  if (!orderOutcome.error.startsWith("NOT_FOUND")) {
    return NextResponse.json({ error: orderOutcome.error }, { status: 400 });
  }

  const subscriptionOutcome = await processSubscriptionProviderWebhook(provider, rawBody, signature);
  if (!subscriptionOutcome.ok) return NextResponse.json({ error: subscriptionOutcome.error }, { status: 400 });
  return NextResponse.json({ received: subscriptionOutcome.result });
}
