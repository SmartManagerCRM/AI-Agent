"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { statusLabel } from "@/lib/i18n-labels";

import {
  updateSubscriberBusinessAction,
  updateSubscriberSubscriptionAction,
} from "@/server/platform/subscriber-actions";

const input = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm";
const label = "flex flex-col gap-1 text-xs font-medium text-slate-600";
const button =
  "rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50";

function Result({ message }: { message: string | undefined }) {
  if (!message) return null;
  const isError = message.startsWith("VALIDATION_ERROR");
  return (
    <p className={`text-sm ${isError ? "text-red-600" : "text-emerald-700"}`}>
      {isError ? message.replace(/^VALIDATION_ERROR: /, "") : message}
    </p>
  );
}

type Option = { value: string; label: string };

export type BusinessEditValues = {
  tenantId: string;
  slug: string;
  nameLocale: string;
  businessName: string;
  businessTypeKey: string;
  status: string;
  contactEmail: string;
  contactPhone: string;
  websiteUrl: string;
  country: string;
  city: string;
  timezone: string;
  defaultLanguage: string;
  deploymentMode: string;
  ownerFullName: string;
  ownerPhone: string;
  ownerEmail: string;
};

/** Business profile + owner contact (Super Admin only — enforced by `admin_update_business`). */
export function BusinessEditForm({
  locale,
  values,
  businessTypes,
  languages,
}: {
  locale: string;
  values: BusinessEditValues;
  businessTypes: Option[];
  languages: string[];
}) {
const t = useTranslations("platform.editForms");
const tAll = useTranslations();
  const [message, formAction, pending] = useActionState(updateSubscriberBusinessAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="tenantId" value={values.tenantId} />
      <input type="hidden" name="slug" value={values.slug} />
      <input type="hidden" name="nameLocale" value={values.nameLocale} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>
          {t("businessName", { lang: values.nameLocale.toUpperCase() })}
          <input name="businessName" required maxLength={120} defaultValue={values.businessName} className={input} />
        </label>
        <label className={label}>
          {t("businessType")}
          <select name="businessTypeKey" defaultValue={values.businessTypeKey} className={input}>
            {businessTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t("businessStatus")}
          <select name="status" defaultValue={values.status} className={input}>
            {["onboarding", "active", "suspended", "closed"].map((s) => (
              <option key={s} value={s}>
                {statusLabel(tAll, s)}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t("reachable")}
          <select name="deploymentMode" defaultValue={values.deploymentMode} className={input}>
            <option value="external_agent">{t("mode.external_agent")}</option>
            <option value="website_widget">{t("mode.website_widget")}</option>
            <option value="both">{t("mode.both")}</option>
          </select>
        </label>
        <label className={label}>
          {t("contactEmail")}
          <input
            name="contactEmail"
            type="email"
            maxLength={200}
            defaultValue={values.contactEmail}
            className={input}
          />
        </label>
        <label className={label}>
          {t("contactPhone")}
          <input name="contactPhone" maxLength={40} defaultValue={values.contactPhone} className={input} />
        </label>
        <label className={label}>
          {t("website")}
          <input name="websiteUrl" maxLength={300} defaultValue={values.websiteUrl} className={input} />
        </label>
        <label className={label}>
          {t("country")}
          <input name="country" maxLength={80} defaultValue={values.country} className={input} />
        </label>
        <label className={label}>
          {t("city")}
          <input name="city" maxLength={80} defaultValue={values.city} className={input} />
        </label>
        <label className={label}>
          {t("timezone")}
          <input
            name="timezone"
            required
            defaultValue={values.timezone}
            placeholder={t("tzPlaceholder")}
            className={input}
          />
        </label>
        <label className={label}>
          {t("defaultLanguage")}
          <select name="defaultLanguage" defaultValue={values.defaultLanguage} className={input}>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="border-t border-slate-100 pt-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">{t("owner")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={label}>
            {t("fullName")}
            <input name="ownerFullName" maxLength={120} defaultValue={values.ownerFullName} className={input} />
          </label>
          <label className={label}>
            {t("phone")}
            <input name="ownerPhone" maxLength={40} defaultValue={values.ownerPhone} className={input} />
          </label>
          <label className={label}>
            {t("signInEmail")}
            <input value={values.ownerEmail} readOnly className={`${input} bg-slate-50 text-slate-500`} />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? t("saving") : t("saveBusiness")}
        </button>
        <Result message={message} />
      </div>
    </form>
  );
}

export type SubscriptionEditValues = {
  tenantId: string;
  slug: string;
  planKey: string;
  status: string;
  /** "YYYY-MM-DDTHH:mm" in UTC, or "". */
  trialEndsAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
};

/** Plan, status, trial end and billing period (Super Admin only — enforced by `admin_update_subscription`). */
export function SubscriptionEditForm({
  locale,
  values,
  plans,
}: {
  locale: string;
  values: SubscriptionEditValues;
  plans: Option[];
}) {
const t = useTranslations("platform.editForms");
const tAll = useTranslations();
  const [message, formAction, pending] = useActionState(updateSubscriberSubscriptionAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="tenantId" value={values.tenantId} />
      <input type="hidden" name="slug" value={values.slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>
          {t("plan")}
          <select name="planKey" defaultValue={values.planKey} className={input}>
            {plans.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t("subscriptionStatus")}
          <select name="status" defaultValue={values.status} className={input}>
            <option value="trialing">{statusLabel(tAll, "trialing")}</option>
            <option value="active">{t("activePaid")}</option>
            <option value="past_due">{statusLabel(tAll, "past_due")}</option>
            <option value="canceled">{statusLabel(tAll, "canceled")}</option>
          </select>
        </label>
        <label className={label}>
          {t("trialEnds")}
          <input
            name="trialEndsAt"
            type="datetime-local"
            required
            defaultValue={values.trialEndsAt}
            className={input}
          />
        </label>
        <div />
        <label className={label}>
          {t("periodStart")}
          <input
            name="currentPeriodStart"
            type="datetime-local"
            defaultValue={values.currentPeriodStart}
            className={input}
          />
        </label>
        <label className={label}>
          {t("periodEnd")}
          <input
            name="currentPeriodEnd"
            type="datetime-local"
            defaultValue={values.currentPeriodEnd}
            className={input}
          />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        {t("subscriptionNote")}
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? t("saving") : t("saveSubscription")}
        </button>
        <Result message={message} />
      </div>
    </form>
  );
}
