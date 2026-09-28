type Props = {
  locale: string;
  slug: string;
  subscription: { status: string; planKey: string } | null;
  /** Computed by the caller (a server component) — never Date.now() here, that's impure in render. */
  daysRemaining: number | null;
  conversationCount: number;
};

/**
 * Real data only — `subscription_plans.limits` is empty for every plan
 * today, so there is no real conversation cap to show; showing a fake
 * "X / 500" would misrepresent the account. When there's no subscription
 * row at all (this tenant's actual current state), this is an honest
 * empty state, not a fabricated trial.
 */
export function TrialCard({ locale, slug, subscription, daysRemaining, conversationCount }: Props) {
  if (!subscription) {
    return (
      <div className="rounded-xl bg-slate-800 p-4 text-sm">
        <p className="font-medium text-white">No active plan</p>
        <p className="mt-1 text-slate-400">Start a subscription to unlock billing and usage tracking.</p>
        <a
          href={`/${locale}/t/${slug}/billing`}
          className="mt-3 block rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-500"
        >
          View plans
        </a>
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
      <p className="mt-1 text-slate-400">{conversationCount} conversations so far</p>
      {isTrialing && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${Math.max(4, 100 - ((daysRemaining ?? 0) / 14) * 100)}%` }}
          />
        </div>
      )}
      <a
        href={`/${locale}/t/${slug}/billing`}
        className="mt-3 block rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-500"
      >
        {subscription.status === "trialing" ? "Upgrade now" : "Manage billing"}
      </a>
    </div>
  );
}
