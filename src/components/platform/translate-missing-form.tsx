"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { translateMissingAction } from "@/server/platform/translation-actions";

export function TranslateMissingForm({ locale }: { locale: string }) {
  const t = useTranslations("platform.translation");
  const [message, formAction, pending] = useActionState(translateMissingAction, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        disabled={pending}
        data-testid="translate-missing"
        className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {t("translateMissing")}
      </button>
      {message && (
        <p className="text-sm text-slate-600" data-testid="translate-missing-result">
          {message}
        </p>
      )}
    </form>
  );
}
