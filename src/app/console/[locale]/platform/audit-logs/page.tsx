import { EmptyState } from "@/components/console/empty-state";
import { SearchInput } from "@/components/console/search-input";
import { Tabs, type Tab } from "@/components/console/tabs";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";
import { auditActionLabel } from "@/lib/i18n-labels";

const ENTITIES = ["all", "tenant", "order", "subscription", "payment", "ai_model_config", "platform_admin"] as const;

export default async function AuditLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ entity?: string; q?: string }>;
}) {
  const { locale } = await params;
  const { entity: entityFilter, q } = await searchParams;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const tr = await getTranslations("platform.auditLogs");
  const tAll = await getTranslations();

  let query = supabase
    .from("audit_logs")
    .select("id, tenant_id, actor_id, action, entity, entity_id, diff, at")
    .order("at", { ascending: false })
    .limit(200);
  if (entityFilter && entityFilter !== "all") query = query.eq("entity", entityFilter);
  if (q) query = query.ilike("action", `%${q}%`);
  const { data: entries } = await query;

  const tenantIds = [...new Set((entries ?? []).map((e) => e.tenant_id).filter((id): id is string => id !== null))];
  const actorIds = [...new Set((entries ?? []).map((e) => e.actor_id).filter((id): id is string => id !== null))];
  const [{ data: tenants }, { data: profiles }] = await Promise.all([
    tenantIds.length
      ? supabase.from("tenants").select("id, slug, business_name").in("id", tenantIds)
      : Promise.resolve({ data: [] }),
    actorIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
      : Promise.resolve({ data: [] }),
  ]);
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t.business_name[locale] ?? t.business_name.en ?? t.slug]));
  const actorById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "—"]));

  const baseHref = `/${locale}/super-admin/audit-logs`;
  const tabs: Tab[] = ENTITIES.map((entity) => ({
    key: entity,
    label: tr(`entity.${entity}`),
    href: entity === "all" ? baseHref : `${baseHref}?entity=${entity}`,
    active: (entityFilter ?? "all") === entity,
  }));

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{tr("title")}</h1>
        <SearchInput placeholder={tr("search")} defaultValue={q} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 pt-3">
          <Tabs tabs={tabs} />
        </div>
        {(entries ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-2 text-start font-medium">{tr("col.when")}</th>
                  <th className="px-4 py-2 text-start font-medium">{tr("col.admin")}</th>
                  <th className="px-4 py-2 text-start font-medium">{tr("col.action")}</th>
                  <th className="px-4 py-2 text-start font-medium">{tr("col.entity")}</th>
                  <th className="px-4 py-2 text-start font-medium">{tr("col.business")}</th>
                </tr>
              </thead>
              <tbody>
                {(entries ?? []).map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      {new Date(entry.at).toLocaleString(locale)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {entry.actor_id ? (actorById.get(entry.actor_id) ?? "—") : tr("system")}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{auditActionLabel(tAll, entry.action)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {tr.has(`entity.${entry.entity}`) ? tr(`entity.${entry.entity}`) : entry.entity.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {entry.tenant_id ? (tenantById.get(entry.tenant_id) ?? "—") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              title={tr("empty")}
              description={tr("emptyDescription")}
            />
          </div>
        )}
      </div>
    </div>
  );
}
