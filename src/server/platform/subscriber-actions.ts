"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sendSubscriptionEmailsSoon } from "@/server/email/subscription-queue";
import { actionT, issueMessage } from "@/server/i18n/action-messages";
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
  businessName: text(120).min(1, "@platform.businessNameRequired"),
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

type T = Awaited<ReturnType<typeof actionT>>;

/** The database's VALIDATION_ERROR / NOT_FOUND reasons (supabase/migrations, admin_update_*) → actions.platform.db.*. */
const DB_REASONS: [RegExp, string][] = [
  [/^(business does not exist|no such business\.)$/, "db.noBusiness"],
  [/^this business has no subscription$/, "db.noSubscription"],
  [/^business name is required$/, "businessNameRequired"],
  [/^trial end date is required$/, "trialEndRequired"],
  [/^an active subscription needs its billing period start and end$/, "db.periodBoth"],
  [/^set both billing period dates, or neither$/, "db.periodPair"],
  [/^the billing period must end after it starts$/, "db.periodOrder"],
  [/^invalid (business|subscription) status$/, "db.invalidStatus"],
  [/^invalid contact email$/, "db.invalidEmail"],
  [/^invalid (default language|language for the business name)$/, "db.invalidLanguage"],
  [/^unknown business type$/, "db.unknownType"],
  [/^(unknown or inactive plan .*|unknown plan|plan does not exist)$/, "db.unknownPlan"],
  [/^unknown timezone$/, "db.unknownTimezone"],
];

/** The database's VALIDATION_ERROR / NOT_FOUND message in the user's language, else a generic one. */
function dbMessage(t: T, message: string | undefined, fallbackKey: string): string {
  const m = /^(VALIDATION_ERROR|NOT_FOUND): (.+)$/.exec(message ?? "");
  const key = m ? DB_REASONS.find(([re]) => re.test(m[2]))?.[1] : undefined;
  return `VALIDATION_ERROR: ${t(`platform.${key ?? fallbackKey}`)}`;
}

function fields<T extends z.ZodRawShape>(schema: z.ZodObject<T>, formData: FormData) {
  return Object.fromEntries(Object.keys(schema.shape).map((k) => [k, formData.get(k) ?? ""]));
}

export async function updateSubscriberBusinessAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = businessSchema.safeParse(fields(businessSchema, formData));
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return `VALIDATION_ERROR: ${issueMessage(t, parsed.error.issues, "checkFields")}`;
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
  if (error) return dbMessage(t, error.message, "businessFailed");

  revalidatePath(`/${d.locale}/super-admin/subscribers`);
  revalidatePath(`/${d.locale}/super-admin/businesses/${d.slug}`);
  return t("saved");
}

/** "2026-10-17T09:30" (UTC, from a datetime-local input) → ISO, or null when empty. */
const utcDateTime = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00Z` : v);
    if (Number.isNaN(t)) {
      ctx.addIssue({ code: "custom", message: "@platform.invalidDate" });
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
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return `VALIDATION_ERROR: ${issueMessage(t, parsed.error.issues, "checkFields")}`;
  const d = parsed.data;
  if (!d.trialEndsAt) return `VALIDATION_ERROR: ${t("platform.trialEndRequired")}`;

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
  if (error) return dbMessage(t, error.message, "subscriptionFailed");
  sendSubscriptionEmailsSoon();

  revalidatePath(`/${d.locale}/super-admin/subscribers`);
  revalidatePath(`/${d.locale}/super-admin/usage`);
  revalidatePath(`/${d.locale}/super-admin/businesses/${d.slug}`);
  return t("saved");
}
