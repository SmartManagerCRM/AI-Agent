import { getSystemHealth, overallHealth, type HealthStatus } from "@/server/platform/health";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";

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
const STATUSES: HealthStatus[] = ["healthy", "degraded", "critical", "not_configured", "unknown"];

type T = { (key: string, values?: Record<string, string | number>): string; has(key: string): boolean };
/** The health checks' fixed messages (health-rules.ts) in the Super Admin's language; anything else (raw errors) as is. */
const FIXED_DETAIL: Record<string, string> = {
  "Monitoring not implemented yet.": "notImplemented",
  "The server is responding slowly (busy event loop).": "slowServer",
  "Could not read payment configuration.": "paymentUnreadable",
  "No business has connected a payment gateway yet. Optional.": "noGateway",
  "Configured for at least one business. Provider availability (Moyasar/Tap) isn't monitored yet.": "gatewayConfigured",
  "No active AI model is configured — AI replies are unavailable.": "noModel",
  "No active AI model has provider credentials — AI replies are unavailable.": "noCredentials",
};
function detailText(t: T, detail: string): string {
  if (FIXED_DETAIL[detail]) return t(`detail.${FIXED_DETAIL[detail]}`);
  const patterns: [RegExp, string, string][] = [
    [/^Serving with (.+)\.$/, "serving", "model"],
    [/^Default model unavailable; serving through fallback (.+)\.$/, "fallback", "model"],
    [/^No response within ([\d.]+)s\.$/, "noResponse", "n"],
    [/^Slow response \(over ([\d.]+)s\)\.$/, "slow", "n"],
  ];
  for (const [re, key, name] of patterns) {
    const m = re.exec(detail);
    if (m) return t(`detail.${key}`, { [name]: m[1] });
  }
  return detail;
}
const OVERALL_STYLE: Record<string, string> = {
  operational: "bg-emerald-50 text-emerald-700 border-emerald-200",
  degraded: "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

export default async function SystemHealthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const t = await getTranslations("platform.health");
  const component = (name: string) => (t.has(`component.${name}`) ? t(`component.${name}`) : name);

  const health = await getSystemHealth(supabase);
  const status = overallHealth(health);
  const coreNames = health.filter((c) => c.tier === "core").map((c) => component(c.name));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("subtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={`w-fit rounded-lg border px-4 py-2 text-sm font-medium ${OVERALL_STYLE[status]}`}>
          {t("platformIs", { status: t(`overall.${status}`) })}
        </div>
        <p className="text-xs text-slate-500">
          {t("basedOn", { list: coreNames.join(", ") })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {health.map((check) => (
          <div key={check.name} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 font-medium text-slate-900">
                {component(check.name)}
                {check.tier === "core" && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    {t("core")}
                  </span>
                )}
              </p>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[check.status]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[check.status]}`} />
                {t(`status.${check.status}`)}
              </span>
            </div>
            {check.responseTimeMs !== null && (
              <p className="mt-2 text-sm text-slate-500">{t("response", { n: check.responseTimeMs })}</p>
            )}
            {check.detail && <p className="mt-2 text-sm text-slate-500">{detailText(t, check.detail)}</p>}
            <p className="mt-2 text-xs text-slate-400">
              {check.checkedAt ? t("lastChecked", { time: new Date(check.checkedAt).toLocaleTimeString(locale) }) : t("notMonitored")}
            </p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">{t("rules")}</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-slate-600">
          {STATUSES.map((s) => (
            <li key={s} className="flex items-start gap-2">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[s]}`} />
              <span>
                <span className="font-medium text-slate-900">{t(`status.${s}`)}</span> — {t(`rule.${s}`)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          {t("rulesNote")}
        </p>
      </section>
    </div>
  );
}
