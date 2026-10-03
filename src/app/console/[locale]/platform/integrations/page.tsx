import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";

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
  const tr = await getTranslations("platform.integrations");
  const tAll = await getTranslations();

  const [{ data: statuses }, { data: tenants }] = await Promise.all([
    supabase.rpc("tenant_payment_integration_status"),
    supabase.from("tenants").select("id, slug, business_name").order("business_name"),
  ]);

  const statusByTenant = new Map((statuses ?? []).map((s) => [s.tenant_id, s]));
  const rows = (tenants ?? []).map((t) => ({
    id: t.id,
    slug: t.slug,
    businessName: t.business_name[locale] ?? t.business_name.en ?? t.slug,
    status: statusByTenant.get(t.id),
  }));

  const moyasarCount = rows.filter((r) => r.status?.moyasar_connected).length;
  const tapCount = rows.filter((r) => r.status?.tap_connected).length;
  const noneCount = rows.filter((r) => !r.status?.moyasar_connected && !r.status?.tap_connected).length;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{tr("title")}</h1>
      <p className="-mt-4 text-sm text-slate-500">
        {tr("subtitle")}
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="building" accent="emerald" label={tr("total")} value={String(rows.length)} trend={null} href={`/${locale}/super-admin/businesses`} />
        <KpiTile icon="billing" accent="blue" label={tr("moyasar")} value={String(moyasarCount)} trend={null} href={`/${locale}/super-admin/integrations#gateways`} />
        <KpiTile icon="billing" accent="orange" label={tr("tap")} value={String(tapCount)} trend={null} href={`/${locale}/super-admin/integrations#gateways`} />
        <KpiTile icon="alert" accent="purple" label={tr("none")} value={String(noneCount)} trend={null} href={`/${locale}/super-admin/integrations#gateways`} />
      </div>

      <section id="gateways" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">{tr("col.business")}</th>
                  <th className="py-2 text-start font-medium">{tr("col.moyasar")}</th>
                  <th className="py-2 text-start font-medium">{tr("col.tap")}</th>
                  <th className="py-2 text-start font-medium">{tr("col.methods")}</th>
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
                        {row.status?.moyasar_connected ? tr("connected") : tr("notConnected")}
                      </span>
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.status?.tap_connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {row.status?.tap_connected ? tr("connected") : tr("notConnected")}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">
                      {(row.status?.enabled_methods ?? []).map((m) => (tAll.has(`common.paymentProvider.${m}`) ? tAll(`common.paymentProvider.${m}`) : m)).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={tr("empty")} description={tr("emptyDescription")} />
        )}
      </section>
    </div>
  );
}
