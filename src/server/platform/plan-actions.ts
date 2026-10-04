"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { actionT, issueMessage } from "@/server/i18n/action-messages";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { PUBLIC_SITE_TAG } from "@/server/site/public-data";
import { translateSoon } from "@/server/translate/queue";

/**
 * Super Admin Master Spec, Phase 3 — Subscriptions & Plans management.
 * Real, currently-used fields only (name, price, currency, billing
 * interval, trial length, active/default, sort order — plus what the public
 * pricing page shows: description, features, family, popular, public). `limits` is a real
 * jsonb column but no consumer in the app reads it yet (see
 * src/components/console/trial-card.tsx's own doc comment) — same class
 * of "real column but not surfaced in UI yet" as `products.description`,
 * so it stays out of this form rather than becoming a non-functional
 * feature-matrix editor.
 */

const planKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/, "@platform.keyFormat");

// What the public pricing page shows (src/app/site/[locale]/pricing).
const publicFields = {
  description: z.string().trim().max(160).optional().default(""),
  features: z.string().max(2000).optional().default(""),
  family: z.union([planKeySchema, z.literal("")]).optional().default(""),
  isPopular: z.literal("on").optional(),
  isPublic: z.literal("on").optional(),
};

const readPublicFields = (formData: FormData) => ({
  description: formData.get("description") ?? undefined,
  features: formData.get("features") ?? undefined,
  family: formData.get("family") ?? undefined,
  isPopular: formData.get("isPopular") ?? undefined,
  isPublic: formData.get("isPublic") ?? undefined,
});

/** One feature per line, blank lines dropped. */
const cleanFeatures = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

/** Sets this language's text in a per-language field (an empty text removes it). */
function withLocaleText(existing: unknown, locale: string, text: string): Record<string, string> {
  const next = { ...((existing && typeof existing === "object" ? existing : {}) as Record<string, string>) };
  if (text) next[locale] = text;
  else delete next[locale];
  return next;
}

const createPlanSchema = z.object({
  key: planKeySchema,
  name: z.string().trim().min(1).max(80),
  priceMajor: z.coerce.number().min(0),
  currency: z.string().length(3),
  billingInterval: z.enum(["month", "year"]),
  trialDays: z.coerce.number().int().min(0).max(365),
  sortOrder: z.coerce.number().int().min(0).max(999),
  locale: z.string(),
  ...publicFields,
});

async function currencyExponent(supabase: Awaited<ReturnType<typeof createUserClient>>, code: string) {
  const { data } = await supabase.from("currencies").select("exponent").eq("code", code).maybeSingle();
  return data?.exponent ?? 2;
}

export async function createPlanAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createPlanSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    priceMajor: formData.get("priceMajor"),
    currency: formData.get("currency"),
    billingInterval: formData.get("billingInterval"),
    trialDays: formData.get("trialDays"),
    sortOrder: formData.get("sortOrder"),
    locale: formData.get("locale"),
    ...readPublicFields(formData),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return issueMessage(t, parsed.error.issues, "checkFields");

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const exponent = await currencyExponent(supabase, parsed.data.currency);
  const priceMinor = Math.round(parsed.data.priceMajor * 10 ** exponent);

  const { error } = await supabase.from("subscription_plans").insert({
    key: parsed.data.key,
    name: { [parsed.data.locale]: parsed.data.name },
    price_minor: priceMinor,
    currency: parsed.data.currency,
    billing_interval: parsed.data.billingInterval,
    trial_days: parsed.data.trialDays,
    sort_order: parsed.data.sortOrder,
    description: withLocaleText({}, parsed.data.locale, parsed.data.description),
    features: withLocaleText({}, parsed.data.locale, cleanFeatures(parsed.data.features)),
    plan_family: parsed.data.family || null,
    is_popular: parsed.data.isPopular === "on",
    is_public: parsed.data.isPublic === "on",
  });
  if (error) {
    return error.code === "23505"
      ? t("platform.planExists")
      : t("platform.planCreateFailed");
  }
  translateSoon();

  revalidatePath(`/${parsed.data.locale}/super-admin/plans`);
  revalidateTag(PUBLIC_SITE_TAG, { expire: 0 });
}

