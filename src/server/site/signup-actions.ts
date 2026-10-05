"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { consoleOrigin } from "@/lib/hosts";
import { withFreeSlug } from "@/server/business/slug";
import { emailConfigured, sendPlatformEmail } from "@/server/email/resend";
import { renderSignupConfirmationEmail } from "@/server/email/signup-confirmation";
import { sendSubscriptionEmailsSoon } from "@/server/email/subscription-queue";
import { serverEnv } from "@/server/env";
import { isRateLimited } from "@/server/shared/rate-limit";
import { loadPublicPlans } from "@/server/site/public-data";
import { createUserClient, serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Sign-up from the website (Pricing → Start free trial → Sign up): the
 * account (Supabase Auth, as on the login page) and the business, its trial
 * on the plan chosen on the pricing page — monthly or annual, the plan's own
 * trial length (create_business).
 *
 * The new owner confirms their email first: what they entered is kept with
 * the account (its metadata) and the business is created once they've
 * confirmed (the Welcome page finishes it — completePendingSignupAction).
 *
 * The confirmation email is sent by the app from support@smartmanager.me
 * (Resend), like the other account emails: Supabase only creates the account
 * and its one-time token (admin generateLink, which sends nothing), and the
 * link opens the Welcome page, which verifies the token on the server — so it
 * works in any browser or device and doesn't depend on Supabase's redirect
 * settings. For an account that exists but was never confirmed, Supabase
 * keeps its password and only updates the details; a new link is sent.
 */

export type SignupState = { error?: string; field?: string; pendingEmail?: string } | undefined;

const PLAN_KEY = /^[a-z][a-z0-9_-]{1,39}$/;

const businessSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  businessName: z.string().trim().min(2).max(120),
  businessType: z.string().trim().min(1).max(60),
  country: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+\d][\d\s().-]{5,}$|^$/)
    .optional()
    .default(""),
  currency: z.string().regex(/^[A-Z]{3}$/),
  plan: z.string().regex(PLAN_KEY),
  locale: z.string(),
});

const accountSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(8).max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"] });

type PendingSignup = {
  business_name: string;
  business_type: string;
  country: string;
  phone: string;
  currency: string;
  plan: string;
  locale: Locale;
};

const localeOf = (value: unknown): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);

async function errors(locale: Locale) {
  return getTranslations({ locale, namespace: "site.signup.errors" });
}

/** Creates the business on its plan; returns null when done, else an error message key. */
async function createBusiness(supabase: TypedSupabaseClient, fullName: string, p: PendingSignup): Promise<string | null> {
  const { error } = await withFreeSlug(supabase, p.business_name, (slug) =>
    supabase.rpc("create_business", {
      p_business_name: { [p.locale]: p.business_name },
      p_business_type_key: p.business_type,
      p_slug: slug,
      p_default_language: p.locale,
      p_currency: p.currency,
      p_plan_key: p.plan,
      p_country: p.country,
      p_contact_phone: p.phone || undefined,
      p_owner_name: fullName,
    }),
  );
  if (error) return error.code === "22023" ? "planUnavailable" : "createFailed";
  sendSubscriptionEmailsSoon();
  return null;
}

/**
 * Creates (or, if never confirmed, refreshes) the account and emails its
 * confirmation link from support@smartmanager.me. "unavailable" when the
 * email service or the service role isn't configured.
 */
async function sendConfirmationEmail(input: {
  email: string;
  password: string;
  metadata: Record<string, unknown>;
  origin: string;
  locale: Locale;
  name: string;
  businessName: string;
}): Promise<"sent" | "unavailable" | { error: string; field?: string }> {
  if (!emailConfigured()) return "unavailable";
  let admin: TypedSupabaseClient;
  try {
    admin = serviceClient();
  } catch {
    return "unavailable";
  }
  const t = await errors(input.locale);
  // A few confirmation emails per address per hour, whoever asks.
  if (isRateLimited(`signup-mail:${input.email}`, 60 * 60_000, 3)) return { error: t("tooMany") };

  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email: input.email,
    password: input.password,
    options: { data: input.metadata },
  });
  if (error || !data.properties?.hashed_token) {
    if (error?.code === "email_exists" || error?.code === "user_already_exists") return { error: t("alreadyRegistered"), field: "email" };
    if (error?.code === "weak_password") return { error: t("weakPassword"), field: "password" };
    return { error: t("signUpFailed") };
  }
  const type = data.properties.verification_type || "signup";
  const link = `${input.origin}/${input.locale}/welcome?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${encodeURIComponent(type)}`;
  const message = renderSignupConfirmationEmail({ lang: input.locale, name: input.name, businessName: input.businessName, link });
  const result = await sendPlatformEmail({ to: input.email, ...message, idempotencyKey: `signup-confirm-${crypto.randomUUID()}` });
  if (!result.ok) {
    console.error(`[signup] confirmation email not sent: ${result.error}`);
    return { error: t("signUpFailed") };
  }
  return "sent";
}

