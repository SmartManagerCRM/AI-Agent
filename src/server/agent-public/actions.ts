"use server";

import { z } from "zod";

import { LOCALES } from "@/i18n/locales";
import type { AgentErrorCode } from "@/lib/agent-errors";

import { runAgentGateway } from "@/server/ai";
import { AGENT_MODALITY_TEXT, AGENT_MODALITY_VOICE } from "@/server/ai/channel";
import { agentLog } from "@/server/ai/diagnostics";
import type { AITurnMessage } from "@/server/ai/provider";
import { getOrCreateConversation } from "@/server/agent-public/conversation";
import { resolvePublicTenant, resolveWidgetTenant } from "@/server/agent-public/tenant";
import { isRateLimited } from "@/server/shared/rate-limit";
import type { CartView } from "@/server/commerce/cart";
import { findActiveTable } from "@/server/commerce/tables";
import { serviceClient } from "@/server/supabase/clients";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

const MAX_HISTORY_MESSAGES = 12;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_MESSAGES = 20;

const sendMessageSchema = z.object({
  slug: z.string().trim().min(1).max(60),
  message: z.string().trim().min(1).max(1000),
  surface: z.enum(["external_agent", "website_widget"]).default("external_agent"),
  /** Raw, unvalidated — re-checked against `branch_tables` below before it's trusted for anything (spec §25/§39). */
  tableId: z.string().trim().max(100).optional(),
  /** How the customer entered the message (spoken = transcribed in their browser). Delivery metadata only. */
  modality: z.enum(["text", "voice"]).default("text"),
  /** The language the customer picked in the Agent (its language bar); replies follow it. */
  locale: z.enum(LOCALES).optional(),
});

export type SendAgentMessageState =
  | {
      reply: string;
      handledBy: "deterministic" | "ai";
      message: string;
      cart?: CartView | null;
      productIds?: string[];
      /** The stored reply's id — the page asks the voice endpoint to speak exactly this message. */
      messageId?: string;
      /** An order the Agent placed with this reply. */
      placedOrder?: { orderNumber: number };
    }
  | { error: AgentErrorCode }
  | undefined;

/**
 * The External Agent's one server entry point (addendum §14, spec §22's
 * "external Agent customer flow"). Tenant identity comes only from the slug
 * the server itself resolved and validated; the customer's identity is only
 * the hashed session cookie — nothing here trusts anything else the client
 * sends.
 */
export async function sendAgentMessageAction(
  _prevState: SendAgentMessageState,
  formData: FormData,
): Promise<SendAgentMessageState> {
  const parsed = sendMessageSchema.safeParse({
    slug: formData.get("slug"),
    message: formData.get("message"),
    surface: formData.get("surface") ?? undefined,
    tableId: formData.get("tableId") ?? undefined,
    modality: formData.get("modality") ?? undefined,
    locale: formData.get("locale") ?? undefined,
  });
  if (!parsed.success) return { error: "messageEmpty" };

  const isWidget = parsed.data.surface === "website_widget";
  const tenant = await (isWidget ? resolveWidgetTenant(parsed.data.slug) : resolvePublicTenant(parsed.data.slug));
  if (!tenant) {
    agentLog("resolve", { business_slug: parsed.data.slug, surface: parsed.data.surface, resolved: false });
    return { error: "unavailable" };
  }
  // Tenant identity comes only from the published deployment behind this slug — never a session, a default or the client.
  agentLog("resolve", { business_slug: tenant.slug, tenant_id: tenant.id, deployment: "published", surface: parsed.data.surface, resolved: true });

  const supabase = serviceClient();
  const activeTable = parsed.data.tableId ? await findActiveTable(supabase, tenant.id, parsed.data.tableId) : null;
  const conversation = await getOrCreateConversation(supabase, tenant.id, tenant.slug, tenant.defaultLanguage, {
    channel: parsed.data.surface,
    crossSite: isWidget,
  });

  if (isRateLimited(conversation.id, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_MESSAGES)) {
    return { error: "chatTooFast" };
  }

  // The customer switched language: the conversation (and so every reply) follows.
  if (parsed.data.locale && parsed.data.locale !== conversation.locale) {
    await supabase.from("conversations").update({ locale: parsed.data.locale }).eq("id", conversation.id).eq("tenant_id", tenant.id);
    conversation.locale = parsed.data.locale;
  }
  const history = await loadHistory(supabase, conversation.id);
  const modality = parsed.data.modality === "voice" ? AGENT_MODALITY_VOICE : AGENT_MODALITY_TEXT;

  await supabase.from("conversation_messages").insert({
    tenant_id: tenant.id,
    conversation_id: conversation.id,
    role: "user",
    content: parsed.data.message,
    modality,
  });

  const result = await runAgentGateway(supabase, {
    tenant: { id: tenant.id, currency: tenant.currency, slug: tenant.slug },
    locale: conversation.locale,
    requestType: parsed.data.surface,
    message: parsed.data.message,
    history,
    conversationId: conversation.id,
    activeTable,
  });

  const { data: stored } = await supabase
    .from("conversation_messages")
    .insert({
      tenant_id: tenant.id,
      conversation_id: conversation.id,
      role: "assistant",
      content: result.reply,
      handled_by: result.handledBy,
      modality,
    })
    .select("id")
    .single();
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation.id);

  return {
    reply: result.reply,
    handledBy: result.handledBy,
    message: parsed.data.message,
    cart: "cart" in result ? (result.cart ?? null) : null,
    productIds: "productIds" in result ? result.productIds : undefined,
    placedOrder: "placedOrder" in result ? result.placedOrder : undefined,
    messageId: stored?.id,
  };
}

async function loadHistory(supabase: TypedSupabaseClient, conversationId: string): Promise<AITurnMessage[]> {
  const { data } = await supabase
    .from("conversation_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  return (data ?? [])
    .slice()
    .reverse()
    .map((m) => ({ role: m.role, content: [{ type: "text" as const, text: m.content }] }));
}
