"use client";

import { useActionState } from "react";

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
  const [message, formAction, pending] = useActionState(updateSubscriberBusinessAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="tenantId" value={values.tenantId} />
      <input type="hidden" name="slug" value={values.slug} />
      <input type="hidden" name="nameLocale" value={values.nameLocale} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>
          Business name ({values.nameLocale})
          <input name="businessName" required maxLength={120} defaultValue={values.businessName} className={input} />
        </label>
        <label className={label}>
          Business type
          <select name="businessTypeKey" defaultValue={values.businessTypeKey} className={input}>
            {businessTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Business status
          <select name="status" defaultValue={values.status} className={input}>
            <option value="onboarding">Onboarding</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label className={label}>
          Agent reachable as
          <select name="deploymentMode" defaultValue={values.deploymentMode} className={input}>
            <option value="external_agent">Standalone link only</option>
            <option value="website_widget">Website widget only</option>
            <option value="both">Both</option>
          </select>
        </label>
        <label className={label}>
          Contact email
          <input
            name="contactEmail"
            type="email"
            maxLength={200}
            defaultValue={values.contactEmail}
            className={input}
          />
        </label>
        <label className={label}>
          Contact phone
          <input name="contactPhone" maxLength={40} defaultValue={values.contactPhone} className={input} />
        </label>
        <label className={label}>
          Website
          <input name="websiteUrl" maxLength={300} defaultValue={values.websiteUrl} className={input} />
        </label>
        <label className={label}>
          Country
          <input name="country" maxLength={80} defaultValue={values.country} className={input} />
        </label>
        <label className={label}>
          City
          <input name="city" maxLength={80} defaultValue={values.city} className={input} />
        </label>
        <label className={label}>
          Timezone
          <input
            name="timezone"
            required
            defaultValue={values.timezone}
            placeholder="e.g. Asia/Riyadh"
            className={input}
          />
        </label>
        <label className={label}>
          Default language
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
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Owner</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={label}>
            Full name
            <input name="ownerFullName" maxLength={120} defaultValue={values.ownerFullName} className={input} />
          </label>
          <label className={label}>
            Phone
            <input name="ownerPhone" maxLength={40} defaultValue={values.ownerPhone} className={input} />
          </label>
          <label className={label}>
            Sign-in email
            <input value={values.ownerEmail} readOnly className={`${input} bg-slate-50 text-slate-500`} />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Saving…" : "Save business"}
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
  const [message, formAction, pending] = useActionState(updateSubscriberSubscriptionAction, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="tenantId" value={values.tenantId} />
      <input type="hidden" name="slug" value={values.slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>
          Plan
          <select name="planKey" defaultValue={values.planKey} className={input}>
            {plans.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Subscription status
          <select name="status" defaultValue={values.status} className={input}>
            <option value="trialing">Trialing</option>
            <option value="active">Active (paid)</option>
            <option value="past_due">Past due</option>
            <option value="canceled">Canceled</option>
          </select>
        </label>
        <label className={label}>
          Trial ends (UTC)
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
          Billing period start (UTC)
          <input
            name="currentPeriodStart"
            type="datetime-local"
            defaultValue={values.currentPeriodStart}
            className={input}
          />
        </label>
        <label className={label}>
          Billing period end (UTC)
          <input
            name="currentPeriodEnd"
            type="datetime-local"
            defaultValue={values.currentPeriodEnd}
            className={input}
          />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        An active (paid) subscription needs both billing period dates; usage limits are counted inside that period.
        Changes are re-checked against the usage limits immediately and recorded in the audit log.
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Saving…" : "Save subscription"}
        </button>
        <Result message={message} />
      </div>
    </form>
  );
}
