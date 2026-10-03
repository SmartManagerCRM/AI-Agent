import { Button } from "@/components/console/button";
import { daysUntil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { subscribeAction } from "@/server/billing/actions";
import { usageNotices, type SubscriberUsage } from "@/server/billing/usage";
import { loadSubscriberUsage } from "@/server/billing/usage-summary";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { statusLabel } from "@/lib/i18n-labels";

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
  const t = await getTranslations("console.billing");
  const tAll = await getTranslations();

  const [{ data: subscription }, { data: plans }, { data: planCurrencies }] = await Promise.all([
    supabase.from("subscriptions").select("plan_key, status, trial_ends_at, current_period_end").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("subscription_plans").select("key, name, price_minor, currency, billing_interval").eq("is_active", true).order("sort_order"),
    supabase.from("currencies").select("code, exponent"),
  ]);
  const exponentByCode = new Map((planCurrencies ?? []).map((c) => [c.code, c.exponent]));
  const trialDaysRemaining = subscription?.status === "trialing" ? daysUntil(subscription.trial_ends_at) : null;
  const usage =
    subscription?.status === "active" || subscription?.status === "trialing"
      ? await loadSubscriberUsage(supabase, tenant.id)
      : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("current")}</h2>
        {subscription ? (
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[subscription.status] ?? "bg-slate-100 text-slate-500"}`}
            >
              {statusLabel(tAll, subscription.status)}
            </span>
            <span className="text-sm font-medium text-slate-900">{tAll.has(`common.plan.${subscription.plan_key}`) ? tAll(`common.plan.${subscription.plan_key}`) : subscription.plan_key}</span>
            {trialDaysRemaining !== null && (
              <span className="text-sm text-slate-500">
                {t("trialLeft", { count: trialDaysRemaining })}
              </span>
            )}
            {subscription.current_period_end && (
              <span className="text-sm text-slate-500">
                {t(subscription.status === "active" ? "renews" : "expires", { date: new Date(subscription.current_period_end).toLocaleDateString(locale) })}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t("noPlan")}</p>
        )}
      </section>

      {(usage?.isPaid || usage?.isTrial) && <UsageSection usage={usage} locale={locale} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{t("plans")}</h2>
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
                  <span className="text-sm font-normal text-slate-500"> / {t.has(`interval.${plan.billing_interval}`) ? t(`interval.${plan.billing_interval}`) : plan.billing_interval}</span>
                </p>
                {isCurrent ? (
                  <span className="w-fit rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">{t("currentPlan")}</span>
                ) : (
                  <form action={subscribeAction}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <input type="hidden" name="planKey" value={plan.key} />
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="slug" value={slug} />
                    <Button type="submit" className="w-fit">
                      {t("subscribe")}
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

const STATE_STYLE: Record<SubscriberUsage["conversationState"], string> = {
  ok: "bg-emerald-50 text-emerald-700",
  grace: "bg-amber-50 text-amber-700",
  blocked: "bg-red-50 text-red-700",
};

const NOTICE_STYLE = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
} as const;

/** This billing period's (or the free trial's) customer conversations — never AI cost figures (the summary doesn't carry them). */
function UsageSection({ usage, locale }: { usage: SubscriberUsage; locale: string }) {
  const t = useTranslations("console.billing");
  const tUsage = useTranslations("console.usage");
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString(locale, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const limit = usage.conversationLimit;
  const remaining = limit !== null ? Math.max(0, limit - usage.conversationsUsed) : null;
  const percent = limit ? Math.min(100, (usage.conversationsUsed / limit) * 100) : 0;
  const trial = usage.isTrial;
  const state = trial
    ? usage.trialEnded
      ? { label: t("trialEnded"), style: "bg-red-50 text-red-700" }
      : { label: t("freeTrial"), style: "bg-blue-50 text-blue-700" }
    : usage.aiLimited
      ? { label: t("aiLimited"), style: "bg-red-50 text-red-700" }
      : { label: t(`state.${usage.conversationState}`), style: STATE_STYLE[usage.conversationState] };
  const barColor =
    usage.trialEnded || usage.conversationState !== "ok" || usage.warningLevel >= 95
      ? "bg-red-500"
      : usage.warningLevel > 0
        ? "bg-amber-400"
        : "bg-emerald-500";
  // The period ends at `periodEnd`; the last day included is the day before it.
  const lastDay = usage.periodEnd ? new Date(new Date(usage.periodEnd).getTime() - 1).toISOString() : null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{trial ? t("trialUsage") : t("periodUsage")}</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${state.style}`}>{state.label}</span>
      </div>

      {limit !== null ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-slate-700">
              <span className="text-2xl font-bold text-slate-900">
                {usage.conversationsUsed.toLocaleString(locale)}
              </span>
              {" / "}
              {t("ofConversations", { limit: limit.toLocaleString(locale) })}
            </p>
            <p className="text-sm text-slate-500">{t("remaining", { n: (remaining ?? 0).toLocaleString(locale) })}</p>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(1, percent)}%` }} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-700">
          {t("noLimit", { n: usage.conversationsUsed.toLocaleString(locale) })}
        </p>
      )}

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {usage.periodStart && lastDay && (
          <div>
            <dt className="text-slate-500">{trial ? t("trialPeriod") : t("billingPeriod")}</dt>
            <dd className="text-slate-900">
              {formatDate(usage.periodStart)} – {formatDate(lastDay)}
            </dd>
          </div>
        )}
        {usage.periodEnd && !trial && (
          <div>
            <dt className="text-slate-500">{t("resetsOn")}</dt>
            <dd className="text-slate-900">{formatDate(usage.periodEnd)}</dd>
          </div>
        )}
        {usage.conversationState === "grace" && usage.graceUntil && (
          <div>
            <dt className="text-slate-500">{t("graceEnds")}</dt>
            <dd className="text-slate-900">{formatDateTime(usage.graceUntil)}</dd>
          </div>
        )}
      </dl>

      {usageNotices(usage, formatDate, (key, values) => tUsage(key, values), (n) => n.toLocaleString(locale)).map((notice) => (
        <div key={notice.title} className={`rounded-lg border p-3 text-sm ${NOTICE_STYLE[notice.tone]}`}>
          <p className="font-medium">{notice.title}</p>
          <p className="mt-1">{notice.body}</p>
        </div>
      ))}
      <p className="text-xs text-slate-500">
        {trial
          ? t("trialFootnote", {
              date: usage.trialEndsAt ? formatDate(usage.trialEndsAt) : t("trialEndDate"),
              limit: limit !== null ? t("orAfter", { limit: limit.toLocaleString(locale) }) : "",
            })
          : t("paidFootnote")}
      </p>
    </section>
  );
}
