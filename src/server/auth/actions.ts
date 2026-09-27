"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { isLocale } from "@/i18n/locales";
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
  if (redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")) return redirectTo;
  return `/${locale}`;
}

export async function signInAction(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  if (!parsed.success) return "VALIDATION_ERROR: enter a valid email and password.";
  if (isRateLimited(`signin:${parsed.data.email.toLowerCase()}`, AUTH_RATE_LIMIT_WINDOW_MS, AUTH_RATE_LIMIT_MAX_ATTEMPTS)) {
    return "AUTH_ERROR: too many attempts — please wait a few minutes and try again.";
  }

  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return "AUTH_ERROR: incorrect email or password.";
  redirect(safeRedirectTarget(parsed.data.locale, parsed.data.redirectTo));
}

export async function signUpAction(_prevState: string | undefined, formData: FormData): Promise<string | undefined> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  if (!parsed.success) return "VALIDATION_ERROR: enter a valid email and an 8+ character password.";
  if (isRateLimited(`signup:${parsed.data.email.toLowerCase()}`, AUTH_RATE_LIMIT_WINDOW_MS, AUTH_RATE_LIMIT_MAX_ATTEMPTS)) {
    return "AUTH_ERROR: too many attempts — please wait a few minutes and try again.";
  }

  const supabase = await createUserClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return `AUTH_ERROR: ${error.message}`;
  redirect(safeRedirectTarget(parsed.data.locale, parsed.data.redirectTo));
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = localeOrDefault(formData.get("locale"));
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  redirect(`/${locale}/login`);
}
