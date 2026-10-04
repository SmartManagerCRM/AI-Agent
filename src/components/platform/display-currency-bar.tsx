"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";

import type { CurrencyOption } from "@/components/console/currency-bar";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { setDisplayCurrencyAction } from "@/server/platform/actions";

/**
 * Super Admin header currency bar (next to the language bar): the currency
 * amounts are shown in across the Super Admin console. Viewing only — it
 * converts nothing stored; "As recorded" shows each amount in its own currency.
 */
export function DisplayCurrencyBar({ current, options, locale }: { current: string | null; options: CurrencyOption[]; locale: string }) {
  const router = useRouter();
  const t = useTranslations("platform.displayCurrency");
  const tc = useTranslations("console.currency");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (o: CurrencyOption) => !q || o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q);
    const sorted = [...options].filter(match).sort((a, b) => a.code.localeCompare(b.code));
    return [
      { label: tc("mena"), items: sorted.filter((o) => o.mena) },
      { label: tc("international"), items: sorted.filter((o) => !o.mena) },
    ].filter((g) => g.items.length > 0);
  }, [options, query, tc]);

  const choose = (code: string | null) => {
    setOpen(false);
    if (code === current) return;
    startTransition(async () => {
      await setDisplayCurrencyAction(code, locale);
      router.refresh();
    });
  };
  const currentName = current ? (options.find((o) => o.code === current)?.name ?? current) : t("asRecorded");
  const row = (selected: boolean) =>
    `flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm ${selected ? "bg-emerald-50 font-medium text-emerald-700" : "text-slate-700 hover:bg-slate-50"}`;

  return (
    <div className="relative" data-testid="display-currency-bar">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        title={t("buttonLabel", { name: currentName })}
        aria-label={t("buttonLabel", { name: currentName })}
        className="flex items-center gap-1 rounded-lg border border-slate-200 px-1.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60 sm:px-2"
      >
        <span className="tabular-nums">{current ?? "¤"}</span>
        <span className="hidden sm:inline">
          <Icon path={NAV_ICON_PATHS.chevronDown} size={14} />
        </span>
      </button>

      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-label={tCommon("closeMenu")} />
          <div
            className="fixed inset-x-4 top-16 z-20 flex max-h-[70vh] flex-col rounded-lg border border-slate-200 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:end-0 sm:top-auto sm:mt-2 sm:w-72"
            role="dialog"
            aria-label={t("choose")}
          >
            <div className="border-b border-slate-100 p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tc("search")}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                aria-label={tc("searchLabel")}
              />
              <p className="mt-2 text-xs text-slate-500">{t("hint")}</p>
            </div>
            <div className="overflow-y-auto py-1">
              <button type="button" onClick={() => choose(null)} className={row(current === null)} data-testid="display-currency-recorded">
                <span className="w-10 shrink-0 font-semibold">¤</span>
                <span className="truncate">
                  {t("asRecorded")}
                  <span className="block text-xs font-normal text-slate-400">{t("asRecordedHint")}</span>
                </span>
                {current === null && <Icon path={NAV_ICON_PATHS.check} size={14} className="ms-auto" />}
              </button>
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
                  {group.items.map((o) => (
                    <button key={o.code} type="button" onClick={() => choose(o.code)} className={row(o.code === current)}>
                      <span className="w-10 shrink-0 font-semibold tabular-nums">{o.code}</span>
                      <span className="truncate">{o.name}</span>
                      {o.code === current && <Icon path={NAV_ICON_PATHS.check} size={14} className="ms-auto" />}
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-400">{tc("noMatch")}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
