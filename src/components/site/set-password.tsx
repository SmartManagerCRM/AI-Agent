"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { setPasswordAction, verifyAccountTokenAction, type SetPasswordState } from "@/server/site/password-actions";

const inputClass =
  "site-focus h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-[#0c1a33] outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15";

/** The email link's token: verified from the page (never on the link's GET), which signs the owner in. */
export function VerifyAccountLink({ locale, tokenHash, type }: { locale: string; tokenHash: string; type: string }) {
  const t = useTranslations("site.setPassword");
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void verifyAccountTokenAction(tokenHash, type).then((ok) => {
      if (!ok) return setFailed(true);
      router.replace(`/${locale}/set-password`);
      router.refresh();
    });
  }, [locale, router, tokenHash, type]);

  return failed ? (
    <div className="flex flex-col items-center gap-4" role="status" data-testid="set-password-invalid">
      <h1 className="text-2xl font-extrabold text-[#0c1a33]">{t("linkInvalidTitle")}</h1>
      <p className="text-[15px] text-[#33415c]">{t("linkInvalidText")}</p>
      <Link href={`/${locale}/login`} className="site-btn-primary site-focus h-12 rounded-2xl px-6">
        {t("signIn")}
      </Link>
    </div>
  ) : (
    <p className="flex items-center gap-3 text-[15px] font-semibold text-[#33415c]" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" aria-hidden />
      {t("verifying")}
    </p>
  );
}

export function SetPasswordForm({ locale, email }: { locale: string; email: string | null }) {
  const t = useTranslations("site.setPassword");
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPasswordAction, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        // Keep what was typed if the server says no (no automatic form reset).
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex w-full flex-col gap-4 text-start"
      data-testid="set-password-form"
    >
      <h1 className="text-center text-2xl font-extrabold text-[#0c1a33]">{t("title")}</h1>
      <p className="text-center text-[15px] text-[#33415c]">{t("text")}</p>
      {email && (
        <p className="text-center text-sm font-semibold text-[#0c1a33]" dir="ltr">
          {email}
        </p>
      )}
      <input type="hidden" name="locale" value={locale} />
      {email && <input type="hidden" name="username" value={email} autoComplete="username" />}
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0c1a33]">
        {t("password")}
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        <span className="text-xs font-normal text-slate-500">{t("hint")}</span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0c1a33]">
        {t("confirm")}
        <input name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </label>
      {state?.error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert" data-testid="set-password-error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="site-btn-primary site-focus min-h-12 whitespace-normal rounded-2xl px-4 py-3 text-center text-base leading-snug disabled:opacity-60" data-testid="set-password-submit">
        {t("submit")}
      </button>
    </form>
  );
}
