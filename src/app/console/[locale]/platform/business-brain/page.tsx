import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { getBusinessBrainOverview } from "@/server/platform/business-brain-overview";
import { getIngestionEconomics } from "@/server/platform/ingestion-economics";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";

/** Super Admin Master Spec — Business Brain platform module: cross-tenant knowledge health, flags conflicts needing attention. */
export default async function BusinessBrainOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const t = await getTranslations("platform.brainOverview");
  const tAll = await getTranslations();
  const jobStatus = (s: string) => (tAll.has(`console.brain.jobStatus.${s}`) ? tAll(`console.brain.jobStatus.${s}`) : s.replace(/_/g, " "));
  const [rows, economics] = await Promise.all([getBusinessBrainOverview(supabase), getIngestionEconomics(supabase)]);
  const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;

  const totalSources = rows.reduce((sum, r) => sum + r.sourceCount, 0);
  const totalPending = rows.reduce((sum, r) => sum + r.pendingReview, 0);
  const totalConflicts = rows.reduce((sum, r) => sum + r.openConflicts, 0);
  const withConflicts = rows.filter((r) => r.openConflicts > 0).sort((a, b) => b.openConflicts - a.openConflicts);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="branches" accent="emerald" label={t("kpi.sources")} value={String(totalSources)} trend={null} href={`/${locale}/super-admin/business-brain#every-business`} />
        <KpiTile icon="billing" accent="orange" label={t("kpi.pending")} value={String(totalPending)} trend={null} href={`/${locale}/super-admin/business-brain#every-business`} />
        <KpiTile icon="alert" accent="purple" label={t("kpi.conflicts")} value={String(totalConflicts)} trend={null} href={`/${locale}/super-admin/business-brain#needs-attention`} />
        <KpiTile
          icon="building"
          accent="blue"
          label={t("kpi.withConflicts")}
          value={String(withConflicts.length)}
          trend={null}
          href={`/${locale}/super-admin/business-brain#needs-attention`}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{t("discovery")}</h2>
          <p className="text-xs text-slate-500">{t("costNote")}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            [t("e.analyses"), String(economics.jobs), "recent-analyses"],
            [t("e.googleCalls"), `${economics.googleCalls} · ${usd(economics.googleCostUsd)}`, "by-business"],
            [t("e.aiCalls"), `${economics.aiCalls}${economics.aiFailedCalls ? t("e.failed", { n: economics.aiFailedCalls }) : ""}`, "by-model"],
            [t("e.aiTokens"), t("e.tokens", { in: economics.aiInputTokens.toLocaleString(locale), out: economics.aiOutputTokens.toLocaleString(locale) }), "by-model"],
            [t("e.aiCost"), usd(economics.aiCostUsd), "by-business"],
            [t("e.avg"), usd(economics.avgCostPerJobUsd), "recent-analyses"],
          ].map(([label, value, anchor]) => (
            <Link
              key={label}
              href={`/${locale}/super-admin/business-brain#${anchor}`}
              prefetch={false}
              className="rounded-lg border border-slate-200 px-3 py-2 transition hover:border-emerald-300 hover:shadow-sm"
            >
              <p className="text-xs text-slate-500">{label}</p>
              <p className="font-medium text-slate-900">{value}</p>
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {Object.entries(economics.byStatus)
            .map(([status, n]) => `${n} ${jobStatus(status)}`)
            .join(" · ") || t("noAnalyses")}
          {economics.jobs > 0 && t("avgPerBusiness", { cost: usd(economics.avgCostPerBusinessUsd) })}
        </p>

        {economics.alerts.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {economics.alerts.map((alert, i) => (
              <li
                key={i}
                className={`rounded-md px-3 py-1.5 text-xs ${alert.severity === "critical" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}
              >
                <span className="font-medium">{alert.slug}</span> — {t(`alert.${alert.kind}`, alert.values)}
                {alert.jobId && (
                  <Link href={`/${locale}/super-admin/business-brain/jobs/${alert.jobId}`} prefetch={false} className="ms-1 underline">
                    {t("view")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div id="by-model" className="scroll-mt-20 overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-slate-700">{t("byModel")}</p>
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 text-start font-medium">{t("col.model")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.calls")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.tokens")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.latency")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {economics.byModel.map((m) => (
                  <tr key={`${m.provider}/${m.model}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-900">{m.model}</td>
                    <td className="py-1.5 text-slate-600">
                      {m.calls}
                      {m.failed ? t("e.failed", { n: m.failed }) : ""}
                    </td>
                    <td className="py-1.5 text-slate-600">
                      {m.inputTokens.toLocaleString(locale)} / {m.outputTokens.toLocaleString(locale)}
                    </td>
                    <td className="py-1.5 text-slate-600">{t("ms", { n: m.avgLatencyMs })}</td>
                    <td className="py-1.5 text-slate-600">{usd(m.costUsd)}</td>
                  </tr>
                ))}
                {economics.byModel.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-2 text-slate-500">
                      {t("noAi")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {economics.byPurpose.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                {t("byPurpose", { list: economics.byPurpose.map((p) => `${p.purpose.replace("extract:", "")} ${p.calls} (${usd(p.costUsd)})`).join(" · ") })}
              </p>
            )}
          </div>
          <div id="by-business" className="scroll-mt-20 overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-slate-700">{t("byBusiness")}</p>
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 text-start font-medium">{t("col.business")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.analyses")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.google")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.ai")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.total")}</th>
                </tr>
              </thead>
              <tbody>
                {economics.byTenant.slice(0, 15).map((row) => (
                  <tr key={row.tenantId} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-900">{row.businessName}</td>
                    <td className="py-1.5 text-slate-600">
                      {row.jobs}
                      {row.failedJobs ? t("e.failed", { n: row.failedJobs }) : ""}
                    </td>
                    <td className="py-1.5 text-slate-600">{usd(row.googleCostUsd)}</td>
                    <td className="py-1.5 text-slate-600">{usd(row.aiCostUsd)}</td>
                    <td className="py-1.5 font-medium text-slate-900">{usd(row.totalUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {economics.recentJobs.length > 0 && (
          <div id="recent-analyses" className="mt-4 scroll-mt-20 overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-slate-700">{t("recent")}</p>
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 text-start font-medium">{t("col.when")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.business")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.status")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.pages")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.facts")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.calls2")}</th>
                  <th className="py-1.5 text-start font-medium">{t("col.budget")}</th>
                </tr>
              </thead>
              <tbody>
                {economics.recentJobs.map((j) => (
                  <tr key={j.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5">
                      <Link href={`/${locale}/super-admin/business-brain/jobs/${j.id}`} prefetch={false} className="text-emerald-700 hover:underline">
                        {new Date(j.createdAt).toLocaleString(locale)}
                      </Link>
                    </td>
                    <td className="py-1.5 text-slate-900">{j.businessName}</td>
                    <td className="py-1.5 text-slate-600">{jobStatus(j.status)}</td>
                    <td className="py-1.5 text-slate-600">{j.pages}</td>
                    <td className="py-1.5 text-slate-600">
                      {j.facts} / {j.conflicts}
                    </td>
                    <td className="py-1.5 text-slate-600">
                      {j.googleCalls} / {j.aiCalls}
                    </td>
                    <td className={`py-1.5 ${j.totalUsd > j.budgetUsd ? "font-medium text-red-600" : "text-slate-600"}`}>
                      {usd(j.totalUsd)} / {usd(j.budgetUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="needs-attention" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("attention")}</h2>
        {withConflicts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">{t("col.business")}</th>
                  <th className="py-2 text-start font-medium">{t("col.sources")}</th>
                  <th className="py-2 text-start font-medium">{t("col.pending")}</th>
                  <th className="py-2 text-start font-medium">{t("col.approved")}</th>
                  <th className="py-2 text-start font-medium">{t("col.conflicts")}</th>
                </tr>
              </thead>
              <tbody>
                {withConflicts.map((row) => (
                  <tr key={row.tenantId} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">
                      <Link
                        href={`/${locale}/super-admin/businesses/${row.slug}?tab=brain`}
                        prefetch={false}
                        className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                      >
                        {row.businessName}
                      </Link>
                    </td>
                    <td className="py-2 text-slate-600">{row.sourceCount}</td>
                    <td className="py-2 text-slate-600">{row.pendingReview}</td>
                    <td className="py-2 text-slate-600">{row.approvedEntries}</td>
                    <td className="py-2 font-medium text-red-600">{row.openConflicts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={t("noConflicts")}
            description={t("noConflictsDescription")}
          />
        )}
      </section>

      <section id="every-business" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("every")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">{t("col.business")}</th>
                <th className="py-2 text-start font-medium">{t("col.sources")}</th>
                <th className="py-2 text-start font-medium">{t("col.pending")}</th>
                <th className="py-2 text-start font-medium">{t("col.approved")}</th>
                <th className="py-2 text-start font-medium">{t("col.conflicts")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tenantId} className="border-b border-slate-100 last:border-0">
                  <td className="py-2">
                    <Link
                      href={`/${locale}/super-admin/businesses/${row.slug}?tab=brain`}
                      prefetch={false}
                      className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                    >
                      {row.businessName}
                    </Link>
                  </td>
                  <td className="py-2 text-slate-600">{row.sourceCount}</td>
                  <td className="py-2 text-slate-600">{row.pendingReview}</td>
                  <td className="py-2 text-slate-600">{row.approvedEntries}</td>
                  <td className="py-2 text-slate-600">{row.openConflicts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
