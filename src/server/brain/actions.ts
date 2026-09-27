"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runWebsiteCrawl } from "@/server/brain/crawler";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const addSourceSchema = z.object({
  tenantId: z.uuid(),
  slug: z.string().min(1),
  locale: z.string(),
  url: z.url(),
});

/** Adds a website source and crawls it once, synchronously (spec §9, §72). */
export async function addWebsiteSourceAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = addSourceSchema.safeParse({
    tenantId: formData.get("tenantId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
    url: formData.get("url"),
  });
  if (!parsed.success) return "VALIDATION_ERROR: enter a valid website URL.";

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();

  const { data: source, error: insertError } = await supabase
    .from("business_sources")
    .insert({ tenant_id: parsed.data.tenantId, kind: "website", url: parsed.data.url })
    .select("id")
    .single();
  if (insertError || !source) return `VALIDATION_ERROR: ${insertError?.message ?? "could not add that source."}`;

  try {
    await runWebsiteCrawl(supabase, { tenantId: parsed.data.tenantId, sourceId: source.id, url: parsed.data.url });
  } catch (error) {
    // The crawler already recorded the failure on the source row itself;
    // surface a short message but don't block the page from rendering it.
    revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/brain`);
    return `CRAWL_ERROR: ${error instanceof Error ? error.message : "the crawl failed."}`;
  }

  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/brain`);
}

const recrawlSchema = z.object({
  tenantId: z.uuid(),
  sourceId: z.uuid(),
  url: z.url(),
  slug: z.string().min(1),
  locale: z.string(),
});

export async function recrawlSourceAction(formData: FormData): Promise<void> {
  const parsed = recrawlSchema.safeParse({
    tenantId: formData.get("tenantId"),
    sourceId: formData.get("sourceId"),
    url: formData.get("url"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  try {
    await runWebsiteCrawl(supabase, parsed.data);
  } catch {
    // Failure is recorded on the source row; the page reflects it on reload.
  }
  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/brain`);
}

const toggleSourceSchema = z.object({
  sourceId: z.uuid(),
  isActive: z.enum(["true", "false"]),
  slug: z.string().min(1),
  locale: z.string(),
});

export async function toggleSourceActiveAction(formData: FormData): Promise<void> {
  const parsed = toggleSourceSchema.safeParse({
    sourceId: formData.get("sourceId"),
    isActive: formData.get("isActive"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("business_sources")
    .update({ is_active: parsed.data.isActive === "true" })
    .eq("id", parsed.data.sourceId);
  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/brain`);
}

const entryActionSchema = z.object({
  entryId: z.uuid(),
  slug: z.string().min(1),
  locale: z.string(),
});

export async function approveBrainEntryAction(formData: FormData): Promise<void> {
  const parsed = entryActionSchema.safeParse({
    entryId: formData.get("entryId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;
  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("approve_brain_entry", { p_entry_id: parsed.data.entryId });
  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/brain`);
}

export async function rejectBrainEntryAction(formData: FormData): Promise<void> {
  const parsed = entryActionSchema.safeParse({
    entryId: formData.get("entryId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;
  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("reject_brain_entry", { p_entry_id: parsed.data.entryId, p_reason: null });
  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/brain`);
}

export async function archiveBrainEntryAction(formData: FormData): Promise<void> {
  const parsed = entryActionSchema.safeParse({
    entryId: formData.get("entryId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;
  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("set_brain_entry_active", { p_entry_id: parsed.data.entryId, p_active: false });
  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/brain`);
}

const createEntrySchema = z.object({
  tenantId: z.uuid(),
  entryType: z.enum(["about", "policy", "faq", "promotion", "instruction", "terminology", "delivery_info", "pickup_info", "payment_methods"]),
  entryKey: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/, "Use lowercase letters, numbers and hyphens."),
  text: z.string().trim().min(1).max(4000),
  locale: z.string(),
  slug: z.string().min(1),
});

/** Manual admin entry (spec §11 "add missing information"). */
export async function createBrainEntryAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createEntrySchema.safeParse({
    tenantId: formData.get("tenantId"),
    entryType: formData.get("entryType"),
    entryKey: formData.get("entryKey"),
    text: formData.get("text"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("create_brain_entry", {
    p_tenant_id: parsed.data.tenantId,
    p_entry_type: parsed.data.entryType,
    p_entry_key: parsed.data.entryKey,
    p_content: { [parsed.data.locale]: parsed.data.text },
    p_source: "admin",
    p_source_id: null,
  });
  if (error) return `VALIDATION_ERROR: ${error.message}`;

  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/brain`);
}
