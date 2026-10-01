import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { setTenantStatusAction } from "@/server/platform/actions";
import { requireSuperAdmin } from "@/server/tenant/context";
import { createUserClient } from "@/server/supabase/clients";

const NEXT_STATUSES: Record<string, ("active" | "suspended" | "closed")[]> = {
  onboarding: ["active"],
  active: ["suspended", "closed"],
  suspended: ["active", "closed"],
  closed: [],
};

const STATUS_STYLE: Record<string, string> = {
  onboarding: "bg-amber-50 text-amber-700",
  active: "bg-emerald-50 text-emerald-700",
  suspended: "bg-red-50 text-red-700",
  closed: "bg-slate-100 text-slate-500",
};

const STATUS_FILTERS = ["onboarding", "active", "suspended", "closed"] as const;

export default async function BusinessesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: statusParam } = await searchParams;
  const statusFilter = (STATUS_FILTERS as readonly string[]).includes(statusParam ?? "") ? statusParam : null;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const [{ data: tenants }, { data: subscriptions }, { data: tenantSettings }, { data: businessTypes }] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("id, slug, business_name, business_type_key, status, country, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("tenant_id, plan_key, status"),
      supabase.from("tenant_settings").select("tenant_id, agent"),
      supabase.from("business_types").select("key, name"),
    ]);

  const subByTenant = new Map((subscriptions ?? []).map((s) => [s.tenant_id, s]));
  const typeNameByKey = new Map((businessTypes ?? []).map((t) => [t.key, t.name.en ?? t.key]));
  const agentActiveByTenant = new Map(
    (tenantSettings ?? []).map((s) => [s.tenant_id, (s.agent as { active?: boolean } | null)?.active === true]),
  );

  const all = tenants ?? [];
  const activeCount = all.filter((t) => t.status === "active").length;
  const onboardingCount = all.filter((t) => t.status === "onboarding").length;
  const suspendedCount = all.filter((t) => t.status === "suspended").length;
  const shown = statusFilter ? all.filter((t) => t.status === statusFilter) : all;
  const base = `/${locale}/super-admin/businesses`;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Businesses</h1>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page navigation */}
        <a
          href="/api/super-admin/export/businesses"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Export CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="building" accent="emerald" label="Total businesses" value={String(all.length)} trend={null} href={base} />
        <KpiTile icon="agent" accent="blue" label="Active" value={String(activeCount)} trend={null} href={`${base}?status=active`} />
        <KpiTile icon="customers" accent="orange" label="Onboarding" value={String(onboardingCount)} trend={null} href={`${base}?status=onboarding`} />
        <KpiTile icon="alert" accent="purple" label="Suspended" value={String(suspendedCount)} trend={null} href={`${base}?status=suspended`} />
      </div>

      {statusFilter && (
        <p className="text-sm text-slate-600">
          Showing <span className="font-medium capitalize">{statusFilter}</span> businesses ·{" "}
          <Link href={base} prefetch={false} className="font-medium text-emerald-700 hover:underline">
            Show all
          </Link>
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        {shown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">Business</th>
                  <th className="py-2 text-start font-medium">Type</th>
                  <th className="py-2 text-start font-medium">Country</th>
                  <th className="py-2 text-start font-medium">Agent</th>
                  <th className="py-2 text-start font-medium">Subscription</th>
                  <th className="py-2 text-start font-medium">Status</th>
                  <th className="py-2 text-start font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((tenant) => {
                  const subscription = subByTenant.get(tenant.id);
                  const agentActive = agentActiveByTenant.get(tenant.id) ?? false;
                  return (
                    <tr
                      key={tenant.id}
                      id={tenant.slug}
                      className="scroll-mt-24 border-b border-slate-100 last:border-0"
                    >
                      <td className="py-2">
                        <Link
                          href={`/${locale}/super-admin/businesses/${tenant.slug}`}
                          prefetch={false}
                          className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                        >
                          {tenant.business_name.en ?? tenant.slug}
                        </Link>
                        <p className="text-xs text-slate-400">/{tenant.slug}</p>
                      </td>
                      <td className="py-2 text-slate-600">
                        {typeNameByKey.get(tenant.business_type_key) ?? tenant.business_type_key}
                      </td>
                      <td className="py-2 text-slate-600">{tenant.country ?? "—"}</td>
                      <td className="py-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                            agentActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${agentActive ? "bg-emerald-500" : "bg-slate-400"}`}
                          />
                          {agentActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-2 capitalize text-slate-600">
                        {subscription
                          ? `${subscription.plan_key} — ${subscription.status.replace("_", " ")}`
                          : "No plan"}
                      </td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[tenant.status]}`}
                        >
                          {tenant.status}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          {(NEXT_STATUSES[tenant.status] ?? []).map((next) => (
                            <form key={next} action={setTenantStatusAction}>
                              <input type="hidden" name="tenantId" value={tenant.id} />
                              <input type="hidden" name="status" value={next} />
                              <input type="hidden" name="locale" value={locale} />
                              <button
                                type="submit"
                                className="text-xs font-medium capitalize text-emerald-600 hover:underline"
                              >
                                {next}
                              </button>
                            </form>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={statusFilter ? "No businesses with this status" : "No businesses yet"}
            description={statusFilter ? "Try another filter." : "Businesses will appear here as they sign up."}
          />
        )}
      </section>
    </div>
  );
}
