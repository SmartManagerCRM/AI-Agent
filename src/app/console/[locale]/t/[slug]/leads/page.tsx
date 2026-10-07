import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { ManageControls } from "@/components/console/managed-item";
import { deleteLeadAction, updateLeadAction } from "@/server/manage/actions";
import { setLeadStatusAction } from "@/server/leads/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { Msg } from "@/components/i18n/msg";
import { getTranslations } from "next-intl/server";
import { statusLabel } from "@/lib/i18n-labels";

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-50 text-blue-700",
  contacted: "bg-amber-50 text-amber-700",
  qualified: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-500",
};
const PAGE_SIZE = 50;

const NEXT_STATUS: Record<string, "new" | "contacted" | "qualified" | "closed" | null> = {
  new: "contacted",
  contacted: "qualified",
  qualified: "closed",
  closed: null,
};

/** Leads captured by the Agent (Customer Agent Master Prompt §27, §44) — real rows written only by the capture_lead tool, never fabricated. */
export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale, slug } = await params;
  const page = parsePage((await searchParams).page);
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.leads");
  const tAll = await getTranslations();

  // Counts are exact (counted in Postgres) and the list is paged: every lead is reachable, however many.
  const countOf = (status?: "new" | "qualified") => {
    let q = supabase.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
    if (status) q = q.eq("status", status);
    return q.then(({ count }) => count ?? 0);
  };
  const [{ data: leads }, totalCount, newCount, qualifiedCount] = await Promise.all([
    supabase
      .from("leads")
      .select("id, customer_name, customer_phone, customer_email, message, status, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    countOf(),
    countOf("new"),
    countOf("qualified"),
  ]);

  const all = leads ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900"><Msg id="console.leads.leads" /></h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="customers" accent="emerald" label={t("totalLeads")} value={String(totalCount)} trend={null} href={`/${locale}/${slug}/leads#leads`} />
        <KpiTile icon="bell" accent="blue" label={t("new")} value={String(newCount)} trend={null} href={`/${locale}/${slug}/leads#leads`} />
        <KpiTile icon="check" accent="orange" label={t("qualified")} value={String(qualifiedCount)} trend={null} href={`/${locale}/${slug}/leads#leads`} />
      </div>

      <div id="leads" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white">
        {all.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.leads.contact" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.leads.message" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.leads.status" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.leads.received" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.leads.actions" /></th>
                </tr>
              </thead>
              <tbody>
                {all.map((lead) => {
                  const next = NEXT_STATUS[lead.status];
                  return (
                    <tr key={lead.id} className="border-b border-slate-100 last:border-0 align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{lead.customer_name ?? "—"}</p>
                        <p className="text-xs text-slate-400">{lead.customer_email ?? lead.customer_phone ?? ""}</p>
                      </td>
                      <td className="max-w-xs px-4 py-3 text-slate-600">{lead.message}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[lead.status]}`}
                        >
                          {statusLabel(tAll, lead.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(lead.created_at).toLocaleDateString(locale)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                        {next && (
                          <form action={setLeadStatusAction}>
                            <input type="hidden" name="leadId" value={lead.id} />
                            <input type="hidden" name="status" value={next} />
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="slug" value={slug} />
                            <button
                              type="submit"
                              className="text-xs font-medium text-emerald-600 hover:underline"
                            >
                              {t("markAs", { status: statusLabel(tAll, next) })}
                            </button>
                          </form>
                        )}
                        <ManageControls
                          testId="lead-controls"
                          heading={lead.customer_name ?? t("leads")}
                          hidden={{ locale, slug, id: lead.id }}
                          fields={[
                            { name: "name", label: tAll("common.name"), defaultValue: lead.customer_name, maxLength: 120 },
                            { name: "phone", label: tAll("common.phone"), type: "tel", defaultValue: lead.customer_phone, maxLength: 40 },
                            { name: "email", label: tAll("common.email"), type: "email", defaultValue: lead.customer_email, maxLength: 200 },
                            { name: "notes", label: tAll("console.manage.message"), type: "textarea", defaultValue: lead.message, required: true, maxLength: 2000 },
                          ]}
                          update={updateLeadAction}
                          remove={deleteLeadAction}
                          deleteConfirm={tAll("console.manage.deleteLead")}
                        />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              title={t("emptyTitle")}
              description={t("emptyDescription")}
            />
          </div>
        )}
        <Pagination basePath={`/${locale}/${slug}/leads`} params={{}} page={page} pageSize={PAGE_SIZE} total={totalCount} />
      </div>
    </div>
  );
}
