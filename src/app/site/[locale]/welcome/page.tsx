import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { FinishSignup } from "@/components/site/finish-signup";
import { SiteIcon } from "@/components/site/icons";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { pickText } from "@/lib/site/pricing";
import { pageMetadata } from "@/server/site/metadata";
import { createUserClient } from "@/server/supabase/clients";
import { currentUser, myTenantMemberships } from "@/server/tenant/context";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "site.welcome" });
  return pageMetadata(locale, "/welcome", t("metaTitle"), t("created"), { index: false });
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="site-hero-bg">
      <div className="mx-auto flex max-w-[640px] flex-col items-center px-4 py-16 sm:py-20">
        <div className="site-card flex w-full flex-col items-center gap-5 rounded-3xl p-8 text-center sm:p-10">{children}</div>
      </div>
    </section>
  );
}

/**
 * After sign-up: the account and its business, the plan (monthly or annual)
 * and the trial — read from the database, never assumed. Also where the
 * email-confirmation link lands, finishing a sign-up that had to wait for it.
 */
export default async function WelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ code?: string; token_hash?: string; type?: string; error?: string; error_code?: string }>;
}) {
  const [{ locale: raw }, { code, token_hash: tokenHash, type, error, error_code: errorCode }] = await Promise.all([params, searchParams]);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations("site.welcome");
  const user = await currentUser();

  if (!user) {
    const signIn = `/${locale}/login?redirectTo=${encodeURIComponent(`/${locale}/welcome`)}`;
    // The link in our confirmation email: confirmed (and signed in) here, then the business is created.
    if (tokenHash) {
      return (
        <Panel>
          <FinishSignup locale={locale} code={null} token={{ hash: tokenHash, type: type ?? "signup" }} mode="verify" />
        </Panel>
      );
    }
    // Supabase sends the visitor back with an error instead of a code when the link has expired or was already used.
    if (!code && (error || errorCode)) {
      return (
        <Panel>
          <SiteIcon name="mail" size={40} className="text-emerald-600" />
          <h1 className="text-2xl font-extrabold text-[#0c1a33]">{t("linkExpiredTitle")}</h1>
          <p className="text-[15px] text-[#33415c]">{t("linkExpiredText")}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={signIn} className="site-btn-primary site-focus h-12 rounded-2xl px-6">
              {t("signIn")}
            </Link>
            <Link href={`/${locale}/pricing`} className="site-btn-outline site-focus h-12 rounded-2xl px-6">
              {t("signUpAgain")}
            </Link>
          </div>
        </Panel>
      );
    }
    return (
      <Panel>
        {code ? (
          <FinishSignup locale={locale} code={code} mode="exchange" />
        ) : (
          <>
            <SiteIcon name="mail" size={40} className="text-emerald-600" />
            <h1 className="text-2xl font-extrabold text-[#0c1a33]">{t("confirmTitle")}</h1>
            <p className="text-[15px] text-[#33415c]">{t("confirmText")}</p>
            <Link href={signIn} className="site-btn-primary site-focus h-12 rounded-2xl px-6">
              {t("signIn")}
            </Link>
          </>
        )}
      </Panel>
    );
  }

  const memberships = await myTenantMemberships();
  const owned = memberships.find((m) => m.role_key === "business_owner") ?? memberships[0];
  if (!owned) {
    const pending = !!user.user_metadata?.pending_signup;
    return (
      <Panel>
        {pending ? (
          <FinishSignup locale={locale} code={null} mode="complete" />
        ) : (
          <>
            <h1 className="text-2xl font-extrabold text-[#0c1a33]">{t("noBusinessTitle")}</h1>
            <p className="text-[15px] text-[#33415c]">{t("noBusinessText")}</p>
            <Link href={`/${locale}/pricing`} className="site-btn-primary site-focus h-12 rounded-2xl px-6">
              {t("choosePlan")}
            </Link>
          </>
        )}
      </Panel>
    );
  }

  const supabase = await createUserClient();
  const { data: sub } = await supabase.from("subscriptions").select("plan_key, status, trial_ends_at").eq("tenant_id", owned.tenant_id).maybeSingle();
  const { data: plan } = sub
    ? await supabase.from("subscription_plans").select("name, billing_interval").eq("key", sub.plan_key).maybeSingle()
    : { data: null };
  const planName = plan ? pickText(plan.name as Record<string, string>, locale) || sub?.plan_key : null;
  const trialEnds =
    sub?.status === "trialing" && sub.trial_ends_at
      ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(sub.trial_ends_at))
      : null;

  return (
    <Panel>
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
        <SiteIcon name="check" size={40} strokeWidth={2.6} />
      </span>
      <h1 className="text-3xl font-extrabold tracking-tight text-[#0c1a33]" data-testid="welcome-title">
        {t("title")}
      </h1>
      <p className="text-[15px] text-[#33415c]">{t("created")}</p>
      <dl className="grid w-full gap-3 rounded-2xl bg-slate-50 p-5 text-start text-sm sm:grid-cols-2" data-testid="welcome-summary">
        <div>
          <dt className="text-slate-500">{t("business")}</dt>
          <dd className="font-bold text-[#0c1a33]">{pickText(owned.business_name as Record<string, string>, locale) || owned.slug}</dd>
        </div>
        {planName && (
          <div>
            <dt className="text-slate-500">{t("plan")}</dt>
            <dd className="font-bold text-[#0c1a33]" data-testid="welcome-plan">
              {planName} — {plan?.billing_interval === "year" ? t("annual") : t("monthly")}
            </dd>
          </div>
        )}
      </dl>
      {trialEnds && (
        <p className="rounded-2xl bg-[#0c1a33] px-5 py-3 text-sm font-bold text-white" data-testid="welcome-trial">
          {t("trialReady", { date: trialEnds })}
        </p>
      )}
      <Link href={`/${locale}/${owned.slug}`} className="site-btn-primary site-focus h-14 rounded-2xl px-8 text-base" data-testid="welcome-dashboard">
        {t("dashboard")}
        <SiteIcon name="arrowRight" size={18} className="rtl:rotate-180" />
      </Link>
    </Panel>
  );
}