const updatePlanSchema = z.object({
  key: planKeySchema,
  name: z.string().trim().min(1).max(80),
  priceMajor: z.coerce.number().min(0),
  currency: z.string().length(3),
  billingInterval: z.enum(["month", "year"]),
  trialDays: z.coerce.number().int().min(0).max(365),
  sortOrder: z.coerce.number().int().min(0).max(999),
  locale: z.string(),
  ...publicFields,
});

export async function updatePlanAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = updatePlanSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    priceMajor: formData.get("priceMajor"),
    currency: formData.get("currency"),
    billingInterval: formData.get("billingInterval"),
    trialDays: formData.get("trialDays"),
    sortOrder: formData.get("sortOrder"),
    locale: formData.get("locale"),
    ...readPublicFields(formData),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return issueMessage(t, parsed.error.issues, "checkFields");

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();

  // Merge into the existing jsonb name rather than overwrite it, so editing
  // this plan in one locale doesn't wipe out its name in the others.
  const { data: existing } = await supabase
    .from("subscription_plans")
    .select("name, description, features")
    .eq("key", parsed.data.key)
    .maybeSingle();
  const mergedName = {
    ...(existing?.name as Record<string, string> | undefined),
    [parsed.data.locale]: parsed.data.name,
  };

  const exponent = await currencyExponent(supabase, parsed.data.currency);
  const priceMinor = Math.round(parsed.data.priceMajor * 10 ** exponent);

  const { error } = await supabase
    .from("subscription_plans")
    .update({
      name: mergedName,
      price_minor: priceMinor,
      currency: parsed.data.currency,
      billing_interval: parsed.data.billingInterval,
      trial_days: parsed.data.trialDays,
      sort_order: parsed.data.sortOrder,
      description: withLocaleText(existing?.description, parsed.data.locale, parsed.data.description),
      features: withLocaleText(existing?.features, parsed.data.locale, cleanFeatures(parsed.data.features)),
      plan_family: parsed.data.family || null,
      is_popular: parsed.data.isPopular === "on",
      is_public: parsed.data.isPublic === "on",
    })
    .eq("key", parsed.data.key);
  if (error) return t("platform.planFailed");
  translateSoon();

  revalidatePath(`/${parsed.data.locale}/super-admin/plans`);
  revalidateTag(PUBLIC_SITE_TAG, { expire: 0 });
}

const setActiveSchema = z.object({ key: z.string(), value: z.enum(["true", "false"]), locale: z.string() });

export async function setPlanActiveAction(formData: FormData): Promise<void> {
  const parsed = setActiveSchema.safeParse({
    key: formData.get("key"),
    value: formData.get("value"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  await supabase
    .from("subscription_plans")
    .update({ is_active: parsed.data.value === "true" })
    .eq("key", parsed.data.key);
  revalidatePath(`/${parsed.data.locale}/super-admin/plans`);
  revalidateTag(PUBLIC_SITE_TAG, { expire: 0 });
}

const setDefaultSchema = z.object({ key: z.string(), locale: z.string() });

export async function setDefaultPlanAction(formData: FormData): Promise<void> {
  const parsed = setDefaultSchema.safeParse({ key: formData.get("key"), locale: formData.get("locale") });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  // subscription_plans_single_default_uidx allows only one is_default row at
  // a time — unset the current one first (mirrors createBranchAction's own
  // "unset, then set" handling of the same kind of partial unique index).
  await supabase.from("subscription_plans").update({ is_default: false }).eq("is_default", true);
  await supabase.from("subscription_plans").update({ is_default: true }).eq("key", parsed.data.key);
  revalidatePath(`/${parsed.data.locale}/super-admin/plans`);
  revalidateTag(PUBLIC_SITE_TAG, { expire: 0 });
}
