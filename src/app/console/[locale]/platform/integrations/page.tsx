import { allRows } from "@/server/supabase/fetch-all";
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
    allRows((from, to) => supabase.from("tenants").select("id, slug, business_name").order("business_name").order("id").range(from, to)),
  ]);

  const statusByTenant = new Map((statuses ?? []).map((s) => [s.tenant_id, s]));
  const rows = (tenants ?? []).map((t) => ({
    id: t.id,
    slug: t.slug,
    businessName: t.business_name[locale] ?? t.business_name.en ?? t.slug,
    status: statusByTenant.get(t.id),
  }));

  const GATEWAYS = ["moyasar", "tap", "stripe", "paypal", "hyperpay", "myfatoorah"] as const;
  type Status = NonNullable<(typeof rows)[number]["status"]>;
  const connected = (status: Status | undefined) => GATEWAYS.filter((g) => status?.[`${g}_connected`]);
  const anyCount = rows.filter((r) => connected(r.status).length > 0).length;
  const noneCount = rows.length - anyCount;
  const perGateway = GATEWAYS.map((g) => ({ gateway: g, count: rows.filter((r) => r.status?.[`${g}_connected`]).length }));
  const gatewayName = (g: string) => (tAll.has(`common.paymentProvider.${g}`) ? tAll(`common.paymentProvider.${g}`) : g);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{tr("title")}</h1>
      <p className="-mt-4 text-sm text-slate-500">
        {tr("subtitle")}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile icon="building" accent="emerald" label={tr("total")} value={String(rows.length)} trend={null} href={`/${locale}/super-admin/businesses`} />
        <KpiTile icon="billing" accent="blue" label={tr("anyConnected")} value={String(anyCount)} trend={null} href={`/${locale}/super-admin/integrations#gateways`} />
        <KpiTile icon="alert" accent="purple" label={tr("none")} value={String(noneCount)} trend={null} href={`/${locale}/super-admin/integrations#gateways`} />
      </div>

      <ul className="flex flex-wrap gap-2" data-testid="gateway-counts">
        {perGateway.map(({ gateway, count }) => (
          <li key={gateway} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
            <span className="font-medium text-slate-900">{gatewayName(gateway)}</span> · {tr("businessesCount", { count })}
          </li>
        ))}
      </ul>

      <section id="gateways" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pe-3 text-start font-medium">{tr("col.business")}</th>
                  <th className="py-2 pe-3 text-start font-medium">{tr("col.connected")}</th>
                  <th className="py-2 text-start font-medium">{tr("col.methods")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const list = connected(row.status);
                  return (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pe-3">
                        <Link
                          href={`/${locale}/super-admin/businesses/${row.slug}`}
                          prefetch={false}
                          className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                        >
                          {row.businessName}
                        </Link>
                      </td>
                      <td className="py-2 pe-3">
                        {list.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {list.map((g) => (
                              <span key={g} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                {gatewayName(g)}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{tr("notConnected")}</span>
                        )}
                      </td>
                      <td className="py-2 text-slate-600">
                        {(row.status?.enabled_methods ?? []).map(gatewayName).join(", ") || "—"}
                      </td>
                    </tr>
                  );
                })}
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
