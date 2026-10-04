import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { displayMoney } from "@/server/platform/display-currency";
import { getRecentPayments, getRevenueSummary } from "@/server/platform/revenue";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";
import { statusLabel } from "@/lib/i18n-labels";

const STATUS_STYLE: Record<string, string> = {
  succeeded: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
};

const STATUS_FILTERS = ["all", "succeeded", "failed", "pending"] as const;

/**
 * Super Admin Master Spec, Phase 3 — Payments & Revenue. Scoped strictly
 * to the platform's own SaaS revenue (`subscription_payments`) — see
 * revenue.ts's doc comment for why this is a different figure from a
 * tenant's own end-customer payments (shown instead on that business's
 * Business 360 "Subscription & Payments" tab).
 */
export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: statusParam } = await searchParams;
  await requireSuperAdmin(locale);
  const status = (STATUS_FILTERS as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as (typeof STATUS_FILTERS)[number])
    : "all";

  const supabase = await createUserClient();
  const t = await getTranslations("platform.payments");
  const tAll = await getTranslations();
  const [summary, payments] = await Promise.all([
    getRevenueSummary(supabase),
    getRecentPayments(supabase, status === "all" ? undefined : status),
  ]);
  const { data: currencyRow } = summary.currency
    ? await supabase.from("currencies").select("exponent").eq("code", summary.currency).maybeSingle()
    : { data: null };
  const exponent = currencyRow?.exponent ?? 2;
  const dm = await displayMoney(supabase, locale);
  const money = (minor: number, currency?: string | null) => (currency ? dm.money(minor, currency, exponent) : "—");

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page navigation */}
        <a
          href="/api/super-admin/export/payments"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {t("export")}
        </a>
      </div>
      <p className="-mt-4 text-sm text-slate-500">
        {t("subtitle")}
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon="billing"
          accent="emerald"
          label={t("total")}
          value={money(summary.totalRevenueMinor, summary.currency)}
          trend={null}
          href={`/${locale}/super-admin/payments?status=succeeded`}
        />
        <KpiTile
          icon="analytics"
          accent="blue"
          label={t("mrr")}
          value={money(summary.mrrMinor, summary.currency)}
          trend={null}
          href={`/${locale}/super-admin/subscribers?status=active`}
        />
        <KpiTile icon="check" accent="orange" label={t("succeeded")} value={String(summary.succeededCount)} trend={null} href={`/${locale}/super-admin/payments?status=succeeded`} />
        <KpiTile icon="alert" accent="purple" label={t("failed")} value={String(summary.failedCount)} trend={null} href={`/${locale}/super-admin/payments?status=failed`} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{t("transactions")}</h2>
          <div className="flex gap-1">
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f}
                href={f === "all" ? `/${locale}/super-admin/payments` : `/${locale}/super-admin/payments?status=${f}`}
                prefetch={false}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  status === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f === "all" ? t("filter.all") : statusLabel(tAll, f)}
              </Link>
            ))}
          </div>
        </div>

        {payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">{t("col.business")}</th>
                  <th className="py-2 text-start font-medium">{t("col.plan")}</th>
                  <th className="py-2 text-start font-medium">{t("col.amount")}</th>
                  <th className="py-2 text-start font-medium">{t("col.status")}</th>
                  <th className="py-2 text-start font-medium">{t("col.date")}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">
                      {p.slug ? (
                        <Link
                          href={`/${locale}/super-admin/businesses/${p.slug}?tab=billing`}
                          prefetch={false}
                          className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                        >
                          {p.businessName}
                        </Link>
                      ) : (
                        <span className="text-slate-500">{p.businessName}</span>
                      )}
                    </td>
                    <td className="py-2 text-slate-600">{p.planLabel}</td>
                    <td className="py-2 text-slate-600">{money(p.amountMinor, p.currency)}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status]}`}
                      >
                        {statusLabel(tAll, p.status)}
                      </span>
                      {p.status === "failed" && p.failureReason && (
                        <p className="mt-0.5 text-xs text-slate-400">{p.failureReason}</p>
                      )}
                    </td>
                    <td className="py-2 text-slate-500">{new Date(p.createdAt).toLocaleString(locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={t("empty")} description={t("emptyDescription")} />
        )}
      </section>
    </div>
  );
}
