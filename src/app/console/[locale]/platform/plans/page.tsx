import Link from "next/link";
import { KpiTile } from "@/components/console/kpi-tile";
import { PlanForm } from "@/components/platform/plan-form";
import { PlanUsageLimitsForm } from "@/components/platform/usage-limits-forms";
import { formatMoney } from "@/lib/money";
import { displayMoney } from "@/server/platform/display-currency";
import { setDefaultPlanAction, setPlanActiveAction } from "@/server/platform/plan-actions";
import { loadPlanAiCostLimits } from "@/server/platform/usage";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";

/**
 * Super Admin Master Spec, Phase 3 — Subscriptions & Plans management.
 * Real fields only: name/price/currency/billing interval/trial length/
 * active/default/sort order, plus the paid-plan usage limits (conversation
 * limit, AI cost cap, grace period) the AI usage guard enforces. Deliberately
 * no `limits`/feature-matrix editor — see plan-actions.ts's doc comment for why.
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
  const dm = await displayMoney(supabase, locale);
  const t = await getTranslations("platform.plans");
  const nf = new Intl.NumberFormat(locale);

  const [{ data: plans }, { data: currencies }, { data: subscriptions }, aiCostLimits] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select(
        "key, name, price_minor, currency, billing_interval, trial_days, is_default, is_active, sort_order, conversation_limit, grace_period_hours, description, features, plan_family, is_popular, is_public, max_branches, ai_response_limit",
      )
      .order("sort_order"),
    supabase.from("currencies").select("code, name").order("code"),
    supabase.from("subscriptions").select("plan_key, status"),
    loadPlanAiCostLimits(supabase),
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
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="billing" accent="emerald" label={t("total")} value={String(all.length)} trend={null} href={`/${locale}/super-admin/plans#plans`} />
        <KpiTile
          icon="check"
          accent="blue"
          label={t("active")}
          value={String(all.filter((p) => p.is_active).length)}
          trend={null}
          href={`/${locale}/super-admin/plans#plans`}
        />
        <KpiTile
          icon="crown"
          accent="orange"
          label={t("default")}
          value={defaultPlan ? (defaultPlan.name[locale] ?? defaultPlan.name.en ?? defaultPlan.key) : "—"}
          trend={null}
          href={`/${locale}/super-admin/plans#plans`}
        />
        <KpiTile
          icon="customers"
          accent="purple"
          label={t("subscribed")}
          value={String((subscriptions ?? []).length)}
          trend={null}
          href={`/${locale}/super-admin/subscribers`}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("add")}</h2>
        <PlanForm locale={locale} currencies={currencies ?? []} />
      </section>

      <section id="plans" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("plans")}</h2>
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
                      description: (p.description as Record<string, string> | null)?.[locale] ?? "",
                      features: (p.features as Record<string, string> | null)?.[locale] ?? "",
                      family: p.plan_family ?? "",
                      isPopular: p.is_popular,
                      isPublic: p.is_public,
                      maxBranches: p.max_branches,
                      aiResponseLimit: p.ai_response_limit,
                    }}
                  />
                  <Link
                    href={`/${locale}/super-admin/plans`}
                    prefetch={false}
                    className="mt-2 inline-block text-xs text-slate-500 hover:underline"
                  >
                    {t("cancel")}
                  </Link>
                </div>
              );
            }

            return (
              <div key={p.key} className="flex flex-col gap-3 rounded-md border border-slate-100 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {p.name[locale] ?? p.name.en ?? p.key}{" "}
                      <span className="font-mono text-xs text-slate-400">({p.key})</span>
                      {p.is_popular && (
                        <span className="ms-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{t("badgePopular")}</span>
                      )}
                      {!p.is_public && (
                        <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{t("badgeHidden")}</span>
                      )}
                      {p.plan_family && p.plan_family !== p.key && (
                        <span className="ms-2 text-xs text-slate-400">{t("badgeFamily", { family: p.plan_family })}</span>
                      )}
                    </p>
                    <p className="text-slate-500">
                      {t("summary", {
                        // The plan's own price; with a display currency chosen, also roughly in it.
                        price:
                          dm.code && dm.code !== p.currency
                            ? `${formatMoney(p.price_minor, p.currency, exponent, locale)} ≈ ${dm.money(p.price_minor, p.currency, exponent)}`
                            : formatMoney(p.price_minor, p.currency, exponent, locale),
                        interval: t.has(`interval.${p.billing_interval}`) ? t(`interval.${p.billing_interval}`) : p.billing_interval,
                        days: p.trial_days,
                        active: activeSubscriberCountByPlan.get(p.key) ?? 0,
                        total: subscriberCountByPlan.get(p.key) ?? 0,
                      })}
                    </p>
                    <p className="text-xs text-slate-500" data-testid={`plan-limits-${p.key}`}>
                      {t("planLimits", {
                        branches: p.max_branches !== null ? nf.format(p.max_branches) : t("unlimited"),
                        responses: p.ai_response_limit !== null ? nf.format(p.ai_response_limit) : t("unlimited"),
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/${locale}/super-admin/plans?edit=${p.key}`}
                      prefetch={false}
                      className="text-xs font-medium text-emerald-600 hover:underline"
                    >
                      {t("edit")}
                    </Link>
                    <form action={setPlanActiveAction}>
                      <input type="hidden" name="key" value={p.key} />
                      <input type="hidden" name="value" value={(!p.is_active).toString()} />
                      <input type="hidden" name="locale" value={locale} />
                      <button type="submit" className="text-xs font-medium text-emerald-600 hover:underline">
                        {p.is_active ? t("isActive") : t("isInactive")}
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
                        {p.is_default ? t("isDefault") : t("makeDefault")}
                      </button>
                    </form>
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    {t("limits")}
                  </p>
                  <PlanUsageLimitsForm
                    locale={locale}
                    planKey={p.key}
                    conversationLimit={p.conversation_limit}
                    aiCostLimitUsd={aiCostLimits.get(p.key) ?? null}
                    gracePeriodHours={p.grace_period_hours}
                  />
                </div>
              </div>
            );
          })}
          {all.length === 0 && <p className="py-4 text-center text-slate-400">{t("none")}</p>}
        </div>
      </section>
    </div>
  );
}
