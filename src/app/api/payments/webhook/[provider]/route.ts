import { NextResponse, type NextRequest } from "next/server";

import { mockPaymentProvider } from "@/server/payments/mock";
import type { PaymentProvider } from "@/server/payments/provider";
import { processProviderWebhook } from "@/server/payments/webhook";

const PROVIDERS: Record<string, PaymentProvider> = {
  mock: mockPaymentProvider,
};

/**
 * The real webhook endpoint a payment provider calls (spec §64). It lives
 * under `/api/` so the host-based proxy (src/proxy.ts) never rewrites or
 * locale-redirects it — a provider calling this needs a stable path on
 * whatever host serves the app. Adding a real provider later means adding
 * its `PaymentProvider` implementation to the map above; this route and
 * the verification path it calls into (`processProviderWebhook`) do not
 * change.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerKey } = await params;
  const provider = PROVIDERS[providerKey];
  if (!provider) return NextResponse.json({ error: "unknown provider" }, { status: 404 });

  const rawBody = await request.text();
  const signature = request.headers.get(provider.webhookSignatureHeader);
  const outcome = await processProviderWebhook(provider, rawBody, signature);

  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 400 });
  return NextResponse.json({ received: outcome.result });
}
