"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { isLocale } from "@/i18n/locales";
import { actionT } from "@/server/i18n/action-messages";
import { isRateLimited } from "@/server/shared/rate-limit";
import { createUserClient } from "@/server/supabase/clients";

// Slows credential-stuffing/guessing against one account (spec §61,
// Phase 11 hardening) — best-effort, per-process, keyed by the attempted
// email regardless of whether it exists, so an attacker gets no signal
// either way. A legitimate user mistyping a password a few times never
// gets close to this.
const AUTH_RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 10;

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
  locale: z.string(),
  // Only ever a same-origin, in-app path (e.g. an invite link) — validated
  // below with a leading-slash check, never followed as given.
  redirectTo: z.string().optional(),
});

function localeOrDefault(value: FormDataEntryValue | null): string {
  const str = String(value ?? "");
  return isLocale(str) ? str : "en";
}

/** A relative, in-app path only — guards against an open redirect via a crafted `redirectTo`. */
function safeRedirectTarget(locale: string, redirectTo: string | undefined): string {
  // Browsers read "/\host" like "//host", so a backslash anywhere is refused too.
  if (redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//") && !redirectTo.includes("\\")) return redirectTo;
  return `/${locale}`;
}

export async function signInAction(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return t("auth.signInInvalid");
  if (isRateLimited(`signin:${parsed.data.email.toLowerCase()}`, AUTH_RATE_LIMIT_WINDOW_MS, AUTH_RATE_LIMIT_MAX_ATTEMPTS)) {
    return t("auth.tooMany");
  }

  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return t("auth.incorrect");
  redirect(safeRedirectTarget(parsed.data.locale, parsed.data.redirectTo));
}

export async function signUpAction(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return t("auth.signUpInvalid");
  if (isRateLimited(`signup:${parsed.data.email.toLowerCase()}`, AUTH_RATE_LIMIT_WINDOW_MS, AUTH_RATE_LIMIT_MAX_ATTEMPTS)) {
    return t("auth.tooMany");
  }

  const supabase = await createUserClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.code === "user_already_exists" || /already registered/i.test(error.message)) return t("auth.alreadyRegistered");
    if (error.code === "weak_password" || /password/i.test(error.message)) return t("auth.weakPassword");
    return t("auth.signUpFailed");
  }
  redirect(safeRedirectTarget(parsed.data.locale, parsed.data.redirectTo));
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = localeOrDefault(formData.get("locale"));
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  redirect(`/${locale}/login`);
}
