"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const createBranchSchema = z.object({
  tenantId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  isDefault: z.enum(["on"]).optional(),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function createBranchAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createBranchSchema.safeParse({
    tenantId: formData.get("tenantId"),
    name: formData.get("name"),
    phone: formData.get("phone"),
    isDefault: formData.get("isDefault") ?? undefined,
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();

  if (parsed.data.isDefault === "on") {
    await supabase.from("branches").update({ is_default: false }).eq("tenant_id", parsed.data.tenantId);
  }

  const { error } = await supabase.from("branches").insert({
    tenant_id: parsed.data.tenantId,
    name: { [parsed.data.locale]: parsed.data.name },
    phone: parsed.data.phone || null,
    is_default: parsed.data.isDefault === "on",
  });
  if (error) return `VALIDATION_ERROR: ${error.message}`;

  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/branches`);
}

const createCategorySchema = z.object({
  tenantId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function createCategoryAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createCategorySchema.safeParse({
    tenantId: formData.get("tenantId"),
    name: formData.get("name"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("categories")
    .insert({ tenant_id: parsed.data.tenantId, name: { [parsed.data.locale]: parsed.data.name } });
  if (error) return `VALIDATION_ERROR: ${error.message}`;

  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/products`);
}

const createProductSchema = z.object({
  tenantId: z.uuid(),
  categoryId: z.uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1).max(160),
  priceMajor: z.coerce.number().min(0).max(1_000_000),
  currencyExponent: z.coerce.number().int().min(0).max(3),
  status: z.enum(["draft", "active"]),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function createProductAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createProductSchema.safeParse({
    tenantId: formData.get("tenantId"),
    categoryId: formData.get("categoryId") ?? undefined,
    name: formData.get("name"),
    priceMajor: formData.get("priceMajor"),
    currencyExponent: formData.get("currencyExponent"),
    status: formData.get("status"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const priceMinor = Math.round(parsed.data.priceMajor * 10 ** parsed.data.currencyExponent);

  const { error } = await supabase.from("products").insert({
    tenant_id: parsed.data.tenantId,
    category_id: parsed.data.categoryId || null,
    name: { [parsed.data.locale]: parsed.data.name },
    price_minor: priceMinor,
    status: parsed.data.status,
  });
  if (error) return `VALIDATION_ERROR: ${error.message}`;

  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/products`);
}
