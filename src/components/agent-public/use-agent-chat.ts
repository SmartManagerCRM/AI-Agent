"use client";

import { useRef, useState, useTransition } from "react";

import type { AgentErrorCode } from "@/lib/agent-errors";
import { sendAgentMessageAction } from "@/server/agent-public/actions";
import type { CartView } from "@/server/commerce/cart";

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** Local display time of when this message was sent/received in this browser. */
  at: number;
  handledBy?: "deterministic" | "ai";
  cart?: CartView | null;
  /** Catalog products the server says this reply is about (rendered as product cards). */
  productIds?: string[];
  /** The customer spoke this message (the transcript is what was sent). */
  voice?: boolean;
  /** The stored reply's id (assistant messages) — what the premium voice speaks. */
  serverId?: string;
  /** An order the Agent placed with this reply (track it, or leave). */
  placedOrder?: { orderNumber: number };
};

/**
 * Conversation state for the Customer Agent — every reply comes from the
 * existing `sendAgentMessageAction` (deterministic-first gateway, then AI),
 * called with exactly the fields the previous ChatPanel sent. Nothing here
 * generates, rewrites or pre-fills an assistant reply.
 */
export function useAgentChat({
  slug,
  surface,
  tableId,
  locale,
  onCart,
}: {
  slug: string;
  /** The Agent's interface language — replies come in it. */
  locale: string;
  surface: "external_agent" | "website_widget";
  tableId: string | null;
  onCart: (cart: CartView | null) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<AgentErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const nextId = useRef(1);

  const send = (text: string, options?: { voice?: boolean }) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    const voice = options?.voice === true;
    setError(null);
    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text: trimmed, at: Date.now(), voice }]);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("slug", slug);
      formData.set("message", trimmed);
      formData.set("surface", surface);
      if (voice) formData.set("modality", "voice");
      formData.set("locale", locale);
      if (tableId) formData.set("tableId", tableId);
      const result = await sendAgentMessageAction(undefined, formData);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      if (result) {
        if (result.cart) onCart(result.cart);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId.current++,
            role: "assistant",
            text: result.reply,
            at: Date.now(),
            handledBy: result.handledBy,
            cart: result.cart,
            productIds: result.productIds,
            serverId: result.messageId,
            placedOrder: result.placedOrder,
          },
        ]);
      }
    });
  };

  /** The customer left: the next visit starts from the greeting. */
  const reset = () => {
    setMessages([]);
    setError(null);
  };

  return { messages, error, pending, send, reset };
}

export type AgentChat = ReturnType<typeof useAgentChat>;
