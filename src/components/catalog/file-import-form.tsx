"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { RichMsg } from "@/components/i18n/msg";

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
  const t = useTranslations("console.fileImport");
  const [state, formAction, pending] = useActionState(importCatalogFileAction, undefined);
  const skipped = state?.skipped;
  const skippedParts = skipped
    ? [
        skipped.duplicates ? t("duplicates", { n: skipped.duplicates }) : null,
        skipped.unpriced ? t("unpriced", { n: skipped.unpriced }) : null,
        skipped.unreadable ? t("unreadable", { n: skipped.unreadable }) : null,
      ].filter(Boolean)
    : [];

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="file-import-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <p className="text-sm text-slate-600">
        <RichMsg id="console.fileImport.intro" values={{ strong: (chunks) => <strong>{chunks}</strong> }} />
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("file")}
          <input
            type="file"
            name="file"
            required
            accept=".html,.htm,.pdf,text/html,application/pdf"
            className="max-w-full text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("addAs")}
          <select name="kind" defaultValue={defaultKind} className="rounded-md border border-neutral-300 px-3 py-2">
            <option value="product">{t("products")}</option>
            <option value="service">{t("services")}</option>
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? t("extracting") : t("addProducts")}
        </Button>
      </div>
      {pending && <p className="text-xs text-slate-500">{t("reading")}</p>}
      {state && (
        <div
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
        >
          <p className="font-medium">{state.message}</p>
          {state.needsPrice ? (
            <p className="mt-0.5 text-xs">
              {t("needsPrice", { count: state.needsPrice })}
            </p>
          ) : null}
          {state.images && (
            <p className="mt-0.5 text-xs" data-testid="import-images">
              {t("photos", { n: state.images.attached })}
              {state.images.failed > 0 ? t("photosFailed", { n: state.images.failed }) : ""}
              {state.images.skipped > 0 ? t("photosSkipped", { n: state.images.skipped }) : ""}.
            </p>
          )}
          {state.imagesUnreachable && (
            <p className="mt-0.5 text-xs">
              {t("imagesUnreachable")}
            </p>
          )}
          {skippedParts.length > 0 && <p className="mt-0.5 text-xs">{t("skipped", { list: skippedParts.join(" · ") })}</p>}
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
