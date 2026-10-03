"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { Button } from "@/components/console/button";
import { savePlanAction } from "@/server/memberships/actions";

export type PlanFormValues = {
  id?: string;
  name: string;
  description: string;
  kind: "loyalty" | "service";
  price: string;
  joiningFee: string;
  billingPeriod: "none" | "day" | "week" | "month" | "year";
  periodCount: number;
  autoRenew: boolean;
  trialDays: number;
  graceDays: number;
  visitsPerPeriod: string;
  discountPercent: string;
  benefits: string;
  maxMembers: string;
  serviceIds: string[];
};

export const NEW_PLAN: PlanFormValues = {
  name: "",
  description: "",
  kind: "service",
  price: "",
  joiningFee: "",
  billingPeriod: "month",
  periodCount: 1,
  autoRenew: true,
  trialDays: 0,
  graceDays: 3,
  visitsPerPeriod: "",
  discountPercent: "",
  benefits: "",
  maxMembers: "",
  serviceIds: [],
};

const input = "rounded-md border border-neutral-300 px-3 py-2";
const hint = "text-xs font-normal text-slate-400";

/** Create or edit a membership plan: loyalty (free or paid) or a paid service subscription (gym, classes …). */
export function PlanForm({
  locale,
  slug,
  currency,
  exponent,
  services,
  initial,
  onDone,
}: {
  locale: string;
  slug: string;
  currency: string;
  exponent: number;
  services: { id: string; name: string }[];
  initial: PlanFormValues;
  onDone?: () => void;
}) {
const t = useTranslations("console.planForm");
const tCommon = useTranslations("common");
  const [state, formAction, pending] = useActionState(async (prev: Awaited<ReturnType<typeof savePlanAction>>, fd: FormData) => {
    const result = await savePlanAction(prev, fd);
    if (result?.ok) onDone?.();
    return result;
  }, undefined);
  const [kind, setKind] = useState(initial.kind);
  const [period, setPeriod] = useState(initial.billingPeriod);
  const noExpiry = period === "none";
  const step = 1 / 10 ** exponent;

  return (
    <form action={formAction} className="flex flex-col gap-4 text-sm" data-testid="plan-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slug" value={slug} />
      {initial.id && <input type="hidden" name="planId" value={initial.id} />}

      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 font-medium text-slate-700">{t("type")}</legend>
        {(
          [
            ["service", t("serviceLabel"), t("serviceText")],
            ["loyalty", t("loyaltyLabel"), t("loyaltyText")],
          ] as const
        ).map(([value, label, text]) => (
          <label
            key={value}
            className={`flex min-w-56 flex-1 cursor-pointer flex-col rounded-lg border p-3 ${kind === value ? "border-emerald-500 bg-emerald-50" : "border-slate-200"}`}
          >
            <span className="flex items-center gap-2 font-medium text-slate-900">
              <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="accent-emerald-600" />
              {label}
            </span>
            <span className="mt-0.5 text-xs text-slate-500">{text}</span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2">
          {t("planName")}
          <input name="name" required maxLength={120} defaultValue={initial.name} placeholder={kind === "service" ? t("egGym") : t("egClub")} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("pricePerPeriod", { currency })} <span className={hint}>{t("zeroFree")}</span>
          <input name="price" type="number" min={0} step={step} defaultValue={initial.price} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("joiningFee", { currency })} <span className={hint}>{t("oneOff")}</span>
          <input name="joiningFee" type="number" min={0} step={step} defaultValue={initial.joiningFee} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("duration")}
          <select name="billingPeriod" value={period} onChange={(e) => setPeriod(e.target.value as PlanFormValues["billingPeriod"])} className={input}>
            <option value="day">{t("days")}</option>
            <option value="week">{t("weeks")}</option>
            <option value="month">{t("months")}</option>
            <option value="year">{t("years")}</option>
            <option value="none">{t("noExpiry")}</option>
          </select>
        </label>
        {!noExpiry && (
          <label className="flex flex-col gap-1">
            {t("length")} <span className={hint}>{t("lengthHint")}</span>
            <input name="periodCount" type="number" min={1} max={60} required defaultValue={initial.periodCount} className={input} />
          </label>
        )}
        {!noExpiry && (
          <label className="flex flex-col gap-1">
            {t("trial")} <span className={hint}>{t("zeroNone")}</span>
            <input name="trialDays" type="number" min={0} max={365} defaultValue={initial.trialDays} className={input} />
          </label>
        )}
        {!noExpiry && (
          <label className="flex flex-col gap-1">
            {t("grace")} <span className={hint}>{t("afterRenewal")}</span>
            <input name="graceDays" type="number" min={0} max={90} defaultValue={initial.graceDays} className={input} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          {t("visits")} <span className={hint}>{t("emptyUnlimited")}</span>
          <input name="visitsPerPeriod" type="number" min={1} max={10000} defaultValue={initial.visitsPerPeriod} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("discount")} <span className={hint}>{t("onPurchases")}</span>
          <input name="discountPercent" type="number" min={0.01} max={100} step={0.01} defaultValue={initial.discountPercent} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("limit")} <span className={hint}>{t("emptyNoLimit")}</span>
          <input name="maxMembers" type="number" min={1} defaultValue={initial.maxMembers} className={input} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          {t("description")} <span className={hint}>{tCommon("optional")}</span>
          <textarea name="description" rows={2} maxLength={1000} defaultValue={initial.description} className={input} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          {t("benefits")} <span className={hint}>{t("benefitsHint")}</span>
          <textarea name="benefits" rows={2} maxLength={2000} defaultValue={initial.benefits} className={input} />
        </label>
      </div>

      {services.length > 0 && (
        <fieldset>
          <legend className="mb-1 font-medium text-slate-700">
            {t("includedServices")} <span className={hint}>{t("includedHint")}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1">
                <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={initial.serviceIds.includes(s.id)} className="accent-emerald-600" />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!noExpiry && (
        <label className="flex items-center gap-2">
          <input type="checkbox" name="autoRenew" defaultChecked={initial.autoRenew} className="h-4 w-4 accent-emerald-600" />
          {t("autoRenew")} <span className={hint}>{t("autoRenewHint")}</span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? tCommon("saving") : initial.id ? t("savePlan") : t("createPlan")}
        </Button>
        {onDone && initial.id && (
          <Button type="button" variant="secondary" onClick={onDone}>
            {tCommon("cancel")}
          </Button>
        )}
        {state && (
          <p role="status" className={state.ok ? "text-emerald-700" : "text-red-600"}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
