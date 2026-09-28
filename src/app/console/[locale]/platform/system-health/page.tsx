import { getSystemHealth, overallHealth } from "@/server/platform/health";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const STATUS_STYLE: Record<string, string> = {
  online: "bg-emerald-50 text-emerald-700",
  degraded: "bg-amber-50 text-amber-700",
  offline: "bg-red-50 text-red-700",
  unknown: "bg-slate-100 text-slate-500",
};
const STATUS_DOT: Record<string, string> = {
  online: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-red-500",
  unknown: "bg-slate-400",
};
const OVERALL_STYLE: Record<string, string> = {
  operational: "bg-emerald-50 text-emerald-700 border-emerald-200",
  degraded: "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

export default async function SystemHealthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const health = await getSystemHealth(supabase);
  const status = overallHealth(health);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">System Health</h1>
        <p className="mt-1 text-sm text-slate-500">
          Live checks, not cached or fabricated — a component with no real check reports honestly as unknown.
        </p>
      </div>

      <div className={`w-fit rounded-lg border px-4 py-2 text-sm font-medium capitalize ${OVERALL_STYLE[status]}`}>
        Platform is {status}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {health.map((check) => (
          <div key={check.name} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-900">{check.name}</p>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLE[check.status]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[check.status]}`} />
                {check.status}
              </span>
            </div>
            {check.latencyMs !== null && <p className="mt-2 text-sm text-slate-500">{check.latencyMs}ms latency</p>}
            {check.detail && <p className="mt-2 text-sm text-slate-500">{check.detail}</p>}
            <p className="mt-2 text-xs text-slate-400">
              Checked {new Date(check.checkedAt).toLocaleTimeString(locale)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
