import { Icon, type NavIconKey, NAV_ICON_PATHS } from "@/components/console/icons";
import type { Trend } from "@/server/tenant/dashboard-stats";

const ICON_BG: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-600",
  blue: "bg-blue-50 text-blue-600",
  purple: "bg-violet-50 text-violet-600",
  orange: "bg-orange-50 text-orange-600",
  teal: "bg-teal-50 text-teal-600",
};

export function KpiTile({
  icon,
  accent,
  label,
  value,
  trend,
}: {
  icon: NavIconKey;
  accent: keyof typeof ICON_BG;
  label: string;
  value: string;
  trend: Trend;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${ICON_BG[accent]}`}>
          <Icon path={NAV_ICON_PATHS[icon]} size={18} />
        </span>
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
      {trend && (
        <p className={`mt-1 text-xs font-medium ${trend.direction === "up" ? "text-emerald-600" : "text-red-600"}`}>
          {trend.direction === "up" ? "↑" : "↓"} {trend.pct}% vs prior 30 days
        </p>
      )}
    </div>
  );
}
