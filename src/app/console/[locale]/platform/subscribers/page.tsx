import Link from "next/link";

import { EmptyState } from "@/components/console/empty-state";
import { NewSubscriptionForm } from "@/components/platform/new-subscription-form";
import { KpiTile } from "@/components/console/kpi-tile";
import { AI_USAGE_DOT, AI_USAGE_ROW, aiUsageBand, type AiUsageBand } from "@/lib/platform/ai-usage-band";
import { displayMoney } from "@/server/platform/display-currency";
import { getRecentSubscribers } from "@/server/platform/dashboard-stats";
import { markAllSubscribersCheckedAction } from "@/server/platform/subscriber-checks";
import { loadPlatformUsage } from "@/server/platform/usage";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";
import { RichMsg } from "@/components/i18n/msg";
import { statusLabel } from "@/lib/i18n-labels";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  trialing: "bg-blue-50 text-blue-700",
  past_due: "bg-amber-50 text-amber-700",
  canceled: "bg-red-50 text-red-700",
  no_plan: "bg-slate-100 text-slate-500",
};

const STATUS_FILTERS = ["active", "trialing", "past_due", "canceled", "no_plan"] as const;

export default async function SubscribersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; new?: string }>;
}) {
  const { locale } = await params;
  const { status: statusParam, new: newParam } = await searchParams;
  const creating = newParam === "1";
  const statusFilter = (STATUS_FILTERS as readonly string[]).includes(statusParam ?? "") ? statusParam : null;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const t = await getTranslations("platform.subscribers");
  const tAll = await getTranslations();

  const [subscribers, { data: currencies }, { data: unchecked }, usage] = await Promise.all([
    getRecentSubscribers(supabase, 200, locale),
    supabase.from("currencies").select("code, exponent"),
    supabase.rpc("unchecked_subscribers"),
    loadPlatformUsage(supabase).catch(() => []),
  ]);
  // AI Agent spend this month against each subscriber's own cap (an individual cap wins over the plan's).
  const aiBySlug = new Map(usage.map((u) => [u.slug, { used: u.aiCostUsed, cap: u.aiCostLimit, band: aiUsageBand(u.aiCostUsed, u.aiCostLimit) }]));
  const percentFmt = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });

  // The New subscription form's choices (only when it is open).
  const [{ data: planRows }, { data: typeRows }] = creating
    ? await Promise.all([
        supabase.from("subscription_plans").select("key, name, price_minor, currency, billing_interval, trial_days, sort_order").eq("is_active", true).order("sort_order").order("price_minor"),
        supabase.from("business_types").select("key, name").eq("is_active", true).order("key"),
      ])
    : [{ data: null }, { data: null }];
  const local = (v: unknown) => {
    const m = (v ?? {}) as Record<string, string>;
    return m[locale] ?? m.en ?? Object.values(m)[0] ?? "";
  };
  const planOptions = (planRows ?? []).map((p) => {
    const exponent = (currencies ?? []).find((c) => c.code === p.currency)?.exponent ?? 2;
    const price = new Intl.NumberFormat(locale, { style: "currency", currency: p.currency }).format(p.price_minor / 10 ** exponent);
    const interval = p.billing_interval === "year" ? "year" : "month";
    return { key: p.key, label: `${local(p.name) || p.key} · ${price} / ${t(interval === "year" ? "newPerYear" : "newPerMonth")}`, interval: interval as "month" | "year", trialDays: p.trial_days };
  });
  // New subscribers no Super Admin has opened yet (opening one checks it).
  const uncheckedSlugs = new Set((unchecked ?? []).map((u) => u.slug));
  const exponentByCode = new Map((currencies ?? []).map((c) => [c.code, c.exponent]));
  const dm = await displayMoney(supabase, locale);

  const activeCount = subscribers.filter((s) => s.status === "active").length;
  const trialCount = subscribers.filter((s) => s.status === "trialing").length;
  const pastDueCount = subscribers.filter((s) => s.status === "past_due").length;
  const shown = statusFilter ? subscribers.filter((s) => s.status === statusFilter) : subscribers;
  const base = `/${locale}/super-admin/subscribers`;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
        <Link
          href={creating ? base : `${base}?new=1`}
          prefetch={false}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          data-testid="new-subscription-toggle"
        >
          {creating ? t("newClose") : t("newOpen")}
        </Link>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page navigation */}
        <a
          href="/api/super-admin/export/subscribers"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {t("export")}
        </a>
        </div>
      </div>

      {creating && (
        <section className="rounded-xl border border-emerald-200 bg-white p-4" aria-labelledby="new-subscription-title">
          <h2 id="new-subscription-title" className="mb-1 text-base font-semibold text-slate-900">
            {t("newTitle")}
          </h2>
          <p className="mb-4 text-sm text-slate-600">{t("newText")}</p>
          <NewSubscriptionForm
            locale={locale}
            plans={planOptions}
            businessTypes={(typeRows ?? []).map((b) => ({ value: b.key, label: local(b.name) || b.key }))}
            currencies={(currencies ?? []).map((c) => c.code).sort()}
            defaultCurrency="USD"
          />
        </section>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon="customers"
          accent="emerald"
          label={t("total")}
          value={String(subscribers.length)}
          trend={null}
          href={base}
        />
        <KpiTile
          icon="billing"
          accent="blue"
          label={t("active")}
          value={String(activeCount)}
          trend={null}
          href={`${base}?status=active`}
        />
        <KpiTile
          icon="agent"
          accent="orange"
          label={t("trialing")}
          value={String(trialCount)}
          trend={null}
          href={`${base}?status=trialing`}
        />
        <KpiTile
          icon="alert"
          accent="purple"
          label={t("pastDue")}
          value={String(pastDueCount)}
          trend={null}
          href={`${base}?status=past_due`}
        />
      </div>

      {uncheckedSlugs.size > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="unchecked-subscribers"
        >
          <span>
            <RichMsg
              id="platform.subscribers.unchecked"
              values={{
                count: uncheckedSlugs.size,
                b: (c) => <strong>{c}</strong>,
                new: (c) => <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">{c}</span>,
              }}
            />
          </span>
          <form action={markAllSubscribersCheckedAction}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100">
              {t("markAll")}
            </button>
          </form>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600" data-testid="ai-usage-legend">
        <span className="font-medium text-slate-700">{t("aiLegend")}</span>
        {(["green", "yellow", "orange", "red"] as AiUsageBand[]).map((band) => (
          <span key={band} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${AI_USAGE_DOT[band]}`} aria-hidden />
            {t(`aiBand.${band}`)}
          </span>
        ))}
      </div>

      {statusFilter && (
        <p className="text-sm text-slate-600">
          <RichMsg id="platform.subscribers.showing" values={{ status: statusLabel(tAll, statusFilter), b: (c) => <span className="font-medium">{c}</span> }} />{" "}
          <Link href={base} prefetch={false} className="font-medium text-emerald-700 hover:underline">
            {t("showAll")}
          </Link>
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        {shown.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm [&_td]:pe-3 [&_th]:pe-3">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">{t("col.subscriber")}</th>
                  <th className="py-2 text-start font-medium">{t("col.business")}</th>
                  <th className="py-2 text-start font-medium">{t("col.type")}</th>
                  <th className="py-2 text-start font-medium">{t("col.plan")}</th>
                  <th className="py-2 text-start font-medium">{t("col.status")}</th>
                  <th className="py-2 text-start font-medium">{t("col.joined")}</th>
                  <th className="py-2 text-start font-medium">{t("col.revenue")}</th>
                  <th className="py-2 text-start font-medium">{t("col.aiUse")}</th>
                  <th className="py-2 text-start font-medium" />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  // A canceled (or plan-less) business has no running month to judge: no color.
                  const ai = s.status === "canceled" || s.status === "no_plan" ? undefined : aiBySlug.get(s.slug);
                  return (
                  <tr
                    key={s.userId}
                    data-ai-band={ai?.band ?? "none"}
                    className={`border-b border-white/70 last:border-0 hover:brightness-95 ${ai?.band ? AI_USAGE_ROW[ai.band] : "hover:bg-slate-50"}`}
                  >
                    <td className="py-2">
                      <Link href={`${base}/${s.slug}`} prefetch={false} className="font-medium text-slate-900 hover:underline">
                        {s.name}
                      </Link>
                      {uncheckedSlugs.has(s.slug) && (
                        <span className="ms-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white" data-testid="subscriber-new">
                          {t("new")}
                        </span>
                      )}
                      {s.email && <p className="text-xs text-slate-400">{s.email}</p>}
                    </td>
                    <td className="py-2 text-slate-600">
                      <Link href={`${base}/${s.slug}`} prefetch={false} className="hover:underline">
                        {s.businessName}
                      </Link>
                    </td>
                    <td className="py-2 text-slate-600">{s.businessTypeLabel}</td>
                    <td className="py-2 text-slate-600">{s.planLabel ?? "—"}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}
                      >
                        {statusLabel(tAll, s.status)}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">{new Date(s.joinedAt).toLocaleDateString(locale)}</td>
                    <td className="py-2 text-slate-600">
                      {dm.money(s.revenueMinor, s.currency, exponentByCode.get(s.currency) ?? 2)}
                    </td>
                    <td className="py-2 text-slate-700" dir="ltr">
                      {ai && ai.cap !== null ? (
                        <span title={t("aiOfCap", { used: `$${ai.used.toFixed(2)}`, cap: `$${ai.cap}` })}>
                          {percentFmt.format(ai.cap > 0 ? ai.used / ai.cap : 1)}
                          <span className="ms-1 text-xs text-slate-500">/ ${ai.cap}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 text-end">
                      <Link
                        href={`${base}/${s.slug}`}
                        prefetch={false}
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        {t("edit")}
                      </Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={statusFilter ? t("noStatus") : t("empty")}
            description={statusFilter ? t("tryAnother") : t("emptyDescription")}
          />
        )}
      </section>
    </div>
  );
}
