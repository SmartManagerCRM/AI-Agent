import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { getPlatformLeads } from "@/server/platform/leads-overview";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-50 text-blue-700",
  contacted: "bg-amber-50 text-amber-700",
  qualified: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-500",
};

/** Cross-tenant view of every business's captured leads (Customer Agent Phase 2's capture_lead tool) — closes the "Leads" gap this rollout's Phase 8 report flagged as blocked. */
export default async function PlatformLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: statusParam } = await searchParams;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const leads = await getPlatformLeads(supabase);

  const newCount = leads.filter((l) => l.status === "new").length;
  const qualifiedCount = leads.filter((l) => l.status === "qualified").length;
  const statusFilter = statusParam && leads.some((l) => l.status === statusParam) ? statusParam : null;
  const shown = statusFilter ? leads.filter((l) => l.status === statusFilter) : leads;
  const base = `/${locale}/super-admin/leads`;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="customers" accent="emerald" label="Total leads" value={String(leads.length)} trend={null} href={base} />
        <KpiTile icon="bell" accent="blue" label="New" value={String(newCount)} trend={null} href={`${base}?status=new`} />
        <KpiTile icon="check" accent="orange" label="Qualified" value={String(qualifiedCount)} trend={null} href={`${base}?status=qualified`} />
      </div>

      {statusFilter && (
        <p className="text-sm text-slate-600">
          Showing <span className="font-medium capitalize">{statusFilter}</span> leads ·{" "}
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
                  <th className="py-2 text-start font-medium">Contact</th>
                  <th className="py-2 text-start font-medium">Message</th>
                  <th className="py-2 text-start font-medium">Status</th>
                  <th className="py-2 text-start font-medium">Received</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((lead) => (
                  <tr key={lead.id} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="py-2">
                      <Link
                        href={`/${locale}/super-admin/businesses/${lead.slug}`}
                        prefetch={false}
                        className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                      >
                        {lead.businessName}
                      </Link>
                    </td>
                    <td className="py-2 text-slate-600">{lead.customerName ?? "—"}</td>
                    <td className="max-w-xs py-2 text-slate-600">{lead.message}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[lead.status]}`}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td className="py-2 text-slate-500">{new Date(lead.createdAt).toLocaleDateString(locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={statusFilter ? "No leads with this status" : "No leads yet"}
            description={statusFilter ? "Try another filter." : "Leads captured by any business's Agent will show up here."}
          />
        )}
      </section>
    </div>
  );
}
