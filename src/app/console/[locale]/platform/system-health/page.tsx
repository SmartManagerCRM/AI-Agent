import { getSystemHealth, overallHealth, type HealthStatus } from "@/server/platform/health";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const STATUS_STYLE: Record<HealthStatus, string> = {
  healthy: "bg-emerald-50 text-emerald-700",
  degraded: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
  not_configured: "bg-sky-50 text-sky-700",
  unknown: "bg-slate-100 text-slate-500",
};
const STATUS_DOT: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  critical: "bg-red-500",
  not_configured: "bg-sky-400",
  unknown: "bg-slate-400",
};
const STATUS_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
  not_configured: "Not configured",
  unknown: "Unknown",
};
const STATUS_RULE: Record<HealthStatus, string> = {
  healthy: "A live check passed within its thresholds.",
  degraded: "Working but impaired — slow beyond its threshold, or running on a fallback.",
  critical: "A core component isn't working — no response, an error, or nothing usable configured.",
  not_configured: "An optional integration nobody has set up yet. Not an outage.",
  unknown: "No monitoring exists for this component yet. Says nothing about whether it works.",
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
  const coreNames = health.filter((c) => c.tier === "core").map((c) => c.name);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">System Health</h1>
        <p className="mt-1 text-sm text-slate-500">
          Live checks, not cached or fabricated — a component with no real check reports honestly as unknown.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={`w-fit rounded-lg border px-4 py-2 text-sm font-medium capitalize ${OVERALL_STYLE[status]}`}>
          Platform is {status}
        </div>
        <p className="text-xs text-slate-500">
          Based on core components only: {coreNames.join(", ")}. Optional and unmonitored components never change it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {health.map((check) => (
          <div key={check.name} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 font-medium text-slate-900">
                {check.name}
                {check.tier === "core" && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    Core
                  </span>
                )}
              </p>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[check.status]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[check.status]}`} />
                {STATUS_LABEL[check.status]}
              </span>
            </div>
            {check.responseTimeMs !== null && (
              <p className="mt-2 text-sm text-slate-500">Response time {check.responseTimeMs} ms</p>
            )}
            {check.detail && <p className="mt-2 text-sm text-slate-500">{check.detail}</p>}
            <p className="mt-2 text-xs text-slate-400">
              {check.checkedAt ? `Last checked ${new Date(check.checkedAt).toLocaleTimeString(locale)}` : "Not monitored"}
            </p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Status rules</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-slate-600">
          {(Object.keys(STATUS_RULE) as HealthStatus[]).map((s) => (
            <li key={s} className="flex items-start gap-2">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[s]}`} />
              <span>
                <span className="font-medium text-slate-900">{STATUS_LABEL[s]}</span> — {STATUS_RULE[s]}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Platform status: critical if any core component is critical; otherwise degraded if any core component is
          degraded; otherwise operational.
        </p>
      </section>
    </div>
  );
}
