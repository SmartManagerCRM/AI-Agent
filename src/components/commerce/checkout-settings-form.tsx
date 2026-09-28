"use client";

import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { updateCheckoutSettingsAction } from "@/server/commerce/settings-actions";

type Checkout = {
  ordering_enabled: boolean;
  fulfillment_types: ("pickup" | "delivery" | "dine_in")[];
  delivery_fee_minor: number;
  minimum_order_minor: number;
  tax_rate_bps: number;
  tax_included: boolean;
};

type Props = { tenantId: string; slug: string; locale: string; currencyExponent: number; current: Checkout };

export function CheckoutSettingsForm({ tenantId, slug, locale, currencyExponent, current }: Props) {
  const [error, formAction, pending] = useActionState(updateCheckoutSettingsAction, undefined);
  const step = 1 / 10 ** currencyExponent;

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="currencyExponent" value={currencyExponent} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="orderingEnabled" defaultChecked={current.ordering_enabled} />
        Ordering enabled
      </label>

      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pickup" defaultChecked={current.fulfillment_types.includes("pickup")} />
          Pickup
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="delivery" defaultChecked={current.fulfillment_types.includes("delivery")} />
          Delivery
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="dineIn" defaultChecked={current.fulfillment_types.includes("dine_in")} />
          Dine-in (tables)
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Delivery fee
        <input
          name="deliveryFeeMajor"
          type="number"
          step={step}
          min={0}
          defaultValue={current.delivery_fee_minor / 10 ** currencyExponent}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Minimum order
        <input
          name="minimumOrderMajor"
          type="number"
          step={step}
          min={0}
          defaultValue={current.minimum_order_minor / 10 ** currencyExponent}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Tax rate (%)
        <input
          name="taxRatePercent"
          type="number"
          step={0.01}
          min={0}
          max={100}
          defaultValue={current.tax_rate_bps / 100}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="taxIncluded" defaultChecked={current.tax_included} />
        Prices already include tax
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        Save
      </Button>
    </form>
  );
}
