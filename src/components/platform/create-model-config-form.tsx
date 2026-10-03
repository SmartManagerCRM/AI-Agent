"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { createAiModelConfigAction } from "@/server/platform/actions";

type Props = { locale: string };

export function CreateModelConfigForm({ locale }: Props) {
const t = useTranslations("platform.models");
  const [error, formAction, pending] = useActionState(createAiModelConfigAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-4">
      <input type="hidden" name="locale" value={locale} />

      <label className="flex flex-col gap-1 text-sm">
        {t("form.provider")}
        <select name="provider" className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="gemini">Gemini</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("form.model")}
        <input name="model" required placeholder={t("form.modelPlaceholder")} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("form.kind")}
        <select name="kind" className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="fast">{t("kind.fast")}</option>
          <option value="agent">{t("kind.agent")}</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("form.input")}
        <input
          name="inputPrice"
          type="number"
          step="0.0001"
          min="0"
          required
          className="w-28 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("form.output")}
        <input
          name="outputPrice"
          type="number"
          step="0.0001"
          min="0"
          required
          className="w-28 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("form.add")}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
