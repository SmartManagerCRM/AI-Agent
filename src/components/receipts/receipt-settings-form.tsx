"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { saveReceiptSettingsAction } from "@/server/receipts/settings-actions";

/** Settings → Receipts: print on a click, or automatically once an order is confirmed. */
export function ReceiptSettingsForm({ slug, locale, mode }: { slug: string; locale: string; mode: "manual" | "auto" }) {
  const t = useTranslations("console.receiptSettings");
  const [state, formAction, pending] = useActionState(saveReceiptSettingsAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3 text-sm" data-testid="receipt-settings-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <p className="text-slate-500">{t("intro")}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t("mode")}</legend>
        {(["manual", "auto"] as const).map((m) => (
          <label key={m} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
            <input type="radio" name="mode" value={m} defaultChecked={mode === m} className="mt-0.5" data-testid={`receipt-mode-${m}`} />
            <span>
              <span className="block font-medium text-slate-900">{m === "auto" ? t("auto") : t("manual")}</span>
              <span className="block text-xs text-slate-500">{m === "auto" ? t("autoHint") : t("manualHint")}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        {state && <span className={state.ok ? "text-emerald-700" : "text-red-600"}>{state.message}</span>}
      </div>
    </form>
  );
}
