"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { ActionIconForm, IconButton } from "@/components/catalog/item-controls";
import { Button } from "@/components/console/button";
import { enrolMemberAction, memberOpAction, planStateAction } from "@/server/memberships/actions";

import { PlanForm, type PlanFormValues } from "./plan-form";

const input = "rounded-md border border-neutral-300 px-3 py-2";

export type PlanSummary = {
  id: string;
  name: string;
  kind: "loyalty" | "service";
  priceLabel: string;
  joiningFeeLabel: string | null;
  periodLabel: string;
  noExpiry: boolean;
  free: boolean;
  trialDays: number;
  graceDays: number;
  visitsPerPeriod: number | null;
  discountPercent: number | null;
  benefits: string[];
  maxMembers: number | null;
  members: number;
  includedServices: string[];
  autoRenewDefault: boolean;
  isActive: boolean;
};

/** One plan in Memberships → Plans: its terms at a glance, and edit / suspend / delete. */
export function PlanRow({
  plan,
  form,
  locale,
  slug,
  currency,
  exponent,
  services,
}: {
  plan: PlanSummary;
  form: PlanFormValues;
  locale: string;
  slug: string;
  currency: string;
  exponent: number;
  services: { id: string; name: string }[];
}) {
const t = useTranslations("console.membershipUi");
const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const fields = { locale, slug, planId: plan.id };
  if (editing) {
    return (
      <div className="rounded-lg border border-emerald-200 p-3">
        <PlanForm locale={locale} slug={slug} currency={currency} exponent={exponent} services={services} initial={form} onDone={() => setEditing(false)} />
      </div>
    );
  }
  const facts = [
    plan.free ? t("free") : `${plan.priceLabel} · ${plan.periodLabel}`,
    plan.free && !plan.noExpiry ? plan.periodLabel : null,
    plan.joiningFeeLabel ? t("joiningFee", { fee: plan.joiningFeeLabel }) : null,
    plan.trialDays ? t("trialDays", { n: plan.trialDays }) : null,
    plan.visitsPerPeriod ? t("visitsPerPeriod", { n: plan.visitsPerPeriod }) : plan.kind === "service" ? t("unlimitedVisits") : null,
    plan.discountPercent ? t("memberDiscount", { n: plan.discountPercent }) : null,
    plan.graceDays && !plan.noExpiry ? t("graceDays", { n: plan.graceDays }) : null,
    plan.maxMembers ? t("limitMembers", { n: plan.maxMembers }) : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-100 p-3 text-sm sm:flex-row sm:items-start sm:justify-between" data-testid="plan-row">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">
          {plan.name}
          <span className={`ms-2 rounded-full px-2 py-0.5 text-xs font-medium ${plan.kind === "service" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>
            {plan.kind === "service" ? t("serviceSubscription") : t("loyalty")}
          </span>
          <span className={`ms-2 rounded-full px-2 py-0.5 text-xs font-medium ${plan.isActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {plan.isActive ? t("open") : t("suspended")}
          </span>
        </p>
        <p className="mt-0.5 text-slate-600">{facts.join(" · ")}</p>
        {plan.includedServices.length > 0 && <p className="mt-0.5 text-xs text-slate-500">{t("includes", { list: plan.includedServices.join(", ") })}</p>}
        {plan.benefits.length > 0 && <p className="mt-0.5 text-xs text-slate-500">{t("benefits", { list: plan.benefits.join(" · ") })}</p>}
        <p className="mt-0.5 text-xs text-slate-400">{t("currentMembers", { count: plan.members })}</p>
      </div>
      <span className="flex shrink-0 items-center gap-1">
        <IconButton icon="edit" label={tCommon("edit")} onClick={() => setEditing(true)} />
        <ActionIconForm action={planStateAction} fields={{ ...fields, op: plan.isActive ? "suspend" : "activate" }}>
          {plan.isActive ? (
            <IconButton type="submit" icon="pause" label={t("suspendPlan")} tone="amber" />
          ) : (
            <IconButton type="submit" icon="play" label={t("openPlan")} tone="emerald" />
          )}
        </ActionIconForm>
        <ActionIconForm
          action={planStateAction}
          fields={{ ...fields, op: "delete" }}
          confirm={t("deletePlanConfirm", { name: plan.name })}
        >
          <IconButton type="submit" icon="trash" label={tCommon("delete")} tone="red" />
        </ActionIconForm>
      </span>
    </div>
  );
}

/** Memberships → Add member: choose a plan (its terms appear), the member's details, start date and payment. */
export function EnrolForm({ locale, slug, plans, today }: { locale: string; slug: string; plans: PlanSummary[]; today: string }) {
const t = useTranslations("console.membershipUi");
const tCommon = useTranslations("common");
  const [state, formAction, pending] = useActionState(enrolMemberAction, undefined);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [paid, setPaid] = useState(true);
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  if (!plan) return <p className="text-sm text-slate-500">{t("createPlanFirst")}</p>;
  const charge = !plan.free;

  return (
    <form action={formAction} className="flex flex-col gap-3 text-sm" data-testid="enrol-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slug" value={slug} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2">
          {t("plan")}
          <select name="planId" value={plan.id} onChange={(e) => setPlanId(e.target.value)} className={input}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.free ? t("free") : p.priceLabel}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col justify-end gap-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-2" data-testid="enrol-plan-terms">
          <span className="font-medium text-slate-800">
            {plan.free ? t("free") : plan.priceLabel} · {plan.periodLabel}
            {plan.joiningFeeLabel && ` · ${t("joiningFee", { fee: plan.joiningFeeLabel })}`}
          </span>
          <span>
            {[
              plan.trialDays ? t("trialDaysFirst", { n: plan.trialDays }) : null,
              plan.visitsPerPeriod ? t("visitsPerPeriod", { n: plan.visitsPerPeriod }) : null,
              plan.discountPercent ? t("discount", { n: plan.discountPercent }) : null,
            ]
              .filter(Boolean)
              .join(" · ") || " "}
          </span>
        </div>
        <label className="flex flex-col gap-1">
          {t("memberName")}
          <input name="name" required maxLength={120} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("phone")} <span className="text-xs text-slate-400">{tCommon("optional")}</span>
          <input name="phone" type="tel" maxLength={40} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("email")} <span className="text-xs text-slate-400">{tCommon("optional")}</span>
          <input name="email" type="email" maxLength={200} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("startDate")}
          <input name="startDate" type="date" required defaultValue={today} className={input} />
        </label>
        {charge && (
          <>
            <label className="flex items-center gap-2 self-end py-2">
              <input type="checkbox" name="paid" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              {plan.trialDays ? t("paidJoiningFee") : t("paidNow")}
            </label>
            {paid && (
              <label className="flex flex-col gap-1">
                {t("paidBy")}
                <select name="method" defaultValue="cash" className={input}>
                  <option value="cash">{t("method.cash")}</option>
                  <option value="card">{t("method.card")}</option>
                  <option value="transfer">{t("method.transfer")}</option>
                  <option value="online">{t("method.online")}</option>
                  <option value="other">{t("method.other")}</option>
                </select>
              </label>
            )}
          </>
        )}
        {!plan.noExpiry && (
          <label className="flex items-center gap-2 self-end py-2" key={plan.id}>
            <input type="checkbox" name="autoRenew" defaultChecked={plan.autoRenewDefault} className="h-4 w-4 accent-emerald-600" />
            {t("autoRenew")}
          </label>
        )}
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
          {t("notes")} <span className="text-xs text-slate-400">{tCommon("optional")}</span>
          <input name="notes" maxLength={1000} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("adding") : t("addMember")}
        </Button>
        {state && (
          <p role="status" className={state.ok ? "text-emerald-700" : "text-red-600"}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/** A member's actions in the members table. */
export function MemberActions({
  locale,
  slug,
  membershipId,
  name,
  status,
  canRenew,
  unpaid,
  checkIn,
}: {
  locale: string;
  slug: string;
  membershipId: string;
  name: string;
  status: "active" | "paused" | "cancelled";
  canRenew: boolean;
  unpaid: boolean;
  checkIn: boolean;
}) {
const t = useTranslations("console.membershipUi");
  const [state, formAction, pending] = useActionState(memberOpAction, undefined);
  const [method, setMethod] = useState("cash");
  if (status === "cancelled") return <span className="text-xs text-slate-400">—</span>;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="method" value={method} />
    </>
  );
  const btn = "rounded-md px-2 py-1 text-xs font-medium ring-1 disabled:opacity-50";
  return (
    <form action={formAction} className="flex flex-col gap-1" data-testid="member-actions">
      {hidden}
      <div className="flex flex-wrap items-center gap-1">
        {status === "active" && checkIn && (
          <button type="submit" name="op" value="checkin" disabled={pending} className={`${btn} bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-700`}>
            {t("checkIn")}
          </button>
        )}
        {(canRenew || unpaid) && (
          <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t("paymentMethod")} className="rounded-md border border-slate-200 px-1 py-1 text-xs">
            <option value="cash">{t("method.cash")}</option>
            <option value="card">{t("method.card")}</option>
            <option value="transfer">{t("method.transferShort")}</option>
            <option value="online">{t("method.online")}</option>
            <option value="other">{t("method.other")}</option>
          </select>
        )}
        {unpaid && (
          <button type="submit" name="op" value="paid" disabled={pending} className={`${btn} text-emerald-700 ring-emerald-200 hover:bg-emerald-50`}>
            {t("markPaid")}
          </button>
        )}
        {canRenew && (
          <button type="submit" name="op" value="renew" disabled={pending} className={`${btn} text-blue-700 ring-blue-200 hover:bg-blue-50`}>
            {t("renew")}
          </button>
        )}
        {status === "active" && (
          <button type="submit" name="op" value="pause" disabled={pending} className={`${btn} text-amber-700 ring-amber-200 hover:bg-amber-50`}>
            {t("freeze")}
          </button>
        )}
        {status === "paused" && (
          <button type="submit" name="op" value="resume" disabled={pending} className={`${btn} text-emerald-700 ring-emerald-200 hover:bg-emerald-50`}>
            {t("resume")}
          </button>
        )}
        <button
          type="submit"
          name="op"
          value="cancel"
          disabled={pending}
          onClick={(e) => {
            if (!window.confirm(t("cancelConfirm", { name }))) e.preventDefault();
          }}
          className={`${btn} text-red-600 ring-red-200 hover:bg-red-50`}
        >
          {t("cancel")}
        </button>
      </div>
      {state && <p className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.message}</p>}
    </form>
  );
}
