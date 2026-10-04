import Link from "next/link";

import { Disclosure } from "@/components/console/disclosure";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { EnrolForm, MemberActions, PlanRow, type PlanSummary } from "@/components/memberships/membership-ui";
import { NEW_PLAN, PlanForm, type PlanFormValues } from "@/components/memberships/plan-form";
import { EXPIRING_DAYS, memberState, type MemberState } from "@/lib/membership-state";
import { getTranslations } from "next-intl/server";
import { ManageControls } from "@/components/console/managed-item";
import { deleteMemberAction, updateMemberDetailsAction } from "@/server/manage/actions";
import { formatMoney } from "@/lib/money";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { businessToday } from "@/lib/timezone";

const PAGE_SIZE = 50;

const STATE_STYLE: Record<MemberState, string> = {
  active: "bg-emerald-50 text-emerald-700",
  expiring: "bg-amber-50 text-amber-700",
  grace: "bg-orange-50 text-orange-700",
  expired: "bg-red-50 text-red-700",
  trial: "bg-sky-50 text-sky-700",
  upcoming: "bg-indigo-50 text-indigo-700",
  paused: "bg-slate-100 text-slate-600",
  cancelled: "bg-slate-100 text-slate-400",
};
const FILTERS = ["current", "expiring", "expired", "unpaid", "paused", "cancelled", "all"] as const;
type Filter = (typeof FILTERS)[number];

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Memberships: plans (loyalty or paid service subscriptions) and the customers who hold them. */
export default async function MembershipsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ page?: string; filter?: string; q?: string }>;
}) {
  const { locale, slug } = await params;
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const filter: Filter = FILTERS.find((f) => f === sp.filter) ?? "current";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.memberships");
  const tAll = await getTranslations();
  const today = businessToday(tenant.timezone);
  const monthStart = `${today.slice(0, 8)}01`;

  let members = supabase
    .from("memberships")
    .select("id, plan_id, member_number, customer_name, customer_phone, customer_email, status, start_date, end_date, auto_renew, price_minor, currency, payment_status, visits_used, notes", { count: "exact" })
    .eq("tenant_id", tenant.id);
  // Current: still members today — active or frozen, not past their renewal date.
  if (filter === "current") members = members.in("status", ["active", "paused"]).or(`end_date.is.null,end_date.gte.${today}`);
  if (filter === "expiring") members = members.eq("status", "active").gte("end_date", today).lte("end_date", addDays(today, EXPIRING_DAYS));
  if (filter === "expired") members = members.eq("status", "active").lt("end_date", today);
  if (filter === "unpaid") members = members.neq("status", "cancelled").eq("payment_status", "unpaid");
  if (filter === "paused") members = members.eq("status", "paused");
  if (filter === "cancelled") members = members.eq("status", "cancelled");
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    members = /^\d+$/.test(q) ? members.or(`member_number.eq.${q},customer_phone.ilike.%${safe}%`) : members.or(`customer_name.ilike.%${safe}%,customer_phone.ilike.%${safe}%,customer_email.ilike.%${safe}%`);
  }

  const [{ data: plansRaw }, { data: services }, { data: currencies }, membersResult, { count: activeCount }, { count: expiringCount }, { count: unpaidCount }, { data: monthPayments }, { count: visitsToday }] =
    await Promise.all([
      supabase.from("membership_plans").select("*").eq("tenant_id", tenant.id).is("archived_at", null).order("created_at"),
      supabase.from("bookable_services").select("id, name").eq("tenant_id", tenant.id).is("archived_at", null).order("created_at"),
      supabase.from("currencies").select("code, exponent"),
      members.order("member_number", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
      supabase.from("memberships").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).in("status", ["active", "paused"]).or(`end_date.is.null,end_date.gte.${today}`),
      supabase.from("memberships").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "active").gte("end_date", today).lte("end_date", addDays(today, EXPIRING_DAYS)),
      supabase.from("memberships").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).neq("status", "cancelled").eq("payment_status", "unpaid"),
      supabase.from("membership_payments").select("amount_minor, currency").eq("tenant_id", tenant.id).gte("paid_at", `${monthStart}T00:00:00Z`),
      supabase.from("membership_visits").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).gte("visited_at", `${today}T00:00:00Z`),
    ]);
  const exponents = new Map((currencies ?? []).map((c) => [c.code, c.exponent]));
  const money = (minor: number, code: string) => formatMoney(minor, code, exponents.get(code) ?? 2, locale);
  const serviceName = new Map((services ?? []).map((s) => [s.id, s.name[locale] ?? Object.values(s.name)[0] ?? ""]));
  const allPlans = plansRaw ?? [];
  const planById = new Map(allPlans.map((p) => [p.id, p]));

  // Plans that members hold but were deleted still need their grace period and name.
  const memberRows = membersResult.data ?? [];
  const missing = [...new Set(memberRows.map((m) => m.plan_id).filter((id) => !planById.has(id)))];
  if (missing.length > 0) {
    const { data: archived } = await supabase.from("membership_plans").select("*").in("id", missing);
    for (const p of archived ?? []) planById.set(p.id, p);
  }
  const { data: memberCounts } = allPlans.length
    ? await supabase.from("memberships").select("plan_id").eq("tenant_id", tenant.id).neq("status", "cancelled").in("plan_id", allPlans.map((p) => p.id))
    : { data: [] as { plan_id: string }[] };
  const countByPlan = new Map<string, number>();
  for (const m of memberCounts ?? []) countByPlan.set(m.plan_id, (countByPlan.get(m.plan_id) ?? 0) + 1);

  const name = (p: { name: Record<string, string> }) => p.name[locale] ?? Object.values(p.name)[0] ?? "";
  const summaries: PlanSummary[] = allPlans.map((p) => ({
    id: p.id,
    name: name(p),
    kind: p.kind,
    priceLabel: money(p.price_minor, p.currency),
    joiningFeeLabel: p.joining_fee_minor > 0 ? money(p.joining_fee_minor, p.currency) : null,
    periodLabel: t("period", { period: p.billing_period, count: p.period_count }),
    noExpiry: p.billing_period === "none",
    free: p.price_minor === 0 && p.joining_fee_minor === 0,
    trialDays: p.trial_days,
    graceDays: p.grace_days,
    visitsPerPeriod: p.visits_per_period,
    discountPercent: p.discount_percent === null ? null : Number(p.discount_percent),
    benefits: (p.benefits ?? "").split("\n").map((b) => b.trim()).filter(Boolean),
    maxMembers: p.max_members,
    members: countByPlan.get(p.id) ?? 0,
    includedServices: p.service_ids.map((id) => serviceName.get(id)).filter((n): n is string => !!n),
    autoRenewDefault: p.auto_renew_default,
    isActive: p.is_active,
  }));
  const formValues = (p: (typeof allPlans)[number]): PlanFormValues => {
    const exp = exponents.get(p.currency) ?? 2;
    return {
      id: p.id,
      name: name(p),
      description: p.description[locale] ?? Object.values(p.description)[0] ?? "",
      kind: p.kind,
      price: p.price_minor ? (p.price_minor / 10 ** exp).toFixed(exp) : "",
      joiningFee: p.joining_fee_minor ? (p.joining_fee_minor / 10 ** exp).toFixed(exp) : "",
      billingPeriod: p.billing_period,
      periodCount: p.period_count,
      autoRenew: p.auto_renew_default,
      trialDays: p.trial_days,
      graceDays: p.grace_days,
      visitsPerPeriod: p.visits_per_period?.toString() ?? "",
      discountPercent: p.discount_percent?.toString() ?? "",
      benefits: p.benefits ?? "",
      maxMembers: p.max_members?.toString() ?? "",
      serviceIds: p.service_ids,
    };
  };
  const exponent = exponents.get(tenant.currency) ?? 2;
  const serviceOptions = (services ?? []).map((s) => ({ id: s.id, name: serviceName.get(s.id) ?? "" }));
  const revenue = (monthPayments ?? []).filter((p) => p.currency === tenant.currency).reduce((sum, p) => sum + p.amount_minor, 0);
  const base = `/${locale}/${slug}/memberships`;
  const href = (next: { filter?: string; q?: string }) => {
    const params = new URLSearchParams();
    const f = next.filter ?? filter;
    if (f !== "current") params.set("filter", f);
    const query = next.q ?? q;
    if (query) params.set("q", query);
    const s = params.toString();
    return `${base}${s ? `?${s}` : ""}#members`;
  };
  const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="membership" accent="emerald" label={t("currentMembers")} value={String(activeCount ?? 0)} trend={null} href={href({ filter: "current", q: "" })} />
        <KpiTile icon="bell" accent="orange" label={t("filter.expiring", { days: EXPIRING_DAYS })} value={String(expiringCount ?? 0)} trend={null} href={href({ filter: "expiring", q: "" })} />
        <KpiTile icon="billing" accent="purple" label={t("filter.unpaid")} value={String(unpaidCount ?? 0)} trend={null} href={href({ filter: "unpaid", q: "" })} />
        <KpiTile icon="analytics" accent="blue" label={t("collected", { count: visitsToday ?? 0 })} value={money(revenue, tenant.currency)} trend={null} trendLabel="" href={href({ filter: "all", q: "" })} />
      </div>

      <section id="plans" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("plans")}</h2>
        <div className="flex flex-col gap-2">
          {allPlans.map((p, i) => (
            <PlanRow key={p.id} plan={summaries[i]} form={formValues(p)} locale={locale} slug={slug} currency={p.currency} exponent={exponents.get(p.currency) ?? 2} services={serviceOptions} />
          ))}
          {allPlans.length === 0 && <p className="py-2 text-sm text-slate-400">{t("noPlans")}</p>}
        </div>
        <Disclosure summary={t("newPlan")} initiallyOpen={allPlans.length === 0}>
          <PlanForm locale={locale} slug={slug} currency={tenant.currency} exponent={exponent} services={serviceOptions} initial={NEW_PLAN} />
        </Disclosure>
      </section>

      {summaries.some((p) => p.isActive) && (
        <section id="add-member" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("addMember")}</h2>
          <EnrolForm locale={locale} slug={slug} today={today} plans={summaries.filter((p) => p.isActive)} />
        </section>
      )}

      <section id="members" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{t("members")}</h2>
          <form action={base} className="flex items-center gap-2">
            {filter !== "current" && <input type="hidden" name="filter" value={filter} />}
            <input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} className="w-56 rounded-md border border-slate-200 px-3 py-1.5 text-sm" />
            <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
              {t("search")}
            </button>
          </form>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={href({ filter: f })}
              prefetch={false}
              className={`rounded-full px-3 py-1 text-xs font-medium ${f === filter ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t(`filter.${f}`, { days: EXPIRING_DAYS })}
            </Link>
          ))}
        </div>
        {memberRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">#</th>
                  <th className="py-2 text-start font-medium">{t("col.member")}</th>
                  <th className="py-2 text-start font-medium">{t("col.plan")}</th>
                  <th className="py-2 text-start font-medium">{t("col.started")}</th>
                  <th className="py-2 text-start font-medium">{t("col.renewal")}</th>
                  <th className="py-2 text-start font-medium">{t("col.price")}</th>
                  <th className="py-2 text-start font-medium">{t("col.payment")}</th>
                  <th className="py-2 text-start font-medium">{t("col.visits")}</th>
                  <th className="py-2 text-start font-medium">{t("col.status")}</th>
                  <th className="py-2 text-start font-medium">{t("col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {memberRows.map((m) => {
                  const plan = planById.get(m.plan_id);
                  const state = memberState(m, plan?.grace_days ?? 0, today);
                  const renewable = !!plan && plan.billing_period !== "none" && m.status !== "cancelled";
                  return (
                    <tr key={m.id} className="border-b border-slate-100 align-top last:border-0" data-testid="member-row">
                      <td className="py-2 font-mono text-xs text-slate-500">{m.member_number}</td>
                      <td className="py-2 text-slate-900">
                        {m.customer_name}
                        {m.customer_phone && <span className="block text-xs text-slate-400" dir="ltr">{m.customer_phone}</span>}
                        {m.notes && <span className="block text-xs text-slate-400">“{m.notes}”</span>}
                      </td>
                      <td className="py-2 text-slate-600">{plan ? name(plan) : "—"}</td>
                      <td className="whitespace-nowrap py-2 text-slate-600">{fmtDate(m.start_date)}</td>
                      <td className="whitespace-nowrap py-2 text-slate-600">
                        {m.end_date ? fmtDate(m.end_date) : t("noExpiry")}
                        {m.end_date && <span className="block text-xs text-slate-400">{m.auto_renew ? t("autoRenew") : t("manualRenewal")}</span>}
                      </td>
                      <td className="whitespace-nowrap py-2 text-slate-600">{m.price_minor ? money(m.price_minor, m.currency) : t("free")}</td>
                      <td className="py-2 text-xs text-slate-600">{t.has(`payment.${m.payment_status}`) ? t(`payment.${m.payment_status}`) : m.payment_status}</td>
                      <td className="py-2 text-slate-600">
                        {m.visits_used}
                        {plan?.visits_per_period ? ` / ${plan.visits_per_period}` : ""}
                      </td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[state]}`}>{t(`state.${state}`)}</span>
                      </td>
                      <td className="py-2">
                        <MemberActions
                          locale={locale}
                          slug={slug}
                          membershipId={m.id}
                          name={m.customer_name}
                          status={m.status}
                          canRenew={renewable}
                          unpaid={m.payment_status === "unpaid"}
                          checkIn={plan?.kind === "service" || !!plan?.visits_per_period}
                        />
                        <ManageControls
                          testId="member-controls"
                          heading={`#${m.member_number} · ${m.customer_name}`}
                          hidden={{ locale, slug, id: m.id }}
                          fields={[
                            { name: "name", label: tAll("common.name"), defaultValue: m.customer_name, required: true, maxLength: 120 },
                            { name: "phone", label: tAll("common.phone"), type: "tel", defaultValue: m.customer_phone, maxLength: 40 },
                            { name: "email", label: tAll("common.email"), type: "email", defaultValue: m.customer_email, maxLength: 200 },
                            { name: "notes", label: tAll("common.notes"), type: "textarea", defaultValue: m.notes, maxLength: 1000 },
                          ]}
                          update={updateMemberDetailsAction}
                          remove={deleteMemberAction}
                          deleteConfirm={tAll("console.manage.deleteMember", { name: m.customer_name })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={q || filter !== "current" ? t("noMatch") : t("empty")} description={t("emptyDescription")} />
        )}
        <Pagination basePath={base} params={{ ...(filter !== "current" ? { filter } : {}), ...(q ? { q } : {}) }} page={page} pageSize={PAGE_SIZE} total={membersResult.count ?? 0} />
      </section>
    </div>
  );
}
