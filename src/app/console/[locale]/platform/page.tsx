import { getTranslations } from "next-intl/server";

import { setTenantStatusAction } from "@/server/platform/actions";
import { getPlatformAgentStats } from "@/server/platform/stats";
import { requireSuperAdmin } from "@/server/tenant/context";
import { createUserClient } from "@/server/supabase/clients";

const NEXT_STATUSES: Record<string, ("active" | "suspended" | "closed")[]> = {
  onboarding: ["active"],
  active: ["suspended", "closed"],
  suspended: ["active", "closed"],
  closed: [],
};

const COST_WINDOW_DAYS = 30;

export default async function PlatformOverview({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const t = await getTranslations("platform");

  const supabase = await createUserClient();
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, slug, business_name, status, business_type_key, created_at")
    .order("created_at", { ascending: false });

  const tenantIds = (tenants ?? []).map((t) => t.id);
  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("tenant_id, plan_key, status")
    .in("tenant_id", tenantIds.length > 0 ? tenantIds : [""]);
  const subscriptionByTenant = new Map((subscriptions ?? []).map((s) => [s.tenant_id, s]));

  const { total, deterministicPct, totalCostUsd } = await getPlatformAgentStats(supabase, COST_WINDOW_DAYS);

  return (
    <main className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-semibold">{t("title")}</h1>

      <section className="mb-8 rounded-md border border-neutral-200 p-4">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">
          AI usage — last {COST_WINDOW_DAYS} days (all businesses)
        </h2>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-neutral-500">Interactions</dt>
            <dd className="text-lg font-semibold">{total}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Handled without AI</dt>
            <dd className="text-lg font-semibold">{deterministicPct}%</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Total AI cost</dt>
            <dd className="text-lg font-semibold">${totalCostUsd.toFixed(4)}</dd>
          </div>
        </dl>
      </section>

      <h2 className="mb-3 text-sm font-medium text-neutral-500">{t("businesses")}</h2>
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-neutral-500">
            <th className="py-2 text-start">Business</th>
            <th className="py-2 text-start">Type</th>
            <th className="py-2 text-start">Status</th>
            <th className="py-2 text-start">{t("subscription")}</th>
            <th className="py-2 text-start">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(tenants ?? []).map((tenant) => {
            const subscription = subscriptionByTenant.get(tenant.id);
            return (
              <tr key={tenant.id} className="border-b border-neutral-100">
                <td className="py-2">{tenant.business_name[locale] ?? tenant.slug}</td>
                <td className="py-2">{tenant.business_type_key}</td>
                <td className="py-2 capitalize">{tenant.status}</td>
                <td className="py-2 capitalize">
                  {subscription ? `${subscription.plan_key} — ${subscription.status.replace("_", " ")}` : "—"}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    {(NEXT_STATUSES[tenant.status] ?? []).map((next) => (
                      <form key={next} action={setTenantStatusAction}>
                        <input type="hidden" name="tenantId" value={tenant.id} />
                        <input type="hidden" name="status" value={next} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="text-xs text-blue-700 underline capitalize">
                          {next}
                        </button>
                      </form>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
          {(tenants ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-neutral-400">
                No businesses yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
