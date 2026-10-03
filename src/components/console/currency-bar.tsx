"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/console/button";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { formatMoney } from "@/lib/money";
import { previewCurrencySwitchAction, switchCurrencyAction, type CurrencyPreview } from "@/server/currency/actions";

export type CurrencyOption = { code: string; name: string; mena: boolean };

/**
 * Header currency picker: the business's selling currency. Choosing another
 * shows the live rate and exactly what will be converted, then switches —
 * every price, the delivery fee and coupons are converted at once.
 */
export function CurrencyBar({
  current,
  options,
  canChange,
  locale,
  slug,
}: {
  current: string;
  options: CurrencyOption[];
  canChange: boolean;
  locale: string;
  slug: string;
}) {
  const router = useRouter();
  const t = useTranslations("console.currency");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<CurrencyPreview | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (o: CurrencyOption) => !q || o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q);
    const sorted = [...options].filter(match).sort((a, b) => a.code.localeCompare(b.code));
    return [
      { label: t("mena"), items: sorted.filter((o) => o.mena) },
      { label: t("international"), items: sorted.filter((o) => !o.mena) },
    ].filter((g) => g.items.length > 0);
  }, [options, query, t]);

  const choose = (code: string) => {
    if (code === current || !canChange) return;
    setOpen(false);
    setNotice(null);
    startTransition(async () => setPreview(await previewCurrencySwitchAction({ locale, slug, currency: code })));
  };
  const confirm = (code: string) =>
    startTransition(async () => {
      const result = await switchCurrencyAction({ locale, slug, currency: code });
      setPreview(null);
      setNotice(result);
      if (result.ok) router.refresh();
    });

  const currentName = options.find((o) => o.code === current)?.name ?? current;

  return (
    <div className="relative" data-testid="currency-bar">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("buttonTitle", { name: currentName })}
        aria-label={t("buttonLabel", { code: current, name: currentName })}
        className="flex items-center gap-1 rounded-lg border border-slate-200 px-1.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 sm:px-2"
      >
        <span className="tabular-nums">{current}</span>
        <span className="hidden sm:inline">
          <Icon path={NAV_ICON_PATHS.chevronDown} size={14} />
        </span>
      </button>

      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-label={tc("closeMenu")} />
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
                placeholder={t("search")}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                aria-label={t("searchLabel")}
              />
              {!canChange && (
                <p className="mt-2 text-xs text-slate-500">{t("ownerOnly")}</p>
              )}
            </div>
            <div className="overflow-y-auto py-1">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
                  {group.items.map((o) => (
                    <button
                      key={o.code}
                      type="button"
                      disabled={!canChange && o.code !== current}
                      onClick={() => choose(o.code)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                        o.code === current ? "bg-emerald-50 font-medium text-emerald-700" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="w-10 shrink-0 font-semibold tabular-nums">{o.code}</span>
                      <span className="truncate">{o.name}</span>
                      {o.code === current && <Icon path={NAV_ICON_PATHS.check} size={14} className="ms-auto" />}
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-400">{t("noMatch")}</p>}
            </div>
          </div>
        </>
      )}

      {(pending || preview || notice) && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={t("change")}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" data-testid="currency-dialog">
            {pending && !preview && !notice && <p className="text-sm text-slate-600">{t("gettingRate")}</p>}

            {preview && !preview.ok && (
              <>
                <p className="text-sm text-amber-800">{preview.message}</p>
                <div className="mt-4 flex justify-end">
                  <Button variant="secondary" onClick={() => setPreview(null)}>
                    {tc("close")}
                  </Button>
                </div>
              </>
            )}

            {preview?.ok && (
              <PreviewBody
                preview={preview}
                locale={locale}
                pending={pending}
                onCancel={() => setPreview(null)}
                onConfirm={() => confirm(preview.to)}
              />
            )}

            {notice && !preview && (
              <>
                <p className={`text-sm ${notice.ok ? "text-emerald-800" : "text-amber-800"}`} role="status">
                  {notice.message}
                </p>
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => setNotice(null)}>{tc("ok")}</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewBody({
  preview,
  locale,
  pending,
  onCancel,
  onConfirm,
}: {
  preview: Extract<CurrencyPreview, { ok: true }>;
  locale: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("console.currency");
  const tc = useTranslations("common");
  const before = (minor: number) => formatMoney(minor, preview.from, preview.fromExponent, locale);
  const after = (minor: number) => formatMoney(minor, preview.to, preview.toExponent, locale);
  const rateText = preview.rate >= 1 ? preview.rate.toFixed(4) : preview.rate.toPrecision(4);
  const asOf = preview.asOf ? new Date(preview.asOf).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <>
      <h2 className="text-base font-semibold text-slate-900">{t("switchTitle", { code: preview.to })}</h2>
      <p className="mt-2 text-sm text-slate-700" data-testid="currency-rate">
        1 {preview.from} = <strong className="tabular-nums">{rateText}</strong> {preview.to}
      </p>
      <p className="text-xs text-slate-500">
        {preview.source === "open.er-api.com" ? (
          <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer" className="underline">
            {t("ratesBy")}
          </a>
        ) : (
          <>{t("ratesFrom", { source: preview.source })}</>
        )}
        {asOf ? t("updated", { date: asOf }) : ""}
      </p>

      <ul className="mt-3 space-y-1 text-sm text-slate-700">
        <li>{t("converted", { products: preview.products, services: preview.services })}</li>
        {preview.deliveryFee && (
          <li>{t("deliveryFee", { before: before(preview.deliveryFee.beforeMinor), after: after(preview.deliveryFee.afterMinor) })}</li>
        )}
        {preview.coupons > 0 && <li>{t("coupons")}</li>}
        {preview.pricedFromListing > 0 && <li>{t("drafts", { count: preview.pricedFromListing, code: preview.to })}</li>}
        <li className="text-slate-500">{t("pastOrders")}</li>
      </ul>

      {preview.examples.length > 0 && (
        <table className="mt-3 w-full text-sm" data-testid="currency-examples">
          <tbody>
            {preview.examples.map((e) => (
              <tr key={e.name} className="border-t border-slate-100">
                <td className="py-1 pe-2 text-slate-700">{e.name}</td>
                <td className="py-1 text-end tabular-nums text-slate-400">{before(e.beforeMinor)}</td>
                <td className="py-1 text-end tabular-nums font-medium text-slate-900">{after(e.afterMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {preview.paymentProvider && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("paymentWarning", { provider: preview.paymentProvider, code: preview.to })}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          {tc("cancel")}
        </Button>
        <Button onClick={onConfirm} disabled={pending}>
          {pending ? t("converting") : t("convertAndSwitch", { code: preview.to })}
        </Button>
      </div>
    </>
  );
}
