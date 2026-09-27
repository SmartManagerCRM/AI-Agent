import { subscribeAction } from "@/server/billing/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

function formatMoney(minor: number, exponent: number, currency: string): string {
  return `${(minor / 10 ** exponent).toFixed(exponent)} ${currency}`;
}

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

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Billing</h1>

      <section className="rounded-md border border-neutral-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Current subscription</h2>
        {subscription ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-neutral-500">Plan</dt>
            <dd className="capitalize">{subscription.plan_key}</dd>
            <dt className="text-neutral-500">Status</dt>
            <dd className="capitalize">{subscription.status.replace("_", " ")}</dd>
            {subscription.status === "trialing" && (
              <>
                <dt className="text-neutral-500">Trial ends</dt>
                <dd>{new Date(subscription.trial_ends_at).toLocaleDateString(locale)}</dd>
              </>
            )}
            {subscription.current_period_end && (
              <>
                <dt className="text-neutral-500">Renews / expires</dt>
                <dd>{new Date(subscription.current_period_end).toLocaleDateString(locale)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-sm text-neutral-500">No subscription found.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-700">Plans</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(plans ?? []).map((plan) => {
            const exponent = exponentByCode.get(plan.currency) ?? 2;
            const isCurrent = subscription?.plan_key === plan.key && subscription.status === "active";
            return (
              <div key={plan.key} className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
                <p className="font-semibold">{plan.name[locale] ?? plan.name.en ?? plan.key}</p>
                <p className="text-2xl font-bold">
                  {formatMoney(plan.price_minor, exponent, plan.currency)}
                  <span className="text-sm font-normal text-neutral-500"> / {plan.billing_interval}</span>
                </p>
                {isCurrent ? (
                  <p className="text-sm text-green-700">Current plan</p>
                ) : (
                  <form action={subscribeAction}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <input type="hidden" name="planKey" value={plan.key} />
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="slug" value={slug} />
                    <button type="submit" className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white">
                      Subscribe
                    </button>
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
