"use client";

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
  const [error, formAction, pending] = useActionState(updatePaymentSettingsAction, undefined);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="moyasar" defaultChecked={current.enabled_methods.includes("moyasar")} />
          Moyasar (cards, mada, Apple Pay)
        </label>
        <input
          name="moyasarSecretKey"
          type="password"
          placeholder={current.hasMoyasarKey ? "Secret key saved — leave blank to keep it" : "Moyasar secret key"}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />

        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="tap" defaultChecked={current.enabled_methods.includes("tap")} />
          Tap (cards, mada, KNET, Benefit, Apple Pay)
        </label>
        <input
          name="tapSecretKey"
          type="password"
          placeholder={current.hasTapKey ? "Secret key saved — leave blank to keep it" : "Tap secret key"}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-2 flex flex-col gap-2 border-t border-neutral-100 pt-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="cashOnDelivery" defaultChecked={current.enabled_methods.includes("cash_on_delivery")} />
          Cash on Delivery
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="payOnTable" defaultChecked={current.enabled_methods.includes("pay_on_table")} />
          Pay on Table
        </label>
        <p className="text-xs text-neutral-400">
          Cash on Delivery and Pay on Table need no setup: the order is confirmed immediately and the customer pays in person —
          mark it collected from the Orders page once they do.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        Save
      </Button>
    </form>
  );
}
