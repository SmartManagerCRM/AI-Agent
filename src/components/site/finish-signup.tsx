"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { completePendingSignupAction, exchangeSignupCodeAction } from "@/server/site/signup-actions";

/**
 * The Welcome page's last step after confirming an email: sign in with the
 * link's code (when there is one), then create the business from what was
 * entered at sign-up — and show the result.
 */
export function FinishSignup({ locale, code, mode }: { locale: string; code: string | null; mode: "exchange" | "complete" }) {
  const t = useTranslations("site.welcome");
  const router = useRouter();
  const [error, setError] = useState<{ title?: string; text: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      if (mode === "exchange" && code) {
        const ok = await exchangeSignupCodeAction(code);
        if (!ok) {
          // Supabase only sends a code once the email is confirmed; it can't sign in here when the link was
          // opened in another browser or device than the sign-up (or a second time) — signing in finishes it.
          setError({ title: t("confirmedTitle"), text: t("confirmedText") });
          return;
        }
      } else {
        const result = await completePendingSignupAction(locale);
        if (!result.ok) {
          setError({ text: result.error ?? t("failed") });
          return;
        }
      }
      router.replace(`/${locale}/welcome`);
      router.refresh();
    })();
  }, [code, locale, mode, router, t]);

  return error ? (
    <div className="flex flex-col items-center gap-4" role={error.title ? "status" : "alert"}>
      {error.title ? (
        <>
          <h1 className="text-2xl font-extrabold text-[#0c1a33]">{error.title}</h1>
          <p className="text-[15px] text-[#33415c]">{error.text}</p>
        </>
      ) : (
        <p className="text-[15px] text-rose-700">{error.text}</p>
      )}
      <Link href={`/${locale}/login?redirectTo=${encodeURIComponent(`/${locale}/welcome`)}`} className="site-btn-primary site-focus h-12 rounded-2xl px-6">
        {t("signIn")}
      </Link>
    </div>
  ) : (
    <p className="flex items-center gap-3 text-[15px] font-semibold text-[#33415c]" role="status" data-testid="welcome-finishing">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" aria-hidden />
      {t("finishing")}
    </p>
  );
}
