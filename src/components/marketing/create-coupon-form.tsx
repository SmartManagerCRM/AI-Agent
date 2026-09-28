"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/console/button";
import { createCouponAction } from "@/server/marketing/actions";

type Props = { tenantId: string; slug: string; locale: string; currency: string; currencyExponent: number };

export function CreateCouponForm({ tenantId, slug, locale, currency, currencyExponent }: Props) {
  const [error, formAction, pending] = useActionState(createCouponAction, undefined);
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="currencyExponent" value={currencyExponent} />

      <label className="flex flex-col gap-1 text-sm">
        Code
        <input
          name="code"
          required
          maxLength={40}
          placeholder="SAVE10"
          className="w-32 rounded-md border border-neutral-300 px-3 py-2 uppercase"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Discount
        <select
          name="discountType"
          value={discountType}
          onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed")}
          className="rounded-md border border-neutral-300 px-3 py-2"
        >
          <option value="percentage">Percentage</option>
          <option value="fixed">Fixed amount</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {discountType === "percentage" ? "% off" : `${currency} off`}
        <input
          name="discountValue"
          type="number"
          min={0}
          step={discountType === "percentage" ? 1 : 1 / 10 ** currencyExponent}
          max={discountType === "percentage" ? 100 : undefined}
          required
          className="w-24 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Min. order
        <input
          name="minOrderMajor"
          type="number"
          min={0}
          step={1 / 10 ** currencyExponent}
          placeholder="0"
          className="w-24 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Usage limit
        <input
          name="usageLimit"
          type="number"
          min={1}
          placeholder="∞"
          className="w-20 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Starts
        <input name="startsAt" type="date" className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Ends
        <input name="endsAt" type="date" className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>

      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
        Description (optional)
        <input name="description" maxLength={200} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>

      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending}>
        Create coupon
      </Button>
    </form>
  );
}
