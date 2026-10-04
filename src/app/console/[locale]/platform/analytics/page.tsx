import { DonutChart } from "@/components/console/donut-chart";
import { KpiTile } from "@/components/console/kpi-tile";
import { displayMoney } from "@/server/platform/display-currency";
import { getDeepAnalytics } from "@/server/platform/deep-analytics";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";
import { statusLabel } from "@/lib/i18n-labels";

const COLORS: Record<string, string> = {
  active: "#10b981",
  trialing: "#3b82f6",
  past_due: "#f59e0b",
  canceled: "#ef4444",
};

/** Super Admin Master Spec — deep Analytics: churn/retention/ARPU, not shown anywhere else in the console. */
export default async function AnalyticsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const t = await getTranslations("platform.analytics");
  const tAll = await getTranslations();
  const analytics = await getDeepAnalytics(supabase);

  const { data: currencyRow } = analytics.arpuCurrency
    ? await supabase.from("currencies").select("exponent").eq("code", analytics.arpuCurrency).maybeSingle()
    : { data: null };
  const exponent = currencyRow?.exponent ?? 2;
  const dm = await displayMoney(supabase, locale);

  const segments = analytics.subscriptionsByStatus.map((s) => ({
    label: statusLabel(tAll, s.status),
    count: s.count,
    color: COLORS[s.status] ?? "#94a3b8",
  }));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
      <p className="-mt-4 text-sm text-slate-500">
        {t("subtitle")}
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTile icon="alert" accent="purple" label={t("churn")} value={`${analytics.churnRatePct}%`} trend={null} href={`/${locale}/super-admin/subscribers?status=canceled`} />
        <KpiTile
          icon="check"
          accent="emerald"
          label={t("retention")}
          value={`${analytics.retentionRatePct}%`}
          trend={null}
          href={`/${locale}/super-admin/subscribers?status=active`}
        />
        <KpiTile
          icon="billing"
          accent="orange"
          label={t("arpu")}
          value={
            analytics.arpuCurrency ? dm.money(analytics.arpuMinor, analytics.arpuCurrency, exponent) : "—"
          }
          trend={null}
          href={`/${locale}/super-admin/payments`}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("byStatus")}</h2>
        {segments.length > 0 ? (
          <DonutChart segments={segments} centerLabel={t("total")} />
        ) : (
          <p className="py-6 text-center text-sm text-slate-400">{t("none")}</p>
        )}
      </section>
    </div>
  );
}
