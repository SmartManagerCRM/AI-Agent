import Link from "next/link";

import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { displayMoney } from "@/server/platform/display-currency";
import { getRecentSubscribers } from "@/server/platform/dashboard-stats";
import { markAllSubscribersCheckedAction } from "@/server/platform/subscriber-checks";
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
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: statusParam } = await searchParams;
  const statusFilter = (STATUS_FILTERS as readonly string[]).includes(statusParam ?? "") ? statusParam : null;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const t = await getTranslations("platform.subscribers");
  const tAll = await getTranslations();

  const [subscribers, { data: currencies }, { data: unchecked }] = await Promise.all([
    getRecentSubscribers(supabase, 200, locale),
    supabase.from("currencies").select("code, exponent"),
    supabase.rpc("unchecked_subscribers"),
  ]);
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
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page navigation */}
        <a
          href="/api/super-admin/export/subscribers"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {t("export")}
        </a>
      </div>

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
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">{t("col.subscriber")}</th>
                  <th className="py-2 text-start font-medium">{t("col.business")}</th>
                  <th className="py-2 text-start font-medium">{t("col.type")}</th>
                  <th className="py-2 text-start font-medium">{t("col.plan")}</th>
                  <th className="py-2 text-start font-medium">{t("col.status")}</th>
                  <th className="py-2 text-start font-medium">{t("col.joined")}</th>
                  <th className="py-2 text-start font-medium">{t("col.revenue")}</th>
                  <th className="py-2 text-start font-medium" />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr
                    key={s.userId}
                    className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${uncheckedSlugs.has(s.slug) ? "bg-amber-50/50" : ""}`}
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
                ))}
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
