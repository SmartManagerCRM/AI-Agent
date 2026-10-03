"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { createPlanAction, updatePlanAction } from "@/server/platform/plan-actions";

type Currency = { code: string };

type Props = {
  locale: string;
  currencies: Currency[];
  plan?: {
    key: string;
    name: string;
    priceMajor: number;
    currency: string;
    billingInterval: "month" | "year";
    trialDays: number;
    sortOrder: number;
  };
};

/** Same form for create and edit — `plan` present means edit (key becomes read-only, action switches). */
export function PlanForm({ locale, currencies, plan }: Props) {
const t = useTranslations("platform.planForm");
  const [error, formAction, pending] = useActionState(plan ? updatePlanAction : createPlanAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-4">
      <input type="hidden" name="locale" value={locale} />

      <label className="flex flex-col gap-1 text-sm">
        {t("key")}
        {plan ? (
          <>
            <input
              value={plan.key}
              readOnly
              className="w-28 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-500"
            />
            <input type="hidden" name="key" value={plan.key} />
          </>
        ) : (
          <input
            name="key"
            required
            placeholder={t("keyPlaceholder")}
            className="w-28 rounded-md border border-neutral-300 px-3 py-2"
          />
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("name", { lang: locale.toUpperCase() })}
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={plan?.name}
          className="w-32 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("price")}
        <input
          name="priceMajor"
          type="number"
          step="0.01"
          min="0"
          required
          defaultValue={plan?.priceMajor}
          className="w-24 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("currency")}
        <select
          name="currency"
          defaultValue={plan?.currency ?? "USD"}
          className="rounded-md border border-neutral-300 px-3 py-2"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("interval")}
        <select
          name="billingInterval"
          defaultValue={plan?.billingInterval ?? "month"}
          className="rounded-md border border-neutral-300 px-3 py-2"
        >
          <option value="month">{t("monthly")}</option>
          <option value="year">{t("yearly")}</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("trialDays")}
        <input
          name="trialDays"
          type="number"
          min="0"
          max="365"
          required
          defaultValue={plan?.trialDays ?? 14}
          className="w-20 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("sortOrder")}
        <input
          name="sortOrder"
          type="number"
          min="0"
          max="999"
          required
          defaultValue={plan?.sortOrder ?? 0}
          className="w-20 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {plan ? t("save") : t("add")}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
