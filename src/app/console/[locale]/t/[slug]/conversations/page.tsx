import { EmptyState } from "@/components/console/empty-state";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { Tabs, type Tab } from "@/components/console/tabs";
import Link from "next/link";

import { createUserClient } from "@/server/supabase/clients";
import { branchScope } from "@/server/tenant/branches";
import { requireTenantMember } from "@/server/tenant/context";
import { Msg } from "@/components/i18n/msg";
import { getTranslations } from "next-intl/server";
import { channelLabel, statusLabel } from "@/lib/i18n-labels";

const STATUSES = ["all", "open", "closed"] as const;
type StatusTab = (typeof STATUSES)[number];
const PAGE_SIZE = 50;

/** A link to the conversations list with these filters (empty ones left out). */
const withQuery = (base: string, params: Record<string, string | undefined>) => {
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return query ? `${base}?${query}` : base;
};

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ status?: string; page?: string; branch?: string }>;
}) {
  const { locale, slug } = await params;
  const { status: statusParam, page: pageParam, branch: branchParam } = await searchParams;
  const statusFilter: StatusTab = STATUSES.find((s) => s === statusParam) ?? "all";
  const page = parsePage(pageParam);
  const { tenant } = await requireTenantMember(locale, slug);
  const t = await getTranslations("console.conversations");
  const tAll = await getTranslations();
  const supabase = await createUserClient();
  // Branches: a conversation belongs to the branch the customer ordered or booked at (none yet =
  // the main branch); staff see only their branches' (enforced by the database). Customers
  // themselves are shared by every branch. With several branches, a filter and each one's branch.
  const scope = await branchScope(tenant.id, locale);
  const visibleBranches = scope.restricted ? scope.all.filter((b) => scope.allowed.some((a) => a.id === b.id)) : scope.all;
  const showBranches = visibleBranches.length > 1;
  const branchFilter = showBranches ? (visibleBranches.find((b) => b.id === branchParam) ?? null) : null;
  const inBranch = <Q extends { eq: (c: "branch_id", v: string) => Q; or: (f: string) => Q }>(query: Q): Q =>
    !branchFilter ? query : branchFilter.isDefault ? query.or(`branch_id.eq.${branchFilter.id},branch_id.is.null`) : query.eq("branch_id", branchFilter.id);

  // Counts are exact (counted in Postgres), and the list is paged — every conversation is reachable.
  const countOf = (status: StatusTab) => {
    let count = supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
    if (status !== "all") count = count.eq("status", status);
    count = inBranch(count);
    return count.then(({ count: n }) => n ?? 0);
  };
  let query = supabase
    .from("conversations")
    .select("id, channel, status, started_at, last_message_at, branch_id")
    .eq("tenant_id", tenant.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (statusFilter !== "all") query = query.eq("status", statusFilter);
  query = inBranch(query);
  const [{ data: pageRows }, statusCounts] = await Promise.all([query, Promise.all(STATUSES.map(countOf))]);
  const conversations = pageRows ?? [];

  const conversationIds = conversations.map((c) => c.id);
  const [{ data: lastMessages }, { data: relatedOrders }] = await Promise.all([
    // Only each conversation's newest message, picked in Postgres — not
    // every message of every conversation on this page.
    conversationIds.length
      ? supabase.rpc("conversation_last_messages", { p_conversation_ids: conversationIds })
      : Promise.resolve({ data: [] }),
    conversationIds.length
      ? supabase.from("orders").select("conversation_id, customer_name").in("conversation_id", conversationIds)
      : Promise.resolve({ data: [] }),
  ]);

  const lastByConversation = new Map<string, { content: string; role: string; handled_by: string | null }>();
  for (const message of lastMessages ?? []) {
    if (!lastByConversation.has(message.conversation_id)) lastByConversation.set(message.conversation_id, message);
  }
  const customerByConversation = new Map<string, string>();
  for (const order of relatedOrders ?? []) {
    if (order.conversation_id && order.customer_name)
      customerByConversation.set(order.conversation_id, order.customer_name);
  }

  const counts = Object.fromEntries(STATUSES.map((s, i) => [s, statusCounts[i]])) as Record<StatusTab, number>;

  const baseHref = `/${locale}/${slug}/conversations`;
  const tabs: Tab[] = STATUSES.map((key) => ({
    key,
    label: t(key),
    count: counts[key],
    href: withQuery(baseHref, { status: key === "all" ? undefined : key, branch: branchFilter?.id }),
    active: statusFilter === key,
  }));

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900"><Msg id="console.conversations.conversations" /></h1>

      <div className="grid grid-cols-3 gap-4">
        <KpiTile icon="conversations" accent="emerald" label={tAll("common.total")} value={String(counts.all)} trend={null} href={`/${locale}/${slug}/conversations`} />
        <KpiTile icon="orders" accent="blue" label={t("open")} value={String(counts.open)} trend={null} href={`/${locale}/${slug}/conversations?status=open`} />
        <KpiTile icon="billing" accent="purple" label={t("closed")} value={String(counts.closed)} trend={null} href={`/${locale}/${slug}/conversations?status=closed`} />
      </div>

      {showBranches && (
        <nav className="flex flex-wrap gap-2" aria-label={t("branchFilter")} data-testid="conversation-branch-filter">
          {[{ id: null as string | null, name: t("allBranches") }, ...visibleBranches].map((b) => {
            const active = (branchFilter?.id ?? null) === b.id;
            return (
              <Link
                key={b.id ?? "all"}
                href={withQuery(baseHref, { status: statusFilter === "all" ? undefined : statusFilter, branch: b.id ?? undefined })}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-sm ${active ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {b.name}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 pt-3">
          <Tabs tabs={tabs} />
        </div>
        {conversations.length > 0 ? (
          <ul className="flex flex-col">
            {conversations.map((conversation) => {
              const last = lastByConversation.get(conversation.id);
              const customerName = customerByConversation.get(conversation.id);
              return (
                <li
                  key={conversation.id}
                  className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-0"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <Icon path={NAV_ICON_PATHS.conversations} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">
                        {customerName ?? channelLabel(tAll, conversation.channel)}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          conversation.status === "open"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {statusLabel(tAll, conversation.status)}
                      </span>
                    </div>
                    {last && (
                      <p className="mt-0.5 truncate text-slate-600">
                        <span className="font-medium">{tAll.has(`common.messageRole.${last.role}`) ? tAll(`common.messageRole.${last.role}`) : last.role}:</span> {last.content.slice(0, 160)}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-slate-400">
                      {t("started", { channel: channelLabel(tAll, conversation.channel), date: new Date(conversation.started_at).toLocaleString(locale) })}
                      {showBranches && (
                        <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600" data-testid="conversation-branch">
                          {scope.nameOf(conversation.branch_id)}
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState
              title={counts.all === 0 ? t("emptyTitle") : t("noMatchTitle")}
              description={
                counts.all === 0
                  ? t("emptyDescription")
                  : t("noMatchDescription")
              }
              actionLabel={counts.all === 0 ? t("setUpAgent") : undefined}
              actionHref={counts.all === 0 ? `/${locale}/${slug}/agent` : undefined}
            />
          </div>
        )}
        <Pagination
          basePath={baseHref}
          params={{ status: statusFilter === "all" ? undefined : statusFilter, branch: branchFilter?.id }}
          page={page}
          pageSize={PAGE_SIZE}
          total={counts[statusFilter]}
        />
      </div>
    </div>
  );
}
