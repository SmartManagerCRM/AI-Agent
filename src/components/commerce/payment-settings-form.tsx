"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, type ReactNode } from "react";

import { Button } from "@/components/console/button";
import { updatePaymentSettingsAction } from "@/server/payments/settings-actions";

type Props = {
  tenantId: string;
  slug: string;
  locale: string;
  /** Where gateways send their webhooks (`<origin>/api/payments/webhook/<gateway>`). */
  webhookBase: string;
  current: {
    enabled_methods: string[];
    hasMoyasarKey: boolean;
    hasTapKey: boolean;
    hasStripeKey: boolean;
    hasStripeWebhookSecret: boolean;
    hasPaypalClientId: boolean;
    hasPaypalSecret: boolean;
    paypalTestMode: boolean;
    hasHyperpayToken: boolean;
    hasHyperpayEntity: boolean;
    hasHyperpayMadaEntity: boolean;
    hyperpayTestMode: boolean;
    hasMyfatoorahToken: boolean;
    myfatoorahCountry: string;
    myfatoorahTestMode: boolean;
  };
};

const COUNTRIES = ["KWT", "SAU", "ARE", "QAT", "BHR", "OMN", "JOR", "EGY"] as const;

const inputClass = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm";

/** A write-only credential: the saved value is never sent back, only whether there is one. */
function Secret({ name, label, saved, savedLabel }: { name: string; label: string; saved: boolean; savedLabel: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-600">
      {label}
      <input name={name} type="password" autoComplete="off" placeholder={saved ? savedLabel : label} className={inputClass} />
    </label>
  );
}

/** One gateway: its on/off switch, and its settings below. */
function Gateway({ name, title, enabled, configured, children }: { name: string; title: string; enabled: boolean; configured: boolean; children: ReactNode }) {
  const t = useTranslations("console.paymentForm");
  const [open, setOpen] = useState(enabled);
  return (
    <div className="rounded-lg border border-neutral-200" data-testid={`gateway-${name}`}>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name={name} defaultChecked={enabled} />
          {title}
        </label>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${configured ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {configured ? t("connected") : t("notConnected")}
          </span>
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-emerald-700 hover:underline" aria-expanded={open}>
            {open ? t("hide") : t("setup")}
          </button>
        </div>
      </div>
      {/* Kept in the form when collapsed, so saving never drops a field. */}
      <div className={`flex flex-col gap-2 border-t border-neutral-100 px-3 py-3 ${open ? "" : "hidden"}`}>{children}</div>
    </div>
  );
}

function WebhookUrl({ label, url }: { label: string; url: string }) {
  return (
    <p className="text-[11px] text-neutral-500">
      {label} <code className="break-all rounded bg-neutral-100 px-1 py-0.5 text-neutral-700" dir="ltr">{url}</code>
    </p>
  );
}

/**
 * Stored credentials are never sent back to the browser (only whether each
 * is set) — the fields below are write-only: leave one blank to keep what is
 * already saved, per `updatePaymentSettingsAction`.
 */
export function PaymentSettingsForm({ tenantId, slug, locale, webhookBase, current }: Props) {
  const t = useTranslations("console.paymentForm");
  const [error, formAction, pending] = useActionState(updatePaymentSettingsAction, undefined);
  const on = (method: string) => current.enabled_methods.includes(method);
  const saved = t("keySaved");

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />

      <p className="text-xs text-neutral-500">{t("intro")}</p>

      <div className="flex flex-col gap-2">
        <Gateway name="moyasar" title={t("moyasar")} enabled={on("moyasar")} configured={current.hasMoyasarKey}>
          <Secret name="moyasarSecretKey" label={t("moyasarKey")} saved={current.hasMoyasarKey} savedLabel={saved} />
        </Gateway>

        <Gateway name="tap" title={t("tap")} enabled={on("tap")} configured={current.hasTapKey}>
          <Secret name="tapSecretKey" label={t("tapKey")} saved={current.hasTapKey} savedLabel={saved} />
        </Gateway>

        <Gateway name="stripe" title={t("stripe")} enabled={on("stripe")} configured={current.hasStripeKey}>
          <Secret name="stripeSecretKey" label={t("stripeKey")} saved={current.hasStripeKey} savedLabel={saved} />
          <Secret name="stripeWebhookSecret" label={t("stripeWebhookSecret")} saved={current.hasStripeWebhookSecret} savedLabel={saved} />
          <WebhookUrl label={t("webhookUrl")} url={`${webhookBase}/stripe`} />
          <p className="text-[11px] text-neutral-500">{t("stripeHint")}</p>
        </Gateway>

        <Gateway name="paypal" title={t("paypal")} enabled={on("paypal")} configured={current.hasPaypalClientId && current.hasPaypalSecret}>
          <Secret name="paypalClientId" label={t("paypalClientId")} saved={current.hasPaypalClientId} savedLabel={saved} />
          <Secret name="paypalClientSecret" label={t("paypalClientSecret")} saved={current.hasPaypalSecret} savedLabel={saved} />
          <label className="flex items-center gap-2 text-xs text-neutral-600">
            <input type="checkbox" name="paypalTestMode" defaultChecked={current.paypalTestMode} />
            {t("paypalSandbox")}
          </label>
          <WebhookUrl label={t("webhookUrl")} url={`${webhookBase}/paypal`} />
          <p className="text-[11px] text-neutral-500">{t("paypalHint")}</p>
        </Gateway>

        <Gateway name="hyperpay" title={t("hyperpay")} enabled={on("hyperpay")} configured={current.hasHyperpayToken && current.hasHyperpayEntity}>
          <Secret name="hyperpayAccessToken" label={t("hyperpayToken")} saved={current.hasHyperpayToken} savedLabel={saved} />
          <Secret name="hyperpayEntityId" label={t("hyperpayEntity")} saved={current.hasHyperpayEntity} savedLabel={saved} />
          <Secret name="hyperpayMadaEntityId" label={t("hyperpayMadaEntity")} saved={current.hasHyperpayMadaEntity} savedLabel={saved} />
          <label className="flex items-center gap-2 text-xs text-neutral-600">
            <input type="checkbox" name="hyperpayTestMode" defaultChecked={current.hyperpayTestMode} />
            {t("testMode")}
          </label>
          <p className="text-[11px] text-neutral-500">{t("hyperpayHint")}</p>
        </Gateway>

        <Gateway name="myfatoorah" title={t("myfatoorah")} enabled={on("myfatoorah")} configured={current.hasMyfatoorahToken}>
          <Secret name="myfatoorahApiToken" label={t("myfatoorahToken")} saved={current.hasMyfatoorahToken} savedLabel={saved} />
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            {t("myfatoorahCountry")}
            <select name="myfatoorahCountry" defaultValue={current.myfatoorahCountry} className={inputClass}>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {t(`country.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-600">
            <input type="checkbox" name="myfatoorahTestMode" defaultChecked={current.myfatoorahTestMode} />
            {t("testMode")}
          </label>
          <WebhookUrl label={t("webhookUrl")} url={`${webhookBase}/myfatoorah`} />
          <p className="text-[11px] text-neutral-500">{t("myfatoorahHint")}</p>
        </Gateway>
      </div>

      <div className="mt-2 flex flex-col gap-2 border-t border-neutral-100 pt-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="cashOnDelivery" defaultChecked={on("cash_on_delivery")} />
          {t("cod")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="payOnTable" defaultChecked={on("pay_on_table")} />
          {t("pot")}
        </label>
        <p className="text-xs text-neutral-400">{t("cashNote")}</p>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-fit">
        {t("save")}
      </Button>
    </form>
  );
}
