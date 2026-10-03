import Link from "next/link";
import type { ReactNode } from "react";

import { Icon, type NavIconKey, NAV_ICON_PATHS } from "@/components/console/icons";
import { Msg } from "@/components/i18n/msg";
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
  trendLabel = <Msg id="console.kpi.vsPriorDays" values={{ days: 30 }} />,
  href,
}: {
  icon: NavIconKey;
  accent: keyof typeof ICON_BG;
  label: string;
  value: string;
  trend: Trend;
  /** Text after the percentage — defaults to the Dashboard's fixed 30-day comparison. */
  trendLabel?: ReactNode;
  /** The page this figure comes from — the whole card links there. */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${ICON_BG[accent]}`}>
          <Icon path={NAV_ICON_PATHS[icon]} size={18} />
        </span>
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      {/* Long amounts (e.g. LBP 1,234,567.00) step down a size so they fit the card (a line only ever breaks between the currency and the number). */}
      <p
        className={`mt-3 font-semibold tabular-nums text-slate-900 ${value.length > 12 ? "text-lg sm:text-xl" : value.length > 8 ? "text-xl sm:text-2xl" : "text-2xl"}`}
      >
        {value}
      </p>
      {trend && (
        <p className={`mt-1 text-xs font-medium ${trend.direction === "up" ? "text-emerald-600" : "text-red-600"}`}>
          {trend.direction === "up" ? "↑" : "↓"} {trend.pct}% {trendLabel}
        </p>
      )}
    </>
  );
  if (!href) return <div className="rounded-xl border border-slate-200 bg-white p-4">{body}</div>;
  return (
    <Link
      href={href}
      prefetch={false}
      className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-300 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
    >
      {body}
    </Link>
  );
}
