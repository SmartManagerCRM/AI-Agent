"use client";

import { useRouter } from "next/navigation";
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
      { label: "Middle East & North Africa", items: sorted.filter((o) => o.mena) },
      { label: "International", items: sorted.filter((o) => !o.mena) },
    ].filter((g) => g.items.length > 0);
  }, [options, query]);

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
        title={`Business currency: ${currentName}`}
        aria-label={`Business currency: ${current} — ${currentName}`}
        className="flex items-center gap-1 rounded-lg border border-slate-200 px-1.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 sm:px-2"
      >
        <span className="tabular-nums">{current}</span>
        <span className="hidden sm:inline">
          <Icon path={NAV_ICON_PATHS.chevronDown} size={14} />
        </span>
      </button>

      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-label="Close menu" />
          <div
            className="absolute end-0 z-20 mt-2 flex max-h-[70vh] w-72 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-slate-200 bg-white shadow-lg"
            role="dialog"
            aria-label="Choose the business currency"
          >
            <div className="border-b border-slate-100 p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search currency…"
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                aria-label="Search currency"
              />
              {!canChange && (
                <p className="mt-2 text-xs text-slate-500">Only the business owner or an admin can change the currency.</p>
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
              {groups.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-400">No currency matches.</p>}
            </div>
          </div>
        </>
      )}

      {(pending || preview || notice) && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Change currency">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" data-testid="currency-dialog">
            {pending && !preview && !notice && <p className="text-sm text-slate-600">Getting today&apos;s exchange rate…</p>}

            {preview && !preview.ok && (
              <>
                <p className="text-sm text-amber-800">{preview.message}</p>
                <div className="mt-4 flex justify-end">
                  <Button variant="secondary" onClick={() => setPreview(null)}>
                    Close
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
                  <Button onClick={() => setNotice(null)}>OK</Button>
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
  const before = (minor: number) => formatMoney(minor, preview.from, preview.fromExponent, locale);
  const after = (minor: number) => formatMoney(minor, preview.to, preview.toExponent, locale);
  const rateText = preview.rate >= 1 ? preview.rate.toFixed(4) : preview.rate.toPrecision(4);
  const asOf = preview.asOf ? new Date(preview.asOf).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <>
      <h2 className="text-base font-semibold text-slate-900">
        Switch your business to {preview.to}?
      </h2>
      <p className="mt-2 text-sm text-slate-700" data-testid="currency-rate">
        1 {preview.from} = <strong className="tabular-nums">{rateText}</strong> {preview.to}
      </p>
      <p className="text-xs text-slate-500">
        {preview.source === "open.er-api.com" ? (
          <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer" className="underline">
            Rates By Exchange Rate API
          </a>
        ) : (
          <>Rates: {preview.source}</>
        )}
        {asOf ? ` · updated ${asOf}` : ""}
      </p>

      <ul className="mt-3 space-y-1 text-sm text-slate-700">
        <li>
          {preview.products} product price{preview.products === 1 ? "" : "s"} and {preview.services} service price
          {preview.services === 1 ? "" : "s"} will be converted.
        </li>
        {preview.deliveryFee && (
          <li>
            Delivery fee: {before(preview.deliveryFee.beforeMinor)} → {after(preview.deliveryFee.afterMinor)}
          </li>
        )}
        {preview.coupons > 0 && <li>Fixed-amount coupons and minimum orders are converted too.</li>}
        {preview.pricedFromListing > 0 && (
          <li>
            {preview.pricedFromListing} draft{preview.pricedFromListing === 1 ? "" : "s"} waiting for a price get the price
            listed in {preview.to}.
          </li>
        )}
        <li className="text-slate-500">Past orders keep their own currency and totals.</li>
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
          Online payments go through {preview.paymentProvider}: make sure your account accepts {preview.to} before switching.
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={pending}>
          {pending ? "Converting…" : `Convert & switch to ${preview.to}`}
        </Button>
      </div>
    </>
  );
}
