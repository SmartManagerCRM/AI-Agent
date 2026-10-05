import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SetPasswordForm, VerifyAccountLink } from "@/components/site/set-password";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { pageMetadata } from "@/server/site/metadata";
import { currentUser } from "@/server/tenant/context";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "site.setPassword" });
  return pageMetadata(locale, "/set-password", t("metaTitle"), t("text"), { index: false });
}

/**
 * Choosing a password: from the email link sent to the owner of a business a
 * Super Admin created (the link signs them in), or when already signed in.
 */
export default async function SetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const [{ locale: raw }, { token_hash: tokenHash, type }] = await Promise.all([params, searchParams]);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations("site.setPassword");
  const user = await currentUser();

  return (
    <section className="site-hero-bg">
      <div className="mx-auto flex max-w-[520px] flex-col items-center px-4 py-16 sm:py-20">
        <div className="site-card flex w-full flex-col items-center gap-5 rounded-3xl p-8 text-center sm:p-10">
          {tokenHash && !user ? (
            <VerifyAccountLink locale={locale} tokenHash={tokenHash} type={type ?? "invite"} />
          ) : user ? (
            <SetPasswordForm locale={locale} email={user.email ?? null} />
          ) : (
            <>
              <h1 className="text-2xl font-extrabold text-[#0c1a33]">{t("signInTitle")}</h1>
              <p className="text-[15px] text-[#33415c]">{t("signInText")}</p>
              <Link href={`/${locale}/login?redirectTo=${encodeURIComponent(`/${locale}/set-password`)}`} className="site-btn-primary site-focus h-12 rounded-2xl px-6">
                {t("signIn")}
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
