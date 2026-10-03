"use server";

import { actionT, issueMessage } from "@/server/i18n/action-messages";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { currentUser, requireTenantMember } from "@/server/tenant/context";

const createCouponSchema = z.object({
  tenantId: z.uuid(),
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, "@marketing.codeChars"),
  description: z.string().trim().max(200).optional().or(z.literal("")),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.coerce.number().positive(),
  currencyExponent: z.coerce.number().int().min(0).max(3),
  minOrderMajor: z.coerce.number().min(0).optional(),
  usageLimit: z.coerce.number().int().positive().optional(),
  startsAt: z.string().optional().or(z.literal("")),
  endsAt: z.string().optional().or(z.literal("")),
  locale: z.string(),
  slug: z.string().min(1),
});

/** Creates a coupon. Eligibility/discount math is never computed here — only `validate_coupon` and `create_order_from_cart` (SQL) ever decide whether or how much a coupon discounts an order. */
export async function createCouponAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createCouponSchema.safeParse({
    tenantId: formData.get("tenantId"),
    code: formData.get("code"),
    description: formData.get("description"),
    discountType: formData.get("discountType"),
    discountValue: formData.get("discountValue"),
    currencyExponent: formData.get("currencyExponent"),
    minOrderMajor: formData.get("minOrderMajor") || undefined,
    usageLimit: formData.get("usageLimit") || undefined,
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return issueMessage(t, parsed.error.issues, "checkFields");

  const discountValue =
    parsed.data.discountType === "percentage"
      ? Math.round(parsed.data.discountValue * 100)
      : Math.round(parsed.data.discountValue * 10 ** parsed.data.currencyExponent);
  if (parsed.data.discountType === "percentage" && discountValue > 10000) {
    return t("marketing.over100");
  }

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const user = await currentUser();
  const supabase = await createUserClient();

  const { error } = await supabase.from("coupons").insert({
    tenant_id: parsed.data.tenantId,
    code: parsed.data.code.toUpperCase(),
    description: parsed.data.description || null,
    discount_type: parsed.data.discountType,
    discount_value: discountValue,
    min_order_minor: Math.round((parsed.data.minOrderMajor ?? 0) * 10 ** parsed.data.currencyExponent),
    usage_limit: parsed.data.usageLimit ?? null,
    starts_at: parsed.data.startsAt || null,
    ends_at: parsed.data.endsAt || null,
    created_by: user?.id ?? null,
  });
  if (error) {
    if (error.code === "23505") return t("marketing.codeExists");
    return t("marketing.failed");
  }

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/marketing`);
}

const toggleCouponSchema = z.object({
  couponId: z.uuid(),
  status: z.enum(["active", "disabled"]),
  slug: z.string().min(1),
  locale: z.string(),
});

export async function toggleCouponAction(formData: FormData): Promise<void> {
  const parsed = toggleCouponSchema.safeParse({
    couponId: formData.get("couponId"),
    status: formData.get("status"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.from("coupons").update({ status: parsed.data.status }).eq("id", parsed.data.couponId);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/marketing`);
}
