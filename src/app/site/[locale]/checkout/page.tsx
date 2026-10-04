import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { PaddleCheckout } from "@/components/billing/paddle-checkout";
import { isLocale } from "@/i18n/locales";
import { paddleConfig } from "@/server/billing/paddle/client";

export const dynamic = "force-dynamic";

/**
 * Paddle's default payment link (Paddle → Checkout settings):
 * `https://<domain>/checkout?_ptxn=<transaction>`. Paddle's own emails and
 * links open it (e.g. to pay a renewal after a card was declined); Paddle.js
 * reads `_ptxn` and opens that transaction's secure checkout. Nothing is
 * activated here — Paddle's signed webhook records the payment.
 */
export default async function PaddleCheckoutLinkPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("console.paddle");
  const config = paddleConfig();
  const messages = (await getMessages()) as { console?: { paddle?: unknown } };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-xl font-semibold text-slate-900">{t("linkTitle")}</h1>
      {config ? (
        <NextIntlClientProvider locale={isLocale(locale) ? locale : "en"} messages={{ console: { paddle: messages.console?.paddle } } as never}>
          <PaddleCheckout clientToken={config.clientToken} environment={config.environment} locale={locale} mode="link" />
        </NextIntlClientProvider>
      ) : (
        <p className="text-sm text-slate-500">{t("unavailable")}</p>
      )}
    </main>
  );
}
