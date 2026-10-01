import { EmptyState } from "@/components/console/empty-state";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { KpiTile } from "@/components/console/kpi-tile";
import { Tabs, type Tab } from "@/components/console/tabs";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const CHANNEL_LABEL: Record<string, string> = {
  external_agent: "External Agent",
  website_widget: "Website Widget",
};

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale, slug } = await params;
  const { status: statusFilter } = await searchParams;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const { data: allConversations } = await supabase
    .from("conversations")
    .select("id, channel, status, started_at, last_message_at")
    .eq("tenant_id", tenant.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  const conversationIds = (allConversations ?? []).map((c) => c.id);
  const [{ data: lastMessages }, { data: relatedOrders }] = await Promise.all([
    // Only each conversation's newest message, picked in Postgres — not
    // every message of all 100 conversations.
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

  const counts = { all: (allConversations ?? []).length, open: 0, closed: 0 };
  for (const c of allConversations ?? []) counts[c.status === "open" ? "open" : "closed"]++;

  const conversations =
    statusFilter && statusFilter !== "all"
      ? (allConversations ?? []).filter((c) => c.status === statusFilter)
      : (allConversations ?? []);

  const baseHref = `/${locale}/${slug}/conversations`;
  const tabs: Tab[] = (["all", "open", "closed"] as const).map((key) => ({
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    count: counts[key],
    href: key === "all" ? baseHref : `${baseHref}?status=${key}`,
    active: (statusFilter ?? "all") === key,
  }));

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Conversations</h1>

      <div className="grid grid-cols-3 gap-4">
        <KpiTile icon="conversations" accent="emerald" label="Total" value={String(counts.all)} trend={null} href={`/${locale}/${slug}/conversations`} />
        <KpiTile icon="orders" accent="blue" label="Open" value={String(counts.open)} trend={null} href={`/${locale}/${slug}/conversations?status=open`} />
        <KpiTile icon="billing" accent="purple" label="Closed" value={String(counts.closed)} trend={null} href={`/${locale}/${slug}/conversations?status=closed`} />
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
                        {customerName ?? CHANNEL_LABEL[conversation.channel] ?? conversation.channel}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          conversation.status === "open"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {conversation.status}
                      </span>
                    </div>
                    {last && (
                      <p className="mt-0.5 truncate text-slate-600">
                        <span className="font-medium capitalize">{last.role}:</span> {last.content.slice(0, 160)}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-slate-400">
                      {CHANNEL_LABEL[conversation.channel] ?? conversation.channel} · started{" "}
                      {new Date(conversation.started_at).toLocaleString(locale)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState
              title={counts.all === 0 ? "No conversations yet" : "No conversations match this filter"}
              description={
                counts.all === 0
                  ? "They will appear here once customers start talking to your Agent."
                  : "Try a different status filter."
              }
              actionLabel={counts.all === 0 ? "Set up your Agent" : undefined}
              actionHref={counts.all === 0 ? `/${locale}/${slug}/agent` : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
