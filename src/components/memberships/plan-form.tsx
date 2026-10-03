"use client";

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
        <legend className="mb-1 font-medium text-slate-700">Type</legend>
        {(
          [
            ["service", "Service subscription", "Paid access — gym, classes, car wash, coworking …"],
            ["loyalty", "Loyalty / club", "Free or paid — member discount and perks"],
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
          Plan name
          <input name="name" required maxLength={120} defaultValue={initial.name} placeholder={kind === "service" ? "e.g. Monthly gym" : "e.g. Coffee club"} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Price per period ({currency}) <span className={hint}>0 or empty = free</span>
          <input name="price" type="number" min={0} step={step} defaultValue={initial.price} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Joining fee ({currency}) <span className={hint}>one-off, optional</span>
          <input name="joiningFee" type="number" min={0} step={step} defaultValue={initial.joiningFee} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Duration
          <select name="billingPeriod" value={period} onChange={(e) => setPeriod(e.target.value as PlanFormValues["billingPeriod"])} className={input}>
            <option value="day">Days</option>
            <option value="week">Weeks</option>
            <option value="month">Months</option>
            <option value="year">Years</option>
            <option value="none">No expiry</option>
          </select>
        </label>
        {!noExpiry && (
          <label className="flex flex-col gap-1">
            Length <span className={hint}>e.g. 3 = every 3 months</span>
            <input name="periodCount" type="number" min={1} max={60} required defaultValue={initial.periodCount} className={input} />
          </label>
        )}
        {!noExpiry && (
          <label className="flex flex-col gap-1">
            Free trial (days) <span className={hint}>0 = none</span>
            <input name="trialDays" type="number" min={0} max={365} defaultValue={initial.trialDays} className={input} />
          </label>
        )}
        {!noExpiry && (
          <label className="flex flex-col gap-1">
            Grace period (days) <span className={hint}>after the renewal date</span>
            <input name="graceDays" type="number" min={0} max={90} defaultValue={initial.graceDays} className={input} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          Visits per period <span className={hint}>empty = unlimited</span>
          <input name="visitsPerPeriod" type="number" min={1} max={10000} defaultValue={initial.visitsPerPeriod} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Member discount (%) <span className={hint}>on purchases, optional</span>
          <input name="discountPercent" type="number" min={0.01} max={100} step={0.01} defaultValue={initial.discountPercent} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          Member limit <span className={hint}>empty = no limit</span>
          <input name="maxMembers" type="number" min={1} defaultValue={initial.maxMembers} className={input} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          Description <span className={hint}>optional</span>
          <textarea name="description" rows={2} maxLength={1000} defaultValue={initial.description} className={input} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          Benefits <span className={hint}>one per line — e.g. “Free towel”, “Priority booking”</span>
          <textarea name="benefits" rows={2} maxLength={2000} defaultValue={initial.benefits} className={input} />
        </label>
      </div>

      {services.length > 0 && (
        <fieldset>
          <legend className="mb-1 font-medium text-slate-700">
            Included services <span className={hint}>optional — the bookable services this membership covers</span>
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
          New members renew automatically by default <span className={hint}>(you record each renewal; can be changed per member)</span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : initial.id ? "Save plan" : "Create plan"}
        </Button>
        {onDone && initial.id && (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
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
