import { allRows } from "@/server/supabase/fetch-all";
import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { setTenantStatusAction } from "@/server/platform/actions";
import { requireSuperAdmin } from "@/server/tenant/context";
import { createUserClient } from "@/server/supabase/clients";
import { getTranslations } from "next-intl/server";
import { RichMsg } from "@/components/i18n/msg";
import { statusLabel } from "@/lib/i18n-labels";

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
  const t = await getTranslations("platform.businessList");
  const tAll = await getTranslations();

  const [{ data: tenants }, { data: subscriptions }, { data: tenantSettings }, { data: businessTypes }] =
    await Promise.all([
      // Every business, however many (read in pages).
      allRows((from, to) =>
        supabase
          .from("tenants")
          .select("id, slug, business_name, business_type_key, status, country, created_at")
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      allRows((from, to) => supabase.from("subscriptions").select("tenant_id, plan_key, status").order("tenant_id").range(from, to)),
      allRows((from, to) => supabase.from("tenant_settings").select("tenant_id, agent").order("tenant_id").range(from, to)),
      supabase.from("business_types").select("key, name"),
    ]);

  const subByTenant = new Map((subscriptions ?? []).map((s) => [s.tenant_id, s]));
  const typeNameByKey = new Map((businessTypes ?? []).map((t) => [t.key, t.name[locale] ?? t.name.en ?? t.key]));
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
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page navigation */}
        <a
          href="/api/super-admin/export/businesses"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {t("export")}
        </a>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="building" accent="emerald" label={t("total")} value={String(all.length)} trend={null} href={base} />
        <KpiTile icon="agent" accent="blue" label={t("active")} value={String(activeCount)} trend={null} href={`${base}?status=active`} />
        <KpiTile icon="customers" accent="orange" label={t("onboarding")} value={String(onboardingCount)} trend={null} href={`${base}?status=onboarding`} />
        <KpiTile icon="alert" accent="purple" label={t("suspended")} value={String(suspendedCount)} trend={null} href={`${base}?status=suspended`} />
      </div>

      {statusFilter && (
        <p className="text-sm text-slate-600">
          <RichMsg id="platform.businessList.showing" values={{ status: statusLabel(tAll, statusFilter), b: (c) => <span className="font-medium">{c}</span> }} />{" "}
          <Link href={base} prefetch={false} className="font-medium text-emerald-700 hover:underline">
            {t("showAll")}
          </Link>
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        {shown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">{t("col.business")}</th>
                  <th className="py-2 text-start font-medium">{t("col.type")}</th>
                  <th className="py-2 text-start font-medium">{t("col.country")}</th>
                  <th className="py-2 text-start font-medium">{t("col.agent")}</th>
                  <th className="py-2 text-start font-medium">{t("col.subscription")}</th>
                  <th className="py-2 text-start font-medium">{t("col.status")}</th>
                  <th className="py-2 text-start font-medium">{t("col.actions")}</th>
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
                          {tenant.business_name[locale] ?? tenant.business_name.en ?? tenant.slug}
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
                          {agentActive ? t("agentActive") : t("agentInactive")}
                        </span>
                      </td>
                      <td className="py-2 text-slate-600">
                        {subscription
                          ? `${tAll.has(`common.plan.${subscription.plan_key}`) ? tAll(`common.plan.${subscription.plan_key}`) : subscription.plan_key} — ${statusLabel(tAll, subscription.status)}`
                          : t("noPlan")}
                      </td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[tenant.status]}`}
                        >
                          {statusLabel(tAll, tenant.status)}
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
                                className="text-xs font-medium text-emerald-600 hover:underline"
                              >
                                {t(`action.${next}`)}
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
            title={statusFilter ? t("noStatus") : t("empty")}
            description={statusFilter ? t("tryAnother") : t("emptyDescription")}
          />
        )}
      </section>
    </div>
  );
}
