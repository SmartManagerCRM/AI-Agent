import Link from "next/link";

import { ConfirmForm } from "@/components/billing/confirm-submit";
import { Button } from "@/components/console/button";
import { planChangeDirection, type PlanForChange } from "@/lib/billing/plan-change";
import { daysUntil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  cancelSubscriptionAction,
  keepCurrentPlanAction,
  manageBillingAction,
  resumeSubscriptionAction,
  subscribeAction,
} from "@/server/billing/actions";
import { paddleConfig } from "@/server/billing/paddle/client";
import { paddleSubscriptionKnown } from "@/server/billing/paddle/subscriptions";
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
const PADDLE_NOTICES = [
  "upgraded",
  "downgradeScheduled",
  "downgradeCanceled",
  "canceled",
  "resumed",
  "notConfigured",
  "noPermission",
  "plan",
  "currency",
  "noSubscription",
  "failed",
  "paymentDeclined",
  "changePending",
  "wrongDirection",
] as const;
const GOOD_NOTICES: readonly string[] = ["upgraded", "downgradeScheduled", "downgradeCanceled", "canceled", "resumed"];

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ paddle?: string }>;
}) {
  const { locale, slug } = await params;
  const { paddle: paddleNotice } = await searchParams;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.billing");
  const tPaddle = await getTranslations("console.paddle");
  const tAll = await getTranslations();
  const paddleOn = !!paddleConfig();

  const [{ data: subscription }, { data: plans }, { data: planCurrencies }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("plan_key, status, trial_ends_at, current_period_end, paddle_subscription_id, cancel_at, scheduled_plan_key, scheduled_change_at")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase.from("subscription_plans").select("key, name, price_minor, currency, billing_interval, plan_family, is_active").order("sort_order"),
    supabase.from("currencies").select("code, exponent"),
  ]);
  const exponentByCode = new Map((planCurrencies ?? []).map((c) => [c.code, c.exponent]));
  const trialDaysRemaining = subscription?.status === "trialing" ? daysUntil(subscription.trial_ends_at) : null;
  const usage =
    subscription?.status === "active" || subscription?.status === "trialing"
      ? await loadSubscriberUsage(supabase, tenant.id)
      : null;
  // A plan renewing through Paddle: switching plans changes it (pro rata) rather than starting a new checkout.
  // (Only if this Paddle account knows it — a sandbox subscription doesn't exist once Paddle is live.)
  const renewing =
    paddleOn &&
    !!subscription?.paddle_subscription_id &&
    (subscription.status === "active" || subscription.status === "past_due") &&
    (await paddleSubscriptionKnown(subscription.paddle_subscription_id));
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const notice = PADDLE_NOTICES.find((n) => n === paddleNotice);
  const manageFields = { locale, slug };
  const allPlans = plans ?? [];
  const activePlans = allPlans.filter((p) => p.is_active);
  const planName = (key: string | null | undefined) => {
    const plan = allPlans.find((p) => p.key === key);
    return plan ? (plan.name[locale] ?? plan.name.en ?? plan.key) : (key ?? "");
  };
  // Upgrades apply now (charged pro rata), downgrades at the next billing cycle; one change at a time.
  const scheduledPlan = subscription?.scheduled_plan_key ?? null;
  const changeBlocked = renewing && (!!scheduledPlan || !!subscription?.cancel_at);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>

      {notice && (
        <p
          role="status"
          data-testid="billing-notice"
          className={`rounded-lg border px-3 py-2 text-sm ${GOOD_NOTICES.includes(notice) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
        >
          {tPaddle(`notice.${notice}`)}
        </p>
      )}

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
            {subscription.current_period_end && !subscription.cancel_at && (
              <span className="text-sm text-slate-500">
                {renewing
                  ? tPaddle("renewsAutomatically", { date: fmtDate(subscription.current_period_end) })
                  : t(subscription.status === "active" ? "renews" : "expires", { date: new Date(subscription.current_period_end).toLocaleDateString(locale) })}
              </span>
            )}
            {subscription.cancel_at && subscription.status !== "canceled" && (
              <span className="text-sm font-medium text-amber-700" data-testid="cancels-on">
                {tPaddle("cancelsOn", { date: fmtDate(subscription.cancel_at) })}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t("noPlan")}</p>
        )}
        {scheduledPlan && subscription?.scheduled_change_at && subscription.status !== "canceled" && (
          <div
            className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
            data-testid="scheduled-change"
          >
            <span>
              {tPaddle("scheduled", {
                plan: planName(scheduledPlan),
                date: fmtDate(subscription.scheduled_change_at),
                current: planName(subscription.plan_key),
              })}
            </span>
            <form action={keepCurrentPlanAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit" variant="secondary" data-testid="keep-plan">
                {tPaddle("keepPlan")}
              </Button>
            </form>
          </div>
        )}
        {renewing && subscription?.status === "past_due" && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{tPaddle("pastDue")}</p>
        )}
        {renewing && (
          <div className="mt-4 flex flex-wrap gap-2" data-testid="paddle-manage">
            <form action={manageBillingAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit" variant="secondary">
                {tPaddle("manage")}
              </Button>
            </form>
            {subscription?.cancel_at ? (
              <form action={resumeSubscriptionAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="slug" value={slug} />
                <Button type="submit">{tPaddle("resume")}</Button>
              </form>
            ) : (
              <ConfirmForm
                action={cancelSubscriptionAction}
                hidden={manageFields}
                confirm={tPaddle("cancelConfirm", { date: subscription?.current_period_end ? fmtDate(subscription.current_period_end) : "" })}
                testId="cancel-subscription"
              >
                <Button type="submit" variant="secondary">
                  {tPaddle("cancel")}
                </Button>
              </ConfirmForm>
            )}
          </div>
        )}
      </section>

      {(usage?.isPaid || usage?.isTrial) && <UsageSection usage={usage} locale={locale} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{t("plans")}</h2>
        {renewing && (
          <p className="text-xs leading-relaxed text-slate-500" data-testid="plan-change-rules">
            {tPaddle("rules")}{" "}
            <a href={`/${locale}/refund-policy`} className="font-medium text-emerald-700 underline underline-offset-2">
              {tPaddle("refundPolicy")}
            </a>
          </p>
        )}
        {changeBlocked && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {tPaddle(scheduledPlan ? "blockedScheduled" : "blockedCanceled")}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {activePlans.map((plan) => {
            const exponent = exponentByCode.get(plan.currency) ?? 2;
            const isCurrent = subscription?.plan_key === plan.key && (subscription.status === "active" || (renewing && subscription.status === "past_due"));
            const direction = subscription ? planChangeDirection(subscription.plan_key, plan.key, allPlans as PlanForChange[]) : "upgrade";
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
                ) : renewing && subscription ? (
                  changeBlocked ? (
                    <Button type="button" className="w-fit" disabled>
                      {tPaddle(direction === "downgrade" ? "downgrade" : "upgrade")}
                    </Button>
                  ) : direction === "downgrade" ? (
                    <ConfirmForm
                      action={subscribeAction}
                      hidden={{ tenantId: tenant.id, planKey: plan.key, locale, slug }}
                      confirm={tPaddle("downgradeConfirm", {
                        plan: plan.name[locale] ?? plan.name.en ?? plan.key,
                        date: subscription.current_period_end ? fmtDate(subscription.current_period_end) : "",
                      })}
                      testId={`downgrade-${plan.key}`}
                    >
                      <Button type="submit" variant="secondary" className="w-fit">
                        {tPaddle("downgrade")}
                      </Button>
                    </ConfirmForm>
                  ) : (
                    <Link
                      href={`/${locale}/${slug}/billing/change/${encodeURIComponent(plan.key)}`}
                      data-testid={`upgrade-${plan.key}`}
                      className="inline-flex w-fit items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                    >
                      {tPaddle("upgrade")}
                    </Link>
                  )
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
