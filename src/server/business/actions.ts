"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const createBusinessSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  businessTypeKey: z.string().trim().min(1),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/, "Use lowercase letters, numbers and hyphens only."),
  defaultLanguage: z.enum(["en", "ar", "fr"]),
  currency: z.string().length(3),
  locale: z.string(),
});

export async function createBusinessAction(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const parsed = createBusinessSchema.safeParse({
    businessName: formData.get("businessName"),
    businessTypeKey: formData.get("businessTypeKey"),
    slug: formData.get("slug"),
    defaultLanguage: formData.get("defaultLanguage"),
    currency: formData.get("currency"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  const supabase = await createUserClient();
  const { data: slugTaken } = await supabase.from("tenants").select("id").eq("slug", parsed.data.slug).maybeSingle();
  if (slugTaken) return "VALIDATION_ERROR: that console URL is already taken.";

  const { error } = await supabase.rpc("create_business", {
    p_business_name: { [parsed.data.defaultLanguage]: parsed.data.businessName },
    p_business_type_key: parsed.data.businessTypeKey,
    p_slug: parsed.data.slug,
    p_default_language: parsed.data.defaultLanguage,
    p_currency: parsed.data.currency,
  });
  if (error) return `VALIDATION_ERROR: ${error.message}`;

  redirect(`/${parsed.data.locale}/t/${parsed.data.slug}`);
}

const profileSchema = z.object({
  tenantId: z.uuid(),
  contactEmail: z.email().optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  websiteUrl: z.url().optional().or(z.literal("")),
  timezone: z.string().trim().min(1).max(60),
  country: z.string().trim().max(80).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  locale: z.string(),
  slug: z.string().min(1),
});

/**
 * Business profile (spec §98 Phase 8) — the tenant's own descriptive
 * fields (`tenants.contact_email`/`contact_phone`/`website_url`/`timezone`/
 * `country`/`city`), distinct from checkout settings. No new SQL function
 * needed: the `tenants_update` RLS policy (Phase 1) already requires
 * `settings.write`, the same permission checkout settings already relies
 * on for the same reason.
 */
export async function updateBusinessProfileAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = profileSchema.safeParse({
    tenantId: formData.get("tenantId"),
    contactEmail: formData.get("contactEmail") ?? "",
    contactPhone: formData.get("contactPhone") ?? "",
    websiteUrl: formData.get("websiteUrl") ?? "",
    timezone: formData.get("timezone"),
    country: formData.get("country") ?? "",
    city: formData.get("city") ?? "",
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      contact_email: parsed.data.contactEmail || null,
      contact_phone: parsed.data.contactPhone || null,
      website_url: parsed.data.websiteUrl || null,
      timezone: parsed.data.timezone,
      country: parsed.data.country || null,
      city: parsed.data.city || null,
    })
    .eq("id", parsed.data.tenantId);
  if (error) return `VALIDATION_ERROR: ${error.message}`;

  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/settings`);
}
