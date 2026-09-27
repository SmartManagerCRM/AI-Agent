import { getTranslations } from "next-intl/server";

import { requireSuperAdmin } from "@/server/tenant/context";
import { createUserClient } from "@/server/supabase/clients";

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

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">{t("title")}</h1>
      <h2 className="mb-3 text-sm font-medium text-neutral-500">{t("businesses")}</h2>
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-neutral-500">
            <th className="py-2 text-start">Business</th>
            <th className="py-2 text-start">Type</th>
            <th className="py-2 text-start">Status</th>
            <th className="py-2 text-start">{t("subscription")}</th>
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
              </tr>
            );
          })}
          {(tenants ?? []).length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-neutral-400">
                No businesses yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
