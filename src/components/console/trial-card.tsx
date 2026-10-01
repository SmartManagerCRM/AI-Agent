import Link from "next/link";

type Props = {
  locale: string;
  slug: string;
  subscription: { status: string; planKey: string } | null;
  /** Computed by the caller (a server component) — never Date.now() here, that's impure in render. */
  daysRemaining: number | null;
  conversationCount: number;
  /** Paid plans only: this billing period's customer conversations against the plan's limit. */
  usage?: { used: number; limit: number; warningLevel: number; limited: boolean; inGrace: boolean } | null;
};

/**
 * Real data only. A paid plan shows this period's conversations against its
 * real limit (`tenant_usage_summary`); the trial has no conversation cap, so
 * it shows the plain count — never a fabricated "X / 500". When there's no subscription
 * row at all (this tenant's actual current state), this is an honest
 * empty state, not a fabricated trial.
 */
export function TrialCard({ locale, slug, subscription, daysRemaining, conversationCount, usage }: Props) {
  if (!subscription) {
    return (
      <div className="rounded-xl bg-slate-800 p-4 text-sm">
        <p className="font-medium text-white">No active plan</p>
        <p className="mt-1 text-slate-400">Start a subscription to unlock billing and usage tracking.</p>
        <Link
          href={`/${locale}/${slug}/billing`}
          prefetch={false}
          className="mt-3 block rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-500"
        >
          View plans
        </Link>
      </div>
    );
  }

  const isTrialing = subscription.status === "trialing" && daysRemaining !== null;

  return (
    <div className="rounded-xl bg-slate-800 p-4 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium capitalize text-white">{subscription.planKey}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
            subscription.status === "active" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
          }`}
        >
          {subscription.status.replace("_", " ")}
        </span>
      </div>
      {isTrialing && <p className="mt-2 text-slate-300">{daysRemaining} days remaining</p>}
      {usage ? (
        <>
          <p
            className={`mt-1 ${usage.limited || usage.warningLevel >= 95 ? "text-red-300" : usage.warningLevel > 0 ? "text-amber-300" : "text-slate-400"}`}
          >
            {usage.used.toLocaleString(locale)} / {usage.limit.toLocaleString(locale)} conversations this period
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full ${usage.limited || usage.warningLevel >= 95 ? "bg-red-500" : usage.warningLevel > 0 ? "bg-amber-400" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, Math.max(2, (usage.used / usage.limit) * 100))}%` }}
            />
          </div>
          {usage.limited ? (
            <p className="mt-2 text-xs text-red-300">AI service is limited — see Billing.</p>
          ) : (
            usage.inGrace && <p className="mt-2 text-xs text-amber-300">Conversation limit reached — grace period.</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-slate-400">{conversationCount} conversations so far</p>
      )}
      {isTrialing && (
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
        {subscription.status === "trialing" ? "Upgrade now" : "Manage billing"}
      </Link>
    </div>
  );
}
