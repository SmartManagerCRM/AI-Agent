"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { saveKeptWordsAction } from "@/server/business/translation-actions";

/** Settings → Translation: brand and dish names the automatic translation keeps as written. */
export function KeptWordsForm({ slug, locale, words }: { slug: string; locale: string; words: string[] }) {
  const t = useTranslations("console.keptWords");
  const [state, formAction, pending] = useActionState(saveKeptWordsAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-2 text-sm" data-testid="kept-words-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <p className="text-slate-500">{t("intro")}</p>
      <textarea
        name="words"
        rows={5}
        defaultValue={words.join("\n")}
        placeholder={t("placeholder")}
        dir="auto"
        className="rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
      />
      <p className="text-xs text-slate-400">{t("hint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        {state && <span className={state.ok ? "text-emerald-700" : "text-red-600"}>{state.message}</span>}
      </div>
    </form>
  );
}
