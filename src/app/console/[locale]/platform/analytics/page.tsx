import { DonutChart } from "@/components/console/donut-chart";
import { KpiTile } from "@/components/console/kpi-tile";
import { formatMoney } from "@/lib/money";
import { getDeepAnalytics } from "@/server/platform/deep-analytics";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

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
  const analytics = await getDeepAnalytics(supabase);

  const { data: currencyRow } = analytics.arpuCurrency
    ? await supabase.from("currencies").select("exponent").eq("code", analytics.arpuCurrency).maybeSingle()
    : { data: null };
  const exponent = currencyRow?.exponent ?? 2;

  const segments = analytics.subscriptionsByStatus.map((s) => ({
    label: s.status.replace("_", " "),
    count: s.count,
    color: COLORS[s.status] ?? "#94a3b8",
  }));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Analytics</h1>
      <p className="-mt-4 text-sm text-slate-500">
        Churn, retention and per-business revenue — the platform&apos;s own Dashboard covers growth and composition;
        this page covers what that one doesn&apos;t.
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTile icon="alert" accent="purple" label="Churn rate" value={`${analytics.churnRatePct}%`} trend={null} href={`/${locale}/super-admin/subscribers?status=canceled`} />
        <KpiTile
          icon="check"
          accent="emerald"
          label="Retention rate"
          value={`${analytics.retentionRatePct}%`}
          trend={null}
          href={`/${locale}/super-admin/subscribers?status=active`}
        />
        <KpiTile
          icon="billing"
          accent="orange"
          label="Revenue per business (mo.)"
          value={
            analytics.arpuCurrency ? formatMoney(analytics.arpuMinor, analytics.arpuCurrency, exponent, locale) : "—"
          }
          trend={null}
          href={`/${locale}/super-admin/payments`}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Subscriptions by status</h2>
        {segments.length > 0 ? (
          <DonutChart segments={segments} centerLabel="Total" />
        ) : (
          <p className="py-6 text-center text-sm text-slate-400">No subscriptions yet.</p>
        )}
      </section>
    </div>
  );
}
