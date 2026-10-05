"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { isRateLimited } from "@/server/shared/rate-limit";
import { createUserClient } from "@/server/supabase/clients";

/**
 * Choosing a password from an email link: the account a Super Admin created
 * (an invite link). The link's one-time token is verified from the page (a
 * POST — never on the link's GET, so a mail scanner can't use it up), which
 * signs the owner in; then they choose their password.
 */

export type SetPasswordState = { error?: string } | undefined;

export async function verifyAccountTokenAction(tokenHash: string, type: string): Promise<boolean> {
  if (!/^[\w-]{10,200}$/.test(tokenHash) || (type !== "invite" && type !== "recovery")) return false;
  const supabase = await createUserClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  return !error;
}

const schema = z
  .object({ password: z.string().min(8).max(200), confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"] });

export async function setPasswordAction(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const raw = String(formData.get("locale") ?? "");
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "site.setPassword.errors" });
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("signInFirst") };
  if (isRateLimited(`set-password:${user.id}`, 10 * 60_000, 10)) return { error: t("tooMany") };
  const parsed = schema.safeParse({ password: formData.get("password"), confirmPassword: formData.get("confirmPassword") });
  if (!parsed.success) return { error: t(parsed.error.issues[0]?.path[0] === "confirmPassword" ? "differ" : "short") };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: t(error.code === "weak_password" ? "weak" : error.code === "same_password" ? "same" : "failed") };
  redirect(`/${locale}/subscriber`);
}
