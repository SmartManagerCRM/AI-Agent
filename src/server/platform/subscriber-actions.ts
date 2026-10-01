"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/**
 * Super Admin: edit a subscriber. Both writes go through SECURITY DEFINER
 * functions that re-check `is_super_admin()` in the database and audit the
 * change (`admin_update_business`, `admin_update_subscription`), so no
 * subscriber can make these changes even by calling the API directly.
 * Per-subscriber usage thresholds use `setSubscriberUsageOverridesAction`.
 */

const text = (max: number) => z.string().trim().max(max);

const businessSchema = z.object({
  tenantId: z.uuid(),
  slug: z.string(),
  locale: z.string(),
  nameLocale: z.string().regex(/^[a-z]{2}$/),
  businessName: text(120).min(1, "Business name is required."),
  businessTypeKey: z.string().min(1),
  status: z.enum(["onboarding", "active", "suspended", "closed"]),
  contactEmail: text(200),
  contactPhone: text(40),
  websiteUrl: text(300),
  country: text(80),
  city: text(80),
  timezone: z.string().min(1),
  defaultLanguage: z.string().regex(/^[a-z]{2}$/),
  deploymentMode: z.enum(["external_agent", "website_widget", "both"]),
  ownerFullName: text(120),
  ownerPhone: text(40),
});

/** The database's VALIDATION_ERROR / NOT_FOUND message, else a generic one. */
function dbMessage(message: string | undefined, fallback: string): string {
  const m = /^(VALIDATION_ERROR|NOT_FOUND): (.+)$/.exec(message ?? "");
  return m ? `VALIDATION_ERROR: ${m[2]}` : fallback;
}

function fields<T extends z.ZodRawShape>(schema: z.ZodObject<T>, formData: FormData) {
  return Object.fromEntries(Object.keys(schema.shape).map((k) => [k, formData.get(k) ?? ""]));
}

export async function updateSubscriberBusinessAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = businessSchema.safeParse(fields(businessSchema, formData));
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;
  const d = parsed.data;

  await requireSuperAdmin(d.locale);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_update_business", {
    p_tenant_id: d.tenantId,
    p_name_locale: d.nameLocale,
    p_business_name: d.businessName,
    p_business_type_key: d.businessTypeKey,
    p_status: d.status,
    p_contact_email: d.contactEmail || null,
    p_contact_phone: d.contactPhone || null,
    p_website_url: d.websiteUrl || null,
    p_country: d.country || null,
    p_city: d.city || null,
    p_timezone: d.timezone,
    p_default_language: d.defaultLanguage,
    p_deployment_mode: d.deploymentMode,
    p_owner_full_name: d.ownerFullName || null,
    p_owner_phone: d.ownerPhone || null,
  });
  if (error) return dbMessage(error.message, "VALIDATION_ERROR: could not save the business — please try again.");

  revalidatePath(`/${d.locale}/super-admin/subscribers`);
  revalidatePath(`/${d.locale}/super-admin/businesses/${d.slug}`);
  return "Saved.";
}

/** "2026-10-17T09:30" (UTC, from a datetime-local input) → ISO, or null when empty. */
const utcDateTime = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00Z` : v);
    if (Number.isNaN(t)) {
      ctx.addIssue({ code: "custom", message: "Invalid date." });
      return z.NEVER;
    }
    return new Date(t).toISOString();
  });

const subscriptionSchema = z.object({
  tenantId: z.uuid(),
  slug: z.string(),
  locale: z.string(),
  planKey: z.string().min(1),
  status: z.enum(["trialing", "active", "past_due", "canceled"]),
  trialEndsAt: utcDateTime,
  currentPeriodStart: utcDateTime,
  currentPeriodEnd: utcDateTime,
});

export async function updateSubscriberSubscriptionAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = subscriptionSchema.safeParse(fields(subscriptionSchema, formData));
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;
  const d = parsed.data;
  if (!d.trialEndsAt) return "VALIDATION_ERROR: the trial end date is required.";

  await requireSuperAdmin(d.locale);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("admin_update_subscription", {
    p_tenant_id: d.tenantId,
    p_plan_key: d.planKey,
    p_status: d.status,
    p_trial_ends_at: d.trialEndsAt,
    p_current_period_start: d.currentPeriodStart,
    p_current_period_end: d.currentPeriodEnd,
  });
  if (error) return dbMessage(error.message, "VALIDATION_ERROR: could not save the subscription — please try again.");

  revalidatePath(`/${d.locale}/super-admin/subscribers`);
  revalidatePath(`/${d.locale}/super-admin/usage`);
  revalidatePath(`/${d.locale}/super-admin/businesses/${d.slug}`);
  return "Saved.";
}
