"use client";

import { useRef, useState, useTransition } from "react";

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
  onCart,
}: {
  slug: string;
  surface: "external_agent" | "website_widget";
  tableId: string | null;
  onCart: (cart: CartView | null) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextId = useRef(1);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text: trimmed, at: Date.now() }]);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("slug", slug);
      formData.set("message", trimmed);
      formData.set("surface", surface);
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
          },
        ]);
      }
    });
  };

  return { messages, error, pending, send };
}

export type AgentChat = ReturnType<typeof useAgentChat>;
