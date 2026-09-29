import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { setLeadStatusAction } from "@/server/leads/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-50 text-blue-700",
  contacted: "bg-amber-50 text-amber-700",
  qualified: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-500",
};
const NEXT_STATUS: Record<string, "new" | "contacted" | "qualified" | "closed" | null> = {
  new: "contacted",
  contacted: "qualified",
  qualified: "closed",
  closed: null,
};

/** Leads captured by the Agent (Customer Agent Master Prompt §27, §44) — real rows written only by the capture_lead tool, never fabricated. */
export default async function LeadsPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("id, customer_name, customer_phone, customer_email, message, status, created_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const all = leads ?? [];
  const newCount = all.filter((l) => l.status === "new").length;
  const qualifiedCount = all.filter((l) => l.status === "qualified").length;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="customers" accent="emerald" label="Total leads" value={String(all.length)} trend={null} />
        <KpiTile icon="bell" accent="blue" label="New" value={String(newCount)} trend={null} />
        <KpiTile icon="check" accent="orange" label="Qualified" value={String(qualifiedCount)} trend={null} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        {all.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-2 text-start font-medium">Contact</th>
                  <th className="px-4 py-2 text-start font-medium">Message</th>
                  <th className="px-4 py-2 text-start font-medium">Status</th>
                  <th className="px-4 py-2 text-start font-medium">Received</th>
                  <th className="px-4 py-2 text-start font-medium">Actions</th>
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
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[lead.status]}`}
                        >
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(lead.created_at).toLocaleDateString(locale)}
                      </td>
                      <td className="px-4 py-3">
                        {next && (
                          <form action={setLeadStatusAction}>
                            <input type="hidden" name="leadId" value={lead.id} />
                            <input type="hidden" name="status" value={next} />
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="slug" value={slug} />
                            <button
                              type="submit"
                              className="text-xs font-medium capitalize text-emerald-600 hover:underline"
                            >
                              Mark {next}
                            </button>
                          </form>
                        )}
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
              title="No leads yet"
              description="Leads the Agent captures — a custom request, a consultation ask, anything needing follow-up — will show up here."
            />
          </div>
        )}
      </div>
    </div>
  );
}
