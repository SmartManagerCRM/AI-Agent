import Link from "next/link";
import { useTranslations } from "next-intl";

type Props = {
  locale: string;
  slug: string;
  subscription: { status: string; planKey: string } | null;
  /** Computed by the caller (a server component) — never Date.now() here, that's impure in render. */
  daysRemaining: number | null;
  conversationCount: number;
  /** This billing period's (or the trial's) customer conversations against its limit. */
  usage?: {
    used: number;
    limit: number;
    warningLevel: number;
    limited: boolean;
    inGrace: boolean;
    trialEnded?: boolean;
  } | null;
};

/**
 * Real data only: conversations against the real limit from
 * `tenant_usage_summary` (this paid period's, or the free trial's), else
 * the plain count — never a fabricated limit. When there's no subscription
 * row at all (this tenant's actual current state), this is an honest
 * empty state, not a fabricated trial.
 */
export function TrialCard({ locale, slug, subscription, daysRemaining, conversationCount, usage }: Props) {
  const t = useTranslations("console.trial");
  const tc = useTranslations("common");
  if (!subscription) {
    return (
      <div className="rounded-xl bg-slate-800 p-4 text-sm">
        <p className="font-medium text-white">{t("noPlan")}</p>
        <p className="mt-1 text-slate-400">{t("noPlanText")}</p>
        <Link
          href={`/${locale}/${slug}/billing`}
          prefetch={false}
          className="mt-3 block rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-500"
        >
          {t("viewPlans")}
        </Link>
      </div>
    );
  }

  const isTrialing = subscription.status === "trialing" && daysRemaining !== null;

  return (
    <div className="rounded-xl bg-slate-800 p-4 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium capitalize text-white">{tc.has(`plan.${subscription.planKey}`) ? tc(`plan.${subscription.planKey}`) : subscription.planKey}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
            subscription.status === "active" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
          }`}
        >
          {tc.has(`subscriptionStatus.${subscription.status}`) ? tc(`subscriptionStatus.${subscription.status}`) : subscription.status.replace("_", " ")}
        </span>
      </div>
      {isTrialing && !usage?.trialEnded && <p className="mt-2 text-slate-300">{t("daysRemaining", { count: daysRemaining ?? 0 })}</p>}
      {usage ? (
        <>
          <p
            className={`mt-1 ${usage.limited || usage.warningLevel >= 95 ? "text-red-300" : usage.warningLevel > 0 ? "text-amber-300" : "text-slate-400"}`}
          >
            {t(subscription.status === "trialing" ? "conversationsInTrial" : "conversationsThisPeriod", {
              used: usage.used.toLocaleString(locale),
              limit: usage.limit.toLocaleString(locale),
            })}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full ${usage.limited || usage.warningLevel >= 95 ? "bg-red-500" : usage.warningLevel > 0 ? "bg-amber-400" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, Math.max(2, (usage.used / usage.limit) * 100))}%` }}
            />
          </div>
          {usage.trialEnded ? (
            <p className="mt-2 text-xs text-red-300">{t("trialEnded")}</p>
          ) : usage.limited ? (
            <p className="mt-2 text-xs text-red-300">{t("aiLimited")}</p>
          ) : (
            usage.inGrace && <p className="mt-2 text-xs text-amber-300">{t("grace")}</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-slate-400">{t("soFar", { count: conversationCount })}</p>
      )}
      {isTrialing && !usage && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${Math.max(4, 100 - ((daysRemaining ?? 0) / 14) * 100)}%` }}
          />
        </div>
      )}
      <Link
        href={`/${locale}/${slug}/billing`}
        prefetch={false}
        className="mt-3 block rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-500"
      >
        {subscription.status === "trialing" ? t("upgrade") : t("manage")}
      </Link>
    </div>
  );
}
