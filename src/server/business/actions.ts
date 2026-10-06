"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isValidTimeZone } from "@/lib/timezone";
import { bucketWriter, normalizeImage } from "@/server/catalog/product-images";
import { withFreeSlug } from "@/server/business/slug";
import { sendSubscriptionEmailsSoon } from "@/server/email/subscription-queue";
import { createUserClient, serviceClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { actionT } from "@/server/i18n/action-messages";

const createBusinessSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  businessTypeKey: z.string().trim().min(1),
  defaultLanguage: z.enum(["en", "ar", "fr"]),
  currency: z.string().length(3),
  locale: z.string(),
});

/**
 * The tenant's slug (its console/web address, e.g. `/<slug>`) is a
 * system-generated identifier, never something the subscriber types — see
 * the comment on `CreateBusinessForm`. Matches the DB's own
 * `tenants_slug_format` check constraint (same shape, same 48-char cap),
 * and — via `RESERVED_SLUGS` — the routing architecture's fixed top-level
 * words, so a business can never be assigned a slug that would collide
 * with `/login`, `/super-admin`, etc.
 */
export async function createBusinessAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createBusinessSchema.safeParse({
    businessName: formData.get("businessName"),
    businessTypeKey: formData.get("businessTypeKey"),
    defaultLanguage: formData.get("defaultLanguage"),
    currency: formData.get("currency"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return (await actionT(formData.get("locale")))("checkFields");

  const supabase = await createUserClient();
  const { slug, error } = await withFreeSlug(supabase, parsed.data.businessName, (candidate) =>
    supabase.rpc("create_business", {
      p_business_name: { [parsed.data.defaultLanguage]: parsed.data.businessName },
      p_business_type_key: parsed.data.businessTypeKey,
      p_slug: candidate,
      p_default_language: parsed.data.defaultLanguage,
      p_currency: parsed.data.currency,
    }),
  );
  if (error) return (await actionT(parsed.data.locale))("business.createFailed");
  sendSubscriptionEmailsSoon();

  redirect(`/${parsed.data.locale}/${slug}`);
}

const profileSchema = z.object({
  tenantId: z.uuid(),
  contactEmail: z.email().optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  websiteUrl: z.url().optional().or(z.literal("")),
  timezone: z.string().trim().min(1).max(60),
  country: z.string().trim().max(80).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  // Legal details, printed on receipts.
  legalName: z.string().trim().max(160).optional().or(z.literal("")),
  vatNumber: z.string().trim().max(40).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
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
    legalName: formData.get("legalName") ?? "",
    vatNumber: formData.get("vatNumber") ?? "",
    address: formData.get("address") ?? "",
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return (await actionT(formData.get("locale")))("checkFields");

  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  // Only a real time zone name (an unchanged old value may stay until the owner picks one).
  if (!isValidTimeZone(parsed.data.timezone) && parsed.data.timezone !== tenant.timezone) {
    return (await actionT(parsed.data.locale))("business.chooseTimezone");
  }
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
      legal_name: parsed.data.legalName || null,
      vat_number: parsed.data.vatNumber || null,
      address: parsed.data.address || null,
    })
    .eq("id", parsed.data.tenantId);
  if (error) return (await actionT(parsed.data.locale))("business.profileFailed");

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/settings`);
}

const deploymentModeSchema = z.object({
  tenantId: z.uuid(),
  deploymentMode: z.enum(["external_agent", "website_widget", "both"]),
  locale: z.string(),
  slug: z.string().min(1),
});

/**
 * Which public surface(s) the Agent is reachable on (spec §45, Phase 10):
 * the standalone External Agent link, the embeddable website widget, or
 * both. A plain RLS-scoped update, same `settings.write` gate as the
 * business profile above — no new SQL function needed here either.
 */
export async function setDeploymentModeAction(formData: FormData): Promise<void> {
  const parsed = deploymentModeSchema.safeParse({
    tenantId: formData.get("tenantId"),
    deploymentMode: formData.get("deploymentMode"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.from("tenants").update({ deployment_mode: parsed.data.deploymentMode }).eq("id", parsed.data.tenantId);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/agent`);
}

const logoSchema = z.object({ locale: z.string(), slug: z.string().min(1) });
const MAX_LOGO_BYTES = 3_000_000;
/** Plenty for a sidebar or Agent header mark, even on high-density screens. */
const LOGO_EDGE = 512;

export type BusinessLogoState = { ok: boolean; message: string } | undefined;

/**
 * Settings → Logo: the business's own logo, shown next to its name in the
 * console and on the customer Agent. The picture is re-encoded on the
 * server (WebP, transparency kept) before it is stored; the change itself
 * runs under the owner's own session (RLS `settings.write`), so someone
 * without that permission changes nothing and the file is removed.
 */
export async function updateBusinessLogoAction(_prev: BusinessLogoState, formData: FormData): Promise<BusinessLogoState> {
  const t = await actionT(formData.get("locale"));
  const parsed = logoSchema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return { ok: false, message: t("reload") };
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const remove = formData.get("remove") === "on";
  const file = formData.get("logo");
  if (!remove && (!(file instanceof File) || file.size === 0)) return { ok: false, message: t("business.chooseLogo") };
  if (file instanceof File && file.size > MAX_LOGO_BYTES) return { ok: false, message: t("business.logoTooLarge") };

  let storage;
  try {
    storage = bucketWriter(serviceClient());
  } catch {
    return { ok: false, message: t("business.logoNoStorage") };
  }
  const previous = tenant.logo_path ?? null;

  let path: string | null = null;
  if (!remove && file instanceof File) {
    const image = await normalizeImage(new Uint8Array(await file.arrayBuffer()), { maxEdge: LOGO_EDGE }).catch(() => null);
    if (!image) return { ok: false, message: t("business.logoUnusable") };
    const hash = createHash("sha256").update(image.data).digest("hex").slice(0, 16);
    path = `${tenant.id}/logo-${hash}.webp`;
    if (path !== previous && !(await storage.upload(path, image.data, image.contentType))) {
      return { ok: false, message: t("business.logoSaveFailed") };
    }
  }

  const supabase = await createUserClient();
  const { data: updated, error } = await supabase.from("tenants").update({ logo_path: path }).eq("id", tenant.id).select("id");
  if (error || !updated || updated.length === 0) {
    if (path && path !== previous) await storage.remove([path]);
    return {
      ok: false,
      message: error ? t("business.logoSaveFailed") : t("business.logoNoPermission"),
    };
  }
  if (previous && previous !== path) await storage.remove([previous]);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}`, "layout");
  return { ok: true, message: path ? t("business.logoSaved") : t("business.logoRemoved") };
}
