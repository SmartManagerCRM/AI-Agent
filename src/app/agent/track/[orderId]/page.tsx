import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { AgentI18nProvider } from "@/components/agent-public/agent-i18n";
import { OrderTracker } from "@/components/agent-public/order-tracker";
import { isLocale, localeDirection } from "@/i18n/locales";
import { loadOrderTracking } from "@/server/agent-public/tracking-data";
import { serviceClient } from "@/server/supabase/clients";

export const dynamic = "force-dynamic";

/**
 * The order tracking page, reachable at `agent.<root>/track/<orderId>` (same
 * host as the External Agent, like the payment page). The customer opens it
 * from "Track order" after placing an order and follows it step by step:
 * confirmed → preparing → prepared → ready → collected / served / out for
 * delivery → delivered → paid → completed (`src/lib/order-tracking.ts`).
 */
export default async function TrackPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const order = await loadOrderTracking(orderId);
  if (!order) notFound();

  const { data: tenant } = await serviceClient().from("tenants").select("business_name, default_language").eq("id", order.tenantId).maybeSingle();
  const requested = await getLocale();
  const locale = isLocale(requested) ? requested : "en";
  const t = await getTranslations({ locale, namespace: "agent.track" });
  // Only the tracking strings reach the customer's phone.
  const track = ((await import(`../../../../../messages/${locale}.json`)).default as { agent: { track: Record<string, unknown> } }).agent.track;
  const businessName =
    (tenant && (tenant.business_name[locale] ?? tenant.business_name[tenant.default_language] ?? Object.values(tenant.business_name)[0])) ?? "";

  return (
    <main lang={locale} dir={localeDirection(locale)} className="flex min-h-dvh flex-col items-center justify-center bg-agent-cream px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-[0_30px_60px_-30px_rgba(5,42,34,0.45)] ring-1 ring-slate-900/5">
        <div
          className="flex flex-col items-center gap-2 px-6 pt-8 pb-7 text-center text-white"
          style={{ backgroundImage: "radial-gradient(circle at 85% 0%, rgba(47,201,154,0.35), transparent 45%), linear-gradient(160deg, #052a22 0%, #0b4f3f 60%, #0c6a53 100%)" }}
        >
          <p className="text-xs font-semibold tracking-wide text-agent-200 uppercase">{t("title")}</p>
          {businessName && <h1 className="text-xl font-bold">{businessName}</h1>}
          <p className="text-sm text-white/75" data-testid="track-order-number">
            {t("order", { number: order.orderNumber })}
          </p>
        </div>

        <div className="flex flex-col gap-5 px-6 py-7">
          <AgentI18nProvider locale={locale} messages={{ track }}>
            <OrderTracker initial={order} locale={locale} />
          </AgentI18nProvider>
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Image src="/brand/logo-mark.png" alt="" width={16} height={16} className="rounded" />
            {t("poweredBy")}
          </p>
        </div>
      </div>
    </main>
  );
}
