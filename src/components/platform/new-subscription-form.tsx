"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";

import { createSubscriptionAction, type NewSubscriptionState } from "@/server/platform/subscriber-create-actions";

type Option = { value: string; label: string };
export type PlanOption = { key: string; label: string; interval: "month" | "year"; trialDays: number };

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

/** Super Admin → Subscribers → New subscription. */
export function NewSubscriptionForm({
  locale,
  plans,
  businessTypes,
  currencies,
  defaultCurrency,
}: {
  locale: string;
  plans: PlanOption[];
  businessTypes: Option[];
  currencies: string[];
  defaultCurrency: string;
}) {
  const t = useTranslations("platform.newSubscription");
  const [state, action, pending] = useActionState<NewSubscriptionState, FormData>(createSubscriptionAction, undefined);
  const [status, setStatus] = useState<"trialing" | "active">("trialing");
  const [planKey, setPlanKey] = useState(plans[0]?.key ?? "");
  const plan = plans.find((p) => p.key === planKey);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="grid gap-4 sm:grid-cols-2"
      data-testid="new-subscription-form"
    >
      <input type="hidden" name="locale" value={locale} />
      <fieldset className="contents">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t("ownerEmail")}
          <input name="ownerEmail" type="email" required dir="ltr" className={input} />
          <span className="text-xs font-normal text-slate-500">{t("ownerEmailHint")}</span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t("ownerName")}
          <input name="ownerName" maxLength={120} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t("businessName")}
          <input name="businessName" required minLength={2} maxLength={120} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t("businessType")}
          <select name="businessType" required defaultValue="" className={input}>
            <option value="" disabled>
              {t("choose")}
            </option>
            {businessTypes.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t("language")}
          <select name="language" defaultValue={locale} className={input}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="fr">Français</option>
          </select>
          <span className="text-xs font-normal text-slate-500">{t("languageHint")}</span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t("currency")}
          <select name="currency" defaultValue={defaultCurrency} className={input}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t("country")}
          <input name="country" maxLength={80} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t("phone")}
          <input name="phone" type="tel" maxLength={40} dir="ltr" className={input} />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:col-span-2">
        <legend className="px-1 text-sm font-semibold text-slate-800">{t("subscription")}</legend>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t("plan")}
          <select name="plan" value={planKey} onChange={(e) => setPlanKey(e.target.value)} className={input} required>
            {plans.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label={t("status")}>
          {(["trialing", "active"] as const).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} />
              {t(`status_${s}`)}
            </label>
          ))}
        </div>
        {status === "trialing" ? (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {t("trialDays")}
            <input key={planKey} name="trialDays" type="number" min={1} max={365} defaultValue={plan?.trialDays ?? 7} className={`${input} w-32`} />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {t("periodEnd")}
            <input name="periodEnd" type="date" className={`${input} w-48`} />
            <span className="text-xs font-normal text-slate-500">{t(plan?.interval === "year" ? "periodEndHintYear" : "periodEndHintMonth")}</span>
          </label>
        )}
      </fieldset>

      {state?.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2" role="alert" data-testid="new-subscription-error">
          {state.error}
        </p>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {pending ? t("creating") : t("create")}
        </button>
      </div>
    </form>
  );
}
