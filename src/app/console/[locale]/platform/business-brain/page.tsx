import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { getBusinessBrainOverview } from "@/server/platform/business-brain-overview";
import { getIngestionEconomics } from "@/server/platform/ingestion-economics";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/** Super Admin Master Spec — Business Brain platform module: cross-tenant knowledge health, flags conflicts needing attention. */
export default async function BusinessBrainOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const [rows, economics] = await Promise.all([getBusinessBrainOverview(supabase), getIngestionEconomics(supabase)]);
  const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;

  const totalSources = rows.reduce((sum, r) => sum + r.sourceCount, 0);
  const totalPending = rows.reduce((sum, r) => sum + r.pendingReview, 0);
  const totalConflicts = rows.reduce((sum, r) => sum + r.openConflicts, 0);
  const withConflicts = rows.filter((r) => r.openConflicts > 0).sort((a, b) => b.openConflicts - a.openConflicts);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Business Brain</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="branches" accent="emerald" label="Total sources" value={String(totalSources)} trend={null} />
        <KpiTile icon="billing" accent="orange" label="Pending review" value={String(totalPending)} trend={null} />
        <KpiTile icon="alert" accent="purple" label="Open conflicts" value={String(totalConflicts)} trend={null} />
        <KpiTile
          icon="building"
          accent="blue"
          label="Businesses with conflicts"
          value={String(withConflicts.length)}
          trend={null}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Business Discovery — last 30 days</h2>
          <p className="text-xs text-slate-500">Google costs are list-price estimates; AI costs use configured model pricing.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Analyses", String(economics.jobs)],
            ["Google calls", `${economics.googleCalls} · ${usd(economics.googleCostUsd)}`],
            ["AI calls", `${economics.aiCalls}${economics.aiFailedCalls ? ` (${economics.aiFailedCalls} failed)` : ""}`],
            ["AI tokens", `${economics.aiInputTokens.toLocaleString()} in · ${economics.aiOutputTokens.toLocaleString()} out`],
            ["AI cost", usd(economics.aiCostUsd)],
            ["Avg / analysis", usd(economics.avgCostPerJobUsd)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="font-medium text-slate-900">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {Object.entries(economics.byStatus)
            .map(([status, n]) => `${n} ${status.replace(/_/g, " ")}`)
            .join(" · ") || "No analyses yet."}
          {economics.jobs > 0 && ` · avg per business ${usd(economics.avgCostPerBusinessUsd)}`}
        </p>

        {economics.alerts.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {economics.alerts.map((alert, i) => (
              <li
                key={i}
                className={`rounded-md px-3 py-1.5 text-xs ${alert.severity === "critical" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}
              >
                <span className="font-medium">{alert.slug}</span> — {alert.message}
                {alert.jobId && (
                  <Link href={`/${locale}/super-admin/business-brain/jobs/${alert.jobId}`} prefetch={false} className="ms-1 underline">
                    view
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-slate-700">By model</p>
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 text-start font-medium">Model</th>
                  <th className="py-1.5 text-start font-medium">Calls</th>
                  <th className="py-1.5 text-start font-medium">Tokens in/out</th>
                  <th className="py-1.5 text-start font-medium">Avg latency</th>
                  <th className="py-1.5 text-start font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {economics.byModel.map((m) => (
                  <tr key={`${m.provider}/${m.model}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-900">{m.model}</td>
                    <td className="py-1.5 text-slate-600">
                      {m.calls}
                      {m.failed ? ` (${m.failed} failed)` : ""}
                    </td>
                    <td className="py-1.5 text-slate-600">
                      {m.inputTokens.toLocaleString()} / {m.outputTokens.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-slate-600">{m.avgLatencyMs} ms</td>
                    <td className="py-1.5 text-slate-600">{usd(m.costUsd)}</td>
                  </tr>
                ))}
                {economics.byModel.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-2 text-slate-500">
                      No AI calls — every analysis so far was handled by rules.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {economics.byPurpose.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                By purpose: {economics.byPurpose.map((p) => `${p.purpose.replace("extract:", "")} ${p.calls} (${usd(p.costUsd)})`).join(" · ")}
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-slate-700">By business</p>
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 text-start font-medium">Business</th>
                  <th className="py-1.5 text-start font-medium">Analyses</th>
                  <th className="py-1.5 text-start font-medium">Google</th>
                  <th className="py-1.5 text-start font-medium">AI</th>
                  <th className="py-1.5 text-start font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {economics.byTenant.slice(0, 15).map((t) => (
                  <tr key={t.tenantId} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-900">{t.businessName}</td>
                    <td className="py-1.5 text-slate-600">
                      {t.jobs}
                      {t.failedJobs ? ` (${t.failedJobs} failed)` : ""}
                    </td>
                    <td className="py-1.5 text-slate-600">{usd(t.googleCostUsd)}</td>
                    <td className="py-1.5 text-slate-600">{usd(t.aiCostUsd)}</td>
                    <td className="py-1.5 font-medium text-slate-900">{usd(t.totalUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {economics.recentJobs.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-slate-700">Recent analyses</p>
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 text-start font-medium">When</th>
                  <th className="py-1.5 text-start font-medium">Business</th>
                  <th className="py-1.5 text-start font-medium">Status</th>
                  <th className="py-1.5 text-start font-medium">Pages</th>
                  <th className="py-1.5 text-start font-medium">Facts / conflicts</th>
                  <th className="py-1.5 text-start font-medium">Google / AI calls</th>
                  <th className="py-1.5 text-start font-medium">Cost / budget</th>
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
                    <td className="py-1.5 capitalize text-slate-600">{j.status.replace(/_/g, " ")}</td>
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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Needs attention (open conflicts)</h2>
        {withConflicts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">Business</th>
                  <th className="py-2 text-start font-medium">Sources</th>
                  <th className="py-2 text-start font-medium">Pending review</th>
                  <th className="py-2 text-start font-medium">Approved entries</th>
                  <th className="py-2 text-start font-medium">Open conflicts</th>
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
            title="No open conflicts"
            description="Every business's Business Brain is conflict-free right now."
          />
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Every business</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">Business</th>
                <th className="py-2 text-start font-medium">Sources</th>
                <th className="py-2 text-start font-medium">Pending review</th>
                <th className="py-2 text-start font-medium">Approved entries</th>
                <th className="py-2 text-start font-medium">Open conflicts</th>
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
