import { EmptyState } from "@/components/console/empty-state";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { Tabs, type Tab } from "@/components/console/tabs";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { Msg } from "@/components/i18n/msg";
import { getTranslations } from "next-intl/server";
import { channelLabel, statusLabel } from "@/lib/i18n-labels";

const STATUSES = ["all", "open", "closed"] as const;
type StatusTab = (typeof STATUSES)[number];
const PAGE_SIZE = 50;

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { locale, slug } = await params;
  const { status: statusParam, page: pageParam } = await searchParams;
  const statusFilter: StatusTab = STATUSES.find((s) => s === statusParam) ?? "all";
  const page = parsePage(pageParam);
  const { tenant } = await requireTenantMember(locale, slug);
  const t = await getTranslations("console.conversations");
  const tAll = await getTranslations();
  const supabase = await createUserClient();

  // Counts are exact (counted in Postgres), and the list is paged — every conversation is reachable.
  const countOf = (status: StatusTab) => {
    let count = supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
    if (status !== "all") count = count.eq("status", status);
    return count.then(({ count: n }) => n ?? 0);
  };
  let query = supabase
    .from("conversations")
    .select("id, channel, status, started_at, last_message_at")
    .eq("tenant_id", tenant.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (statusFilter !== "all") query = query.eq("status", statusFilter);
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
    href: key === "all" ? baseHref : `${baseHref}?status=${key}`,
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
          params={{ status: statusFilter === "all" ? undefined : statusFilter }}
          page={page}
          pageSize={PAGE_SIZE}
          total={counts[statusFilter]}
        />
      </div>
    </div>
  );
}
