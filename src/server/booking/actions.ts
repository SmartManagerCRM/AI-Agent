"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const createServiceSchema = z.object({
  tenantId: z.uuid(),
  slug: z.string(),
  locale: z.string(),
  name: z.string().trim().min(1).max(160),
  durationMinutes: z.coerce.number().int().min(1).max(480),
  priceMajor: z.coerce.number().min(0).optional(),
  currencyExponent: z.coerce.number().int().min(0).max(3),
});

export async function createServiceAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const rawPrice = formData.get("priceMajor");
  const parsed = createServiceSchema.safeParse({
    tenantId: formData.get("tenantId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
    name: formData.get("name"),
    durationMinutes: formData.get("durationMinutes"),
    priceMajor: rawPrice ? rawPrice : undefined,
    currencyExponent: formData.get("currencyExponent"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const priceMinor =
    parsed.data.priceMajor !== undefined
      ? Math.round(parsed.data.priceMajor * 10 ** parsed.data.currencyExponent)
      : null;

  const { error } = await supabase.from("bookable_services").insert({
    tenant_id: parsed.data.tenantId,
    name: { [parsed.data.locale]: parsed.data.name },
    duration_minutes: parsed.data.durationMinutes,
    price_minor: priceMinor,
  });
  if (error) return "VALIDATION_ERROR: could not create that service — please try again.";

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/bookings`);
}

const setActiveSchema = z.object({
  serviceId: z.uuid(),
  value: z.enum(["true", "false"]),
  locale: z.string(),
  slug: z.string(),
});

export async function setServiceActiveAction(formData: FormData): Promise<void> {
  const parsed = setActiveSchema.safeParse({
    serviceId: formData.get("serviceId"),
    value: formData.get("value"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("bookable_services")
    .update({ is_active: parsed.data.value === "true" })
    .eq("id", parsed.data.serviceId);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/bookings`);
}

const cancelBookingSchema = z.object({ bookingId: z.uuid(), locale: z.string(), slug: z.string() });

export async function cancelBookingAction(formData: FormData): Promise<void> {
  const parsed = cancelBookingSchema.safeParse({
    bookingId: formData.get("bookingId"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("id", parsed.data.bookingId)
    .eq("status", "confirmed");
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/bookings`);
}
