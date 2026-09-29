import Link from "next/link";
import { KpiTile } from "@/components/console/kpi-tile";
import { PlanForm } from "@/components/platform/plan-form";
import { formatMoney } from "@/lib/money";
import { setDefaultPlanAction, setPlanActiveAction } from "@/server/platform/plan-actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/**
 * Super Admin Master Spec, Phase 3 — Subscriptions & Plans management.
 * Real fields only: name/price/currency/billing interval/trial length/
 * active/default/sort order. Deliberately no `limits`/feature-matrix
 * editor — see plan-actions.ts's doc comment for why.
 */
export default async function PlansPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { locale } = await params;
  const { edit } = await searchParams;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const [{ data: plans }, { data: currencies }, { data: subscriptions }] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select("key, name, price_minor, currency, billing_interval, trial_days, is_default, is_active, sort_order")
      .order("sort_order"),
    supabase.from("currencies").select("code, name").order("code"),
    supabase.from("subscriptions").select("plan_key, status"),
  ]);

  const { data: exponentRows } = await supabase.from("currencies").select("code, exponent");
  const currencyExponents = new Map((exponentRows ?? []).map((r) => [r.code, r.exponent]));

  const subscriberCountByPlan = new Map<string, number>();
  const activeSubscriberCountByPlan = new Map<string, number>();
  for (const s of subscriptions ?? []) {
    subscriberCountByPlan.set(s.plan_key, (subscriberCountByPlan.get(s.plan_key) ?? 0) + 1);
    if (s.status === "active" || s.status === "trialing") {
      activeSubscriberCountByPlan.set(s.plan_key, (activeSubscriberCountByPlan.get(s.plan_key) ?? 0) + 1);
    }
  }

  const all = plans ?? [];
  const defaultPlan = all.find((p) => p.is_default);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Subscriptions &amp; Plans</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="billing" accent="emerald" label="Total plans" value={String(all.length)} trend={null} />
        <KpiTile
          icon="check"
          accent="blue"
          label="Active plans"
          value={String(all.filter((p) => p.is_active).length)}
          trend={null}
        />
        <KpiTile
          icon="crown"
          accent="orange"
          label="Default plan"
          value={defaultPlan ? (defaultPlan.name.en ?? defaultPlan.key) : "—"}
          trend={null}
        />
        <KpiTile
          icon="customers"
          accent="purple"
          label="Subscribed businesses"
          value={String((subscriptions ?? []).length)}
          trend={null}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Add a plan</h2>
        <PlanForm locale={locale} currencies={currencies ?? []} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Plans</h2>
        <div className="flex flex-col gap-3">
          {all.map((p) => {
            const exponent = currencyExponents.get(p.currency) ?? 2;
            if (edit === p.key) {
              return (
                <div key={p.key} className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
                  <PlanForm
                    locale={locale}
                    currencies={currencies ?? []}
                    plan={{
                      key: p.key,
                      name: p.name[locale] ?? p.name.en ?? p.key,
                      priceMajor: p.price_minor / 10 ** exponent,
                      currency: p.currency,
                      billingInterval: p.billing_interval as "month" | "year",
                      trialDays: p.trial_days,
                      sortOrder: p.sort_order,
                    }}
                  />
                  <Link
                    href={`/${locale}/super-admin/plans`}
                    prefetch={false}
                    className="mt-2 inline-block text-xs text-slate-500 hover:underline"
                  >
                    Cancel
                  </Link>
                </div>
              );
            }

            return (
              <div
                key={p.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-100 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {p.name[locale] ?? p.name.en ?? p.key}{" "}
                    <span className="font-mono text-xs text-slate-400">({p.key})</span>
                  </p>
                  <p className="text-slate-500">
                    {formatMoney(p.price_minor, p.currency, exponent, locale)} / {p.billing_interval} · {p.trial_days}
                    -day trial · {activeSubscriberCountByPlan.get(p.key) ?? 0} active,{" "}
                    {subscriberCountByPlan.get(p.key) ?? 0} total subscribers
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/${locale}/super-admin/plans?edit=${p.key}`}
                    prefetch={false}
                    className="text-xs font-medium text-emerald-600 hover:underline"
                  >
                    Edit
                  </Link>
                  <form action={setPlanActiveAction}>
                    <input type="hidden" name="key" value={p.key} />
                    <input type="hidden" name="value" value={(!p.is_active).toString()} />
                    <input type="hidden" name="locale" value={locale} />
                    <button type="submit" className="text-xs font-medium text-emerald-600 hover:underline">
                      {p.is_active ? "Active" : "Inactive"}
                    </button>
                  </form>
                  <form action={setDefaultPlanAction}>
                    <input type="hidden" name="key" value={p.key} />
                    <input type="hidden" name="locale" value={locale} />
                    <button
                      type="submit"
                      disabled={p.is_default}
                      className="text-xs font-medium text-emerald-600 hover:underline disabled:text-slate-400 disabled:no-underline"
                    >
                      {p.is_default ? "Default" : "Make default"}
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
          {all.length === 0 && <p className="py-4 text-center text-slate-400">No plans yet.</p>}
        </div>
      </section>
    </div>
  );
}
