import { Button } from "@/components/console/button";
import { daysUntil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { subscribeAction } from "@/server/billing/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  trialing: "bg-blue-50 text-blue-700",
  past_due: "bg-red-50 text-red-700",
  canceled: "bg-slate-100 text-slate-500",
};

/**
 * Billing (spec §98 Phase 7). Any tenant member with `billing.read`
 * (owner/admin) can see this; only `billing.write` (owner-only, enforced
 * by `create_subscription_payment_attempt` itself, not re-checked here)
 * can actually start a payment — the same "RLS scopes the read, the
 * SECURITY DEFINER function scopes the write" split every other console
 * page in this app already uses.
 */
export default async function BillingPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: subscription }, { data: plans }, { data: planCurrencies }] = await Promise.all([
    supabase.from("subscriptions").select("plan_key, status, trial_ends_at, current_period_end").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("subscription_plans").select("key, name, price_minor, currency, billing_interval").eq("is_active", true).order("sort_order"),
    supabase.from("currencies").select("code, exponent"),
  ]);
  const exponentByCode = new Map((planCurrencies ?? []).map((c) => [c.code, c.exponent]));
  const trialDaysRemaining = subscription?.status === "trialing" ? daysUntil(subscription.trial_ends_at) : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Billing</h1>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Current subscription</h2>
        {subscription ? (
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLE[subscription.status] ?? "bg-slate-100 text-slate-500"}`}
            >
              {subscription.status.replace("_", " ")}
            </span>
            <span className="text-sm font-medium capitalize text-slate-900">{subscription.plan_key}</span>
            {trialDaysRemaining !== null && (
              <span className="text-sm text-slate-500">
                {trialDaysRemaining} day{trialDaysRemaining === 1 ? "" : "s"} left in trial
              </span>
            )}
            {subscription.current_period_end && (
              <span className="text-sm text-slate-500">
                {subscription.status === "active" ? "Renews" : "Expires"} {new Date(subscription.current_period_end).toLocaleDateString(locale)}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No active plan yet — pick one below to get started.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Plans</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(plans ?? []).map((plan) => {
            const exponent = exponentByCode.get(plan.currency) ?? 2;
            const isCurrent = subscription?.plan_key === plan.key && subscription.status === "active";
            return (
              <div
                key={plan.key}
                className={`flex flex-col gap-2 rounded-xl border p-4 ${isCurrent ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white"}`}
              >
                <p className="font-semibold text-slate-900">{plan.name[locale] ?? plan.name.en ?? plan.key}</p>
                <p className="text-2xl font-bold text-slate-900">
                  {formatMoney(plan.price_minor, plan.currency, exponent, locale)}
                  <span className="text-sm font-normal text-slate-500"> / {plan.billing_interval}</span>
                </p>
                {isCurrent ? (
                  <span className="w-fit rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Current plan</span>
                ) : (
                  <form action={subscribeAction}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <input type="hidden" name="planKey" value={plan.key} />
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="slug" value={slug} />
                    <Button type="submit" className="w-fit">
                      Subscribe
                    </Button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
