import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export default async function ConversationsPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, channel, status, started_at, last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(50);

  const conversationIds = (conversations ?? []).map((c) => c.id);
  const { data: lastMessages } = conversationIds.length
    ? await supabase
        .from("conversation_messages")
        .select("conversation_id, role, content, handled_by, created_at")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const lastByConversation = new Map<string, { content: string; role: string; handled_by: string | null }>();
  for (const message of lastMessages ?? []) {
    if (!lastByConversation.has(message.conversation_id)) {
      lastByConversation.set(message.conversation_id, message);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Conversations</h1>
      <ul className="flex flex-col gap-2">
        {(conversations ?? []).map((conversation) => {
          const last = lastByConversation.get(conversation.id);
          return (
            <li key={conversation.id} className="rounded-md border border-neutral-200 px-4 py-3 text-sm">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span className="capitalize">{conversation.channel.replace("_", " ")}</span>
                <span>{conversation.status}</span>
              </div>
              {last && (
                <p className="mt-1 text-neutral-700">
                  <span className="font-medium capitalize">{last.role}:</span> {last.content.slice(0, 200)}
                  {last.handled_by && <span className="ms-2 text-xs text-neutral-400">({last.handled_by})</span>}
                </p>
              )}
              <p className="mt-1 text-xs text-neutral-400">
                Started {new Date(conversation.started_at).toLocaleString(locale)}
              </p>
            </li>
          );
        })}
        {(conversations ?? []).length === 0 && (
          <p className="text-sm text-neutral-400">
            No conversations yet — they will appear here once customers start talking to your Agent.
          </p>
        )}
      </ul>
    </div>
  );
}
