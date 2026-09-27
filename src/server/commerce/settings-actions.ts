"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const checkoutSchema = z.object({
  tenantId: z.uuid(),
  orderingEnabled: z.enum(["on"]).optional(),
  pickup: z.enum(["on"]).optional(),
  delivery: z.enum(["on"]).optional(),
  deliveryFeeMajor: z.coerce.number().min(0).default(0),
  minimumOrderMajor: z.coerce.number().min(0).default(0),
  taxRatePercent: z.coerce.number().min(0).max(100).default(0),
  taxIncluded: z.enum(["on"]).optional(),
  currencyExponent: z.coerce.number().int().min(0).max(3),
  locale: z.string(),
  slug: z.string().min(1),
});

/** Owner turns ordering on/off and configures fulfillment/tax (spec §44's "ordering enabled/disabled"). */
export async function updateCheckoutSettingsAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = checkoutSchema.safeParse({
    tenantId: formData.get("tenantId"),
    orderingEnabled: formData.get("orderingEnabled") ?? undefined,
    pickup: formData.get("pickup") ?? undefined,
    delivery: formData.get("delivery") ?? undefined,
    deliveryFeeMajor: formData.get("deliveryFeeMajor"),
    minimumOrderMajor: formData.get("minimumOrderMajor"),
    taxRatePercent: formData.get("taxRatePercent"),
    taxIncluded: formData.get("taxIncluded") ?? undefined,
    currencyExponent: formData.get("currencyExponent"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  const fulfillmentTypes: ("pickup" | "delivery")[] = [];
  if (parsed.data.pickup === "on") fulfillmentTypes.push("pickup");
  if (parsed.data.delivery === "on") fulfillmentTypes.push("delivery");
  if (fulfillmentTypes.length === 0) return "VALIDATION_ERROR: enable at least one fulfillment method.";

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const exponent = parsed.data.currencyExponent;

  const { error } = await supabase
    .from("tenant_settings")
    .update({
      checkout: {
        ordering_enabled: parsed.data.orderingEnabled === "on",
        fulfillment_types: fulfillmentTypes,
        delivery_fee_minor: Math.round(parsed.data.deliveryFeeMajor * 10 ** exponent),
        minimum_order_minor: Math.round(parsed.data.minimumOrderMajor * 10 ** exponent),
        tax_rate_bps: Math.round(parsed.data.taxRatePercent * 100),
        tax_included: parsed.data.taxIncluded === "on",
      },
    })
    .eq("tenant_id", parsed.data.tenantId);
  if (error) return `VALIDATION_ERROR: ${error.message}`;

  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/settings`);
}
