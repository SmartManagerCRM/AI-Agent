"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { isLocale, LOCALES, type Locale } from "@/i18n/locales";
import { consoleOrigin } from "@/lib/hosts";
import { withFreeSlug } from "@/server/business/slug";
import { renderAccountInviteEmail } from "@/server/email/account-invite";
import { emailConfigured, sendPlatformEmail } from "@/server/email/resend";
import { sendSubscriptionEmailsSoon } from "@/server/email/subscription-queue";
import { serverEnv } from "@/server/env";
import { actionT } from "@/server/i18n/action-messages";
import { createUserClient, serviceClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/**
 * Super Admin → Subscribers → New subscription: a business, its owner and its
 * subscription (free trial, or active and paid outside the platform) on any
 * active plan, monthly or annual.
 *
 * The owner is the account with that email when there is one; otherwise an
 * account is created (Supabase admin "invite" link — nothing is sent by
 * Supabase) and the owner gets an email from support@smartmanager.me with a
 * one-time link to choose their password (the set-password page).
 */

export type NewSubscriptionState = { error?: string } | undefined;

const schema = z.object({
  locale: z.string(),
  ownerEmail: z.email().max(254),
  ownerName: z.string().trim().max(120).optional().default(""),
  businessName: z.string().trim().min(2).max(120),
  businessType: z.string().trim().min(1).max(60),
  language: z.enum(LOCALES),
  currency: z.string().regex(/^[A-Z]{3}$/),
  plan: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  status: z.enum(["trialing", "active"]),
  trialDays: z.coerce.number().int().min(1).max(365).optional(),
  periodEnd: z.iso.date().optional(),
  country: z.string().trim().max(80).optional().default(""),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+\d][\d\s().-]{5,}$|^$/)
    .optional()
    .default(""),
});

const blankToUndefined = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : undefined);

function origin(): string {
  const env = serverEnv();
  return consoleOrigin({
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
    scheme: env.PUBLIC_URL_SCHEME,
    port: env.PUBLIC_URL_PORT,
    consoleUrl: env.CONSOLE_URL,
  });
}

export async function createSubscriptionAction(_prev: NewSubscriptionState, formData: FormData): Promise<NewSubscriptionState> {
  const rawLocale = String(formData.get("locale") ?? "");
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "en";
  await requireSuperAdmin(locale);
  const t = await actionT(locale);
  const parsed = schema.safeParse({
    locale,
    ownerEmail: String(formData.get("ownerEmail") ?? "").trim(),
    ownerName: formData.get("ownerName") ?? "",
    businessName: formData.get("businessName"),
    businessType: formData.get("businessType"),
    language: formData.get("language"),
    currency: formData.get("currency"),
    plan: formData.get("plan"),
    status: formData.get("status"),
    trialDays: blankToUndefined(formData.get("trialDays")),
    periodEnd: blankToUndefined(formData.get("periodEnd")),
    country: formData.get("country") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return { error: t(field === "ownerEmail" ? "platform.newSubscription.email" : field === "phone" ? "platform.newSubscription.phone" : "checkFields") };
  }
  const d = parsed.data;
  const email = d.ownerEmail.toLowerCase();

  let admin;
  try {
    admin = serviceClient();
  } catch {
    return { error: t("platform.newSubscription.noServiceRole") };
  }

  // The owner: an existing account, else a new one (invited — it chooses its password from our email).
  let ownerId: string | null = null;
  let inviteLink: string | null = null;
  // Exact match (account emails are stored in lower case); never a pattern, where "_" or "%" could match someone else.
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).limit(1).maybeSingle();
  if (existing) {
    ownerId = existing.id;
  } else {
    if (!emailConfigured()) return { error: t("platform.newSubscription.noEmail") };
    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: d.ownerName ? { full_name: d.ownerName } : {} },
    });
    if (error || !data.user || !data.properties?.hashed_token) return { error: t("platform.newSubscription.ownerFailed") };
    ownerId = data.user.id;
    inviteLink = `${origin()}/${d.language}/set-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`;
  }

  // The business and its subscription, as the Super Admin (the database checks that again).
  const supabase = await createUserClient();
  const periodEnd = d.status === "active" && d.periodEnd ? new Date(`${d.periodEnd}T23:59:59Z`).toISOString() : undefined;
  const { slug, error } = await withFreeSlug(supabase, d.businessName, (candidate) =>
    supabase.rpc("admin_create_subscriber", {
      p_owner_id: ownerId,
      p_business_name: { [d.language]: d.businessName },
      p_business_type_key: d.businessType,
      p_slug: candidate,
      p_default_language: d.language,
      p_currency: d.currency,
      p_plan_key: d.plan,
      p_status: d.status,
      p_trial_days: d.status === "trialing" ? d.trialDays : undefined,
      p_period_end: periodEnd,
      p_country: d.country || undefined,
      p_contact_phone: d.phone || undefined,
      p_owner_name: d.ownerName || undefined,
    }),
  );
  if (error) {
    return { error: error.code === "22023" ? t("platform.newSubscription.invalid") : t("platform.newSubscription.failed") };
  }
  sendSubscriptionEmailsSoon();

  if (inviteLink) {
    const message = renderAccountInviteEmail({ lang: d.language, name: d.ownerName, businessName: d.businessName, link: inviteLink });
    const sent = await sendPlatformEmail({ to: email, ...message, idempotencyKey: `account-invite-${ownerId}-${slug}` });
    if (!sent.ok) console.error(`[platform] account email not sent: ${sent.error}`);
    redirect(`/${locale}/super-admin/subscribers/${slug}?created=${sent.ok ? "invited" : "inviteFailed"}`);
  }
  redirect(`/${locale}/super-admin/subscribers/${slug}?created=existing`);
}
