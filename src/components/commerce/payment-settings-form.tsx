"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { updatePaymentSettingsAction } from "@/server/payments/settings-actions";

type Props = {
  tenantId: string;
  slug: string;
  locale: string;
  current: {
    enabled_methods: string[];
    hasMoyasarKey: boolean;
    hasTapKey: boolean;
  };
};

/**
 * Stored secret keys are never sent back to the browser (only whether one
 * is set) — the fields below are write-only: leave a key field blank to
 * keep whatever is already saved, per `updatePaymentSettingsAction`.
 */
export function PaymentSettingsForm({ tenantId, slug, locale, current }: Props) {
const t = useTranslations("console.paymentForm");
  const [error, formAction, pending] = useActionState(updatePaymentSettingsAction, undefined);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="moyasar" defaultChecked={current.enabled_methods.includes("moyasar")} />
          {t("moyasar")}
        </label>
        <input
          name="moyasarSecretKey"
          type="password"
          placeholder={current.hasMoyasarKey ? t("keySaved") : t("moyasarKey")}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />

        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="tap" defaultChecked={current.enabled_methods.includes("tap")} />
          {t("tap")}
        </label>
        <input
          name="tapSecretKey"
          type="password"
          placeholder={current.hasTapKey ? t("keySaved") : t("tapKey")}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-2 flex flex-col gap-2 border-t border-neutral-100 pt-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="cashOnDelivery" defaultChecked={current.enabled_methods.includes("cash_on_delivery")} />
          {t("cod")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="payOnTable" defaultChecked={current.enabled_methods.includes("pay_on_table")} />
          {t("pot")}
        </label>
        <p className="text-xs text-neutral-400">
          {t("cashNote")}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {t("save")}
      </Button>
    </form>
  );
}
