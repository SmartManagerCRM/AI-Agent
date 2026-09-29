import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/**
 * Super Admin Master Spec — Integrations: which payment gateway each
 * business has actually connected, platform-wide. Never reads a real
 * secret key — `tenant_payment_integration_status()` returns only
 * connected/not-connected booleans. AI provider integration status
 * lives on the existing AI Models page, not duplicated here.
 */
export default async function IntegrationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const [{ data: statuses }, { data: tenants }] = await Promise.all([
    supabase.rpc("tenant_payment_integration_status"),
    supabase.from("tenants").select("id, slug, business_name").order("business_name"),
  ]);

  const statusByTenant = new Map((statuses ?? []).map((s) => [s.tenant_id, s]));
  const rows = (tenants ?? []).map((t) => ({
    id: t.id,
    slug: t.slug,
    businessName: t.business_name.en ?? t.slug,
    status: statusByTenant.get(t.id),
  }));

  const moyasarCount = rows.filter((r) => r.status?.moyasar_connected).length;
  const tapCount = rows.filter((r) => r.status?.tap_connected).length;
  const noneCount = rows.filter((r) => !r.status?.moyasar_connected && !r.status?.tap_connected).length;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
      <p className="-mt-4 text-sm text-slate-500">
        Payment gateway connection status across every business. AI provider status is on the AI Models page.
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="building" accent="emerald" label="Total businesses" value={String(rows.length)} trend={null} />
        <KpiTile icon="billing" accent="blue" label="Moyasar connected" value={String(moyasarCount)} trend={null} />
        <KpiTile icon="billing" accent="orange" label="Tap connected" value={String(tapCount)} trend={null} />
        <KpiTile icon="alert" accent="purple" label="No gateway connected" value={String(noneCount)} trend={null} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">Business</th>
                  <th className="py-2 text-start font-medium">Moyasar</th>
                  <th className="py-2 text-start font-medium">Tap</th>
                  <th className="py-2 text-start font-medium">Enabled methods</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">
                      <Link
                        href={`/${locale}/super-admin/businesses/${row.slug}`}
                        prefetch={false}
                        className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                      >
                        {row.businessName}
                      </Link>
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.status?.moyasar_connected
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {row.status?.moyasar_connected ? "Connected" : "Not connected"}
                      </span>
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.status?.tap_connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {row.status?.tap_connected ? "Connected" : "Not connected"}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">{(row.status?.enabled_methods ?? []).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No businesses yet" description="Businesses will appear here as they sign up." />
        )}
      </section>
    </div>
  );
}