export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const locale = localeOf(formData.get("locale"));
  const t = await errors(locale);
  const parsed = businessSchema.safeParse({
    fullName: formData.get("fullName"),
    businessName: formData.get("businessName"),
    businessType: formData.get("businessType"),
    country: formData.get("country"),
    phone: formData.get("phone") ?? "",
    currency: formData.get("currency"),
    plan: formData.get("plan"),
    locale,
  });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return { error: t(field === "phone" ? "phone" : "checkFields"), field };
  }
  if (formData.get("terms") !== "on") return { error: t("terms"), field: "terms" };

  const d = parsed.data;
  const plans = await loadPublicPlans();
  if (!plans.some((p) => p.key === d.plan)) return { error: t("planUnavailable") };
  const pending: PendingSignup = {
    business_name: d.businessName,
    business_type: d.businessType,
    country: d.country,
    phone: d.phone,
    currency: d.currency,
    plan: d.plan,
    locale,
  };

  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const account = accountSchema.safeParse({
      email: String(formData.get("email") ?? "").trim(),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });
    if (!account.success) {
      const field = String(account.error.issues[0]?.path[0] ?? "");
      return {
        error: t(field === "confirmPassword" ? "passwordsDiffer" : field === "password" ? "passwordShort" : "email"),
        field,
      };
    }
    const email = account.data.email.toLowerCase();
    if (isRateLimited(`signup:${email}`, 5 * 60_000, 10)) return { error: t("tooMany") };

    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(`signup-ip:${ip}`, 60 * 60_000, 30)) return { error: t("tooMany") };

    const env = serverEnv();
    const origin = consoleOrigin({
      rootDomain: env.PLATFORM_ROOT_DOMAIN,
      consoleSubdomain: env.CONSOLE_SUBDOMAIN,
      agentSubdomain: env.AGENT_SUBDOMAIN,
      scheme: env.PUBLIC_URL_SCHEME,
      port: env.PUBLIC_URL_PORT,
      consoleUrl: env.CONSOLE_URL,
    });
    const metadata = { full_name: d.fullName, pending_signup: pending };
    const sent = await sendConfirmationEmail({ email, password: account.data.password, metadata, origin, locale, name: d.fullName, businessName: d.businessName });
    if (sent === "sent") return { pendingEmail: email };
    if (sent !== "unavailable") return sent;

    // Without the email service (or the service role), Supabase signs up and sends its own email.
    const { data, error } = await supabase.auth.signUp({
      email,
      password: account.data.password,
      options: {
        emailRedirectTo: `${origin}/${locale}/welcome`,
        data: metadata,
      },
    });
    if (error) {
      if (error.code === "user_already_exists" || /already registered/i.test(error.message)) return { error: t("alreadyRegistered"), field: "email" };
      if (error.code === "weak_password" || /password/i.test(error.message)) return { error: t("weakPassword"), field: "password" };
      return { error: t("signUpFailed") };
    }
    // Email confirmation required: the business is created after they confirm and sign in.
    if (!data.session) return { pendingEmail: email };
  } else {
    // Already signed in (e.g. coming back after confirming): this account owns at most one new business from here.
    const { data: memberships } = await supabase.rpc("my_tenant_memberships");
    if (memberships?.length) redirect(`/${locale}/welcome`);
  }

  const failure = await createBusiness(supabase, d.fullName, pending);
  if (failure) return { error: t(failure) };
  await supabase.auth.updateUser({ data: { pending_signup: null } });
  redirect(`/${locale}/welcome`);
}

/**
 * After confirming their email and signing in: creates the business from
 * what they entered on the sign-up page (once — never when they already
 * belong to one).
 */
export async function completePendingSignupAction(rawLocale: string): Promise<{ ok: boolean; error?: string }> {
  const locale = localeOf(rawLocale);
  const t = await errors(locale);
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: t("signInFirst") };
  const { data: memberships } = await supabase.rpc("my_tenant_memberships");
  if (memberships?.length) return { ok: true };

  const raw = user.user_metadata?.pending_signup as Partial<PendingSignup> | undefined;
  const parsed = businessSchema.safeParse({
    fullName: String(user.user_metadata?.full_name ?? "").trim() || "—",
    businessName: raw?.business_name,
    businessType: raw?.business_type,
    country: raw?.country,
    phone: raw?.phone ?? "",
    currency: raw?.currency,
    plan: raw?.plan,
    locale: raw?.locale ?? locale,
  });
  if (!parsed.success) return { ok: false, error: t("nothingPending") };
  const d = parsed.data;
  const failure = await createBusiness(supabase, d.fullName.length >= 2 ? d.fullName : "", {
    business_name: d.businessName,
    business_type: d.businessType,
    country: d.country,
    phone: d.phone,
    currency: d.currency,
    plan: d.plan,
    locale: localeOf(d.locale),
  });
  if (failure) return { ok: false, error: t(failure) };
  await supabase.auth.updateUser({ data: { pending_signup: null } });
  return { ok: true };
}

/** The confirmation email's one-time token: confirms the email and signs the new owner in, in this browser. */
export async function verifySignupTokenAction(tokenHash: string, type: string): Promise<boolean> {
  if (!/^[\w-]{10,200}$/.test(tokenHash) || (type !== "signup" && type !== "email")) return false;
  const supabase = await createUserClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  return !error;
}

/** The confirmation link's one-time code (links Supabase sent itself): signs the new owner in. */
export async function exchangeSignupCodeAction(code: string): Promise<boolean> {
  if (!/^[\w-]{6,200}$/.test(code)) return false;
  const supabase = await createUserClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return !error;
}
