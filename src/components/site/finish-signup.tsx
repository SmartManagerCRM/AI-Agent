"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { completePendingSignupAction, exchangeSignupCodeAction, verifySignupTokenAction } from "@/server/site/signup-actions";

/**
 * The Welcome page's last step after confirming an email: sign in with the
 * link's code (when there is one), then create the business from what was
 * entered at sign-up — and show the result.
 */
export function FinishSignup({
  locale,
  code,
  token,
  mode,
}: {
  locale: string;
  code: string | null;
  token?: { hash: string; type: string };
  mode: "verify" | "exchange" | "complete";
}) {
  const t = useTranslations("site.welcome");
  const router = useRouter();
  const [error, setError] = useState<{ title?: string; text: string } | null>(null);
  // Each step runs once. After signing in, the page re-renders this same component in "complete" mode.
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (started.current === mode) return;
    started.current = mode;
    setError(null);
    (async () => {
      if (mode === "verify" && token) {
        // Runs from the page (a POST), never on the link's GET — so a mail scanner opening it can't use it up.
        if (!(await verifySignupTokenAction(token.hash, token.type))) {
          setError({ title: t("linkExpiredTitle"), text: t("linkExpiredText") });
          return;
        }
      } else if (mode === "exchange" && code) {
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
  }, [code, locale, mode, router, t, token]);

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
