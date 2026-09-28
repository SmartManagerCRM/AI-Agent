import { KpiTile } from "@/components/console/kpi-tile";
import { getPlatformAgentRows } from "@/server/platform/ai-agents";
import { setTenantAgentActiveAction } from "@/server/platform/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/** Super Admin Master Spec — AI Agents management: every business's Agent, one place, real 30-day usage. */
export default async function AiAgentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const rows = await getPlatformAgentRows(supabase);

  const activeCount = rows.filter((r) => r.active).length;
  const totalCost30d = rows.reduce((sum, r) => sum + r.costUsd30d, 0);
  const overBudget = rows.filter((r) => r.budgetUsd !== null && r.costUsd30d >= r.budgetUsd).length;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">AI Agents</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="agent" accent="emerald" label="Total businesses" value={String(rows.length)} trend={null} />
        <KpiTile icon="check" accent="blue" label="Agent active" value={String(activeCount)} trend={null} />
        <KpiTile icon="billing" accent="orange" label="Cost (30d)" value={`$${totalCost30d.toFixed(2)}`} trend={null} />
        <KpiTile icon="alert" accent="purple" label="At/over budget" value={String(overBudget)} trend={null} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">Business</th>
                <th className="py-2 text-start font-medium">Status</th>
                <th className="py-2 text-start font-medium">Interactions (30d)</th>
                <th className="py-2 text-start font-medium">Handled without AI</th>
                <th className="py-2 text-start font-medium">AI cost (30d)</th>
                <th className="py-2 text-start font-medium">Budget</th>
                <th className="py-2 text-start font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overThisBudget = row.budgetUsd !== null && row.costUsd30d >= row.budgetUsd;
                return (
                  <tr key={row.tenantId} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">
                      <a
                        href={`/${locale}/super-admin/businesses/${row.slug}?tab=agent`}
                        className="font-medium text-slate-900 hover:text-emerald-600 hover:underline"
                      >
                        {row.businessName}
                      </a>
                    </td>
                    <td className="py-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${row.active ? "bg-emerald-500" : "bg-slate-400"}`}
                        />
                        {row.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">{row.interactions30d}</td>
                    <td className="py-2 text-slate-600">{row.deterministicPct}%</td>
                    <td className="py-2 text-slate-600">${row.costUsd30d.toFixed(4)}</td>
                    <td className="py-2">
                      {row.budgetUsd !== null ? (
                        <span className={overThisBudget ? "font-medium text-red-600" : "text-slate-600"}>
                          ${row.budgetUsd.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-400">No cap</span>
                      )}
                    </td>
                    <td className="py-2">
                      <form action={setTenantAgentActiveAction}>
                        <input type="hidden" name="tenantId" value={row.tenantId} />
                        <input type="hidden" name="active" value={(!row.active).toString()} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="text-xs font-medium text-emerald-600 hover:underline">
                          {row.active ? "Disable" : "Enable"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
