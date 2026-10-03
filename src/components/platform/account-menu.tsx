"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState, useSyncExternalStore } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { signOutAction } from "@/server/auth/actions";
import type { PlatformAlert } from "@/server/platform/dashboard-stats";

// Alerts already looked at on this device: the bell counts only new ones.
const SEEN_KEY = "sa-seen-alerts";
const SEEN_EVENT = "sa-seen-alerts";
function readSeen(): string {
  try {
    return window.localStorage.getItem(SEEN_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function subscribeSeen(onChange: () => void) {
  window.addEventListener(SEEN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SEEN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const SEVERITY_STYLE: Record<string, string> = {
  warning: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
};

export function PlatformAccountMenu({
  locale,
  name,
  alerts,
}: {
  locale: string;
  name: string;
  alerts: PlatformAlert[];
}) {
const t = useTranslations("platform.shell");
const tAlert = useTranslations("platform.alerts");
  const [bellOpen, setBellOpen] = useState(false);
  const seenRaw = useSyncExternalStore(subscribeSeen, readSeen, () => null);
  // Before the browser is known (server render) nothing is marked seen, so nothing flickers in later.
  const seen = new Set<string>(seenRaw ? (JSON.parse(seenRaw) as string[]) : alerts.map((a) => a.id));
  const unseen = alerts.filter((a) => !seen.has(a.id)).length;
  const markSeen = useCallback(() => {
    try {
      // Only current alerts are kept, so the list never grows.
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(alerts.map((a) => a.id)));
    } catch {
      // Storage blocked: the count clears for this page only.
    }
    window.dispatchEvent(new Event(SEEN_EVENT));
  }, [alerts]);
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || "S";

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setBellOpen((v) => !v);
            setMenuOpen(false);
            markSeen();
          }}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          aria-label={t("notifications")}
        >
          <Icon path={NAV_ICON_PATHS.bell} size={18} />
          {unseen > 0 && (
            <span
              data-testid="alerts-bell-count"
              className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white"
            >
              {unseen > 9 ? "9+" : unseen}
            </span>
          )}
        </button>
        {bellOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setBellOpen(false)}
              aria-label={t("close")}
            />
            <div className="absolute end-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <p className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-900">{t("alerts")}</p>
              {alerts.length > 0 ? (
                <ul className="max-h-80 overflow-y-auto">
                  {alerts.map((alert) => (
                    <li key={alert.id}>
                      <a href={alert.href} className="flex flex-col gap-1 px-3 py-2 text-sm hover:bg-slate-50">
                        <span
                          className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[alert.severity]}`}
                        >
                          {tAlert(`severity.${alert.severity}`)}
                        </span>
                        <span className="text-slate-700">{tAlert(alert.kind, alert.values)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-4 text-center text-sm text-slate-400">{t("noAlerts")}</p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setMenuOpen((v) => !v);
            setBellOpen(false);
          }}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-semibold text-white">
            {initial}
          </span>
          <span className="hidden text-start sm:block">
            <span className="block truncate text-sm font-medium text-slate-900">{name}</span>
            <span className="block text-xs text-slate-500">{t("role")}</span>
          </span>
          <Icon path={NAV_ICON_PATHS.chevronDown} size={16} className="hidden shrink-0 text-slate-400 sm:block" />
        </button>
        {menuOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setMenuOpen(false)}
              aria-label={t("close")}
            />
            <div className="absolute end-0 z-20 mt-2 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <form action={signOutAction}>
                <input type="hidden" name="locale" value={locale} />
                <button type="submit" className="w-full px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-50">
                  {t("signOut")}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
