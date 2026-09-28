import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { formatMoney } from "@/lib/money";
import { getRecentSubscribers } from "@/server/platform/dashboard-stats";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  trialing: "bg-blue-50 text-blue-700",
  past_due: "bg-amber-50 text-amber-700",
  canceled: "bg-red-50 text-red-700",
  no_plan: "bg-slate-100 text-slate-500",
};

export default async function SubscribersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const [subscribers, { data: currencies }] = await Promise.all([
    getRecentSubscribers(supabase, 200),
    supabase.from("currencies").select("code, exponent"),
  ]);
  const exponentByCode = new Map((currencies ?? []).map((c) => [c.code, c.exponent]));

  const activeCount = subscribers.filter((s) => s.status === "active").length;
  const trialCount = subscribers.filter((s) => s.status === "trialing").length;
  const pastDueCount = subscribers.filter((s) => s.status === "past_due").length;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Subscribers</h1>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page navigation */}
        <a
          href="/api/super-admin/export/subscribers"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Export CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon="customers"
          accent="emerald"
          label="Total subscribers"
          value={String(subscribers.length)}
          trend={null}
        />
        <KpiTile icon="billing" accent="blue" label="Active" value={String(activeCount)} trend={null} />
        <KpiTile icon="agent" accent="orange" label="Trialing" value={String(trialCount)} trend={null} />
        <KpiTile icon="alert" accent="purple" label="Past due" value={String(pastDueCount)} trend={null} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        {subscribers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">Subscriber</th>
                  <th className="py-2 text-start font-medium">Business</th>
                  <th className="py-2 text-start font-medium">Type</th>
                  <th className="py-2 text-start font-medium">Plan</th>
                  <th className="py-2 text-start font-medium">Status</th>
                  <th className="py-2 text-start font-medium">Joined</th>
                  <th className="py-2 text-start font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((s) => (
                  <tr key={s.userId} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">
                      <p className="font-medium text-slate-900">{s.name}</p>
                      {s.email && <p className="text-xs text-slate-400">{s.email}</p>}
                    </td>
                    <td className="py-2 text-slate-600">{s.businessName}</td>
                    <td className="py-2 text-slate-600">{s.businessTypeLabel}</td>
                    <td className="py-2 text-slate-600">{s.planLabel ?? "—"}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[s.status]}`}
                      >
                        {s.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">{new Date(s.joinedAt).toLocaleDateString(locale)}</td>
                    <td className="py-2 text-slate-600">
                      {formatMoney(s.revenueMinor, s.currency, exponentByCode.get(s.currency) ?? 2, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No subscribers yet" description="They'll appear here once the first business signs up." />
        )}
      </section>
    </div>
  );
}
