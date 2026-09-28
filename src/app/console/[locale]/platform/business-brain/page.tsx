import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { getBusinessBrainOverview } from "@/server/platform/business-brain-overview";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/** Super Admin Master Spec — Business Brain platform module: cross-tenant knowledge health, flags conflicts needing attention. */
export default async function BusinessBrainOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const rows = await getBusinessBrainOverview(supabase);

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
                      <a
                        href={`/${locale}/super-admin/businesses/${row.slug}?tab=brain`}
                        className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                      >
                        {row.businessName}
                      </a>
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
                    <a
                      href={`/${locale}/super-admin/businesses/${row.slug}?tab=brain`}
                      className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                    >
                      {row.businessName}
                    </a>
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
