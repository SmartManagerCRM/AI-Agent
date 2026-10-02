"use client";

import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { importCatalogFileAction } from "@/server/catalog/import-actions";

/** Products & Services: add many items at once from an HTML page or a PDF price list (rule-based, no AI cost). */
export function FileImportForm({
  slug,
  locale,
  defaultKind,
}: {
  slug: string;
  locale: string;
  defaultKind: "product" | "service";
}) {
  const [state, formAction, pending] = useActionState(importCatalogFileAction, undefined);
  const skipped = state?.skipped;
  const skippedParts = skipped
    ? [
        skipped.duplicates ? `${skipped.duplicates} already in your catalog` : null,
        skipped.unpriced ? `${skipped.unpriced} without a price` : null,
        skipped.unreadable ? `${skipped.unreadable} unreadable` : null,
      ].filter(Boolean)
    : [];

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="file-import-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <p className="text-sm text-slate-600">
        Upload your menu or price list as a web page (<strong>.html</strong>) or a <strong>PDF</strong>. Items are read
        with rules only — no AI, no cost — and added to your list. Prices without a currency are taken as yours; prices in another currency are never converted — those items are added as drafts for you to price.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          File
          <input
            type="file"
            name="file"
            required
            accept=".html,.htm,.pdf,text/html,application/pdf"
            className="max-w-full text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Add as
          <select name="kind" defaultValue={defaultKind} className="rounded-md border border-neutral-300 px-3 py-2">
            <option value="product">Products</option>
            <option value="service">Bookable services</option>
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Extracting…" : "Add products"}
        </Button>
      </div>
      {pending && <p className="text-xs text-slate-500">Reading the file and extracting items…</p>}
      {state && (
        <div
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
        >
          <p className="font-medium">{state.message}</p>
          {state.needsPrice ? (
            <p className="mt-0.5 text-xs">
              {state.needsPrice} {state.needsPrice === 1 ? "is" : "are"} priced in another currency — added as drafts:
              set your price on each (pencil icon) to put it on sale.
            </p>
          ) : null}
          {state.images && (
            <p className="mt-0.5 text-xs" data-testid="import-images">
              Photos: {state.images.attached} added
              {state.images.failed > 0 ? ` · ${state.images.failed} couldn't be downloaded` : ""}
              {state.images.skipped > 0 ? ` · ${state.images.skipped} not fetched in time (import the file again to fetch the rest)` : ""}.
            </p>
          )}
          {state.imagesUnreachable && (
            <p className="mt-0.5 text-xs">
              The photos in this file point to files next to it, which weren&apos;t uploaded. To bring the photos in, run
              the Business Brain on the page&apos;s web address, or add a photo to each product with the pencil.
            </p>
          )}
          {skippedParts.length > 0 && <p className="mt-0.5 text-xs">Skipped: {skippedParts.join(" · ")}.</p>}
          {state.added && state.added.length > 0 && (
            <p className="mt-1 text-xs text-emerald-700">
              {state.added.join(", ")}
              {state.added.length === 30 ? "…" : ""}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
