import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { getPlatformLeads } from "@/server/platform/leads-overview";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";
import { RichMsg } from "@/components/i18n/msg";
import { statusLabel } from "@/lib/i18n-labels";

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
  const t = await getTranslations("platform.leads");
  const tAll = await getTranslations();
  const leads = await getPlatformLeads(supabase);

  const newCount = leads.filter((l) => l.status === "new").length;
  const qualifiedCount = leads.filter((l) => l.status === "qualified").length;
  const statusFilter = statusParam && leads.some((l) => l.status === statusParam) ? statusParam : null;
  const shown = statusFilter ? leads.filter((l) => l.status === statusFilter) : leads;
  const base = `/${locale}/super-admin/leads`;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="customers" accent="emerald" label={t("total")} value={String(leads.length)} trend={null} href={base} />
        <KpiTile icon="bell" accent="blue" label={t("new")} value={String(newCount)} trend={null} href={`${base}?status=new`} />
        <KpiTile icon="check" accent="orange" label={t("qualified")} value={String(qualifiedCount)} trend={null} href={`${base}?status=qualified`} />
      </div>

      {statusFilter && (
        <p className="text-sm text-slate-600">
          <RichMsg id="platform.leads.showing" values={{ status: statusLabel(tAll, statusFilter), b: (c) => <span className="font-medium">{c}</span> }} />{" "}
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
                  <th className="py-2 text-start font-medium">{t("col.contact")}</th>
                  <th className="py-2 text-start font-medium">{t("col.message")}</th>
                  <th className="py-2 text-start font-medium">{t("col.status")}</th>
                  <th className="py-2 text-start font-medium">{t("col.received")}</th>
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
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[lead.status]}`}
                      >
                        {statusLabel(tAll, lead.status)}
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
            title={statusFilter ? t("noStatus") : t("empty")}
            description={statusFilter ? t("tryAnother") : t("emptyDescription")}
          />
        )}
      </section>
    </div>
  );
}
