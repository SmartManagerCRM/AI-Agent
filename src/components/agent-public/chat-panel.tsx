"use client";

import { useRef, useState, useTransition } from "react";

import { sendAgentMessageAction } from "@/server/agent-public/actions";
import type { CartView } from "@/server/commerce/cart";
import { AgentAvatar } from "./agent-avatar";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  handledBy?: "deterministic" | "ai";
  cart?: CartView | null;
};

/** Renders assistant text with bare URLs (e.g. a payment link from `place_order`) as clickable links. */
function renderWithLinks(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function formatMinor(minor: number, exponent: number): string {
  return (minor / 10 ** exponent).toFixed(exponent);
}

type Props = {
  slug: string;
  greeting: string | null;
  suggestions: string[];
  businessName: string;
  assistantName: string | null;
  currency: string;
  currencyExponent: number;
  surface?: "external_agent" | "website_widget";
};

/** A compact, real cart snapshot rendered inline in the conversation — spec §32's "AI + UI hybrid responses", never plain text for a cart change. */
function CartCard({
  cart,
  currency,
  currencyExponent,
}: {
  cart: CartView;
  currency: string;
  currencyExponent: number;
}) {
  if (cart.items.length === 0) {
    return (
      <div className="mt-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
        Cart is empty.
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-col gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
      {cart.items.map((item) => (
        <div key={item.productId} className="flex items-center justify-between gap-3 text-slate-700">
          <span>
            {item.quantity} × {item.name}
          </span>
          <span className="font-medium">
            {formatMinor(item.totalMinor, currencyExponent)} {currency}
          </span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900">
        <span>Subtotal</span>
        <span>
          {formatMinor(cart.subtotalMinor, currencyExponent)} {currency}
        </span>
      </div>
    </div>
  );
}

export function ChatPanel({
  slug,
  greeting,
  suggestions,
  businessName,
  assistantName,
  currency,
  currencyExponent,
  surface = "external_agent",
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(greeting ? [{ role: "assistant", text: greeting }] : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const aiName = assistantName || `${businessName} AI`;

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("slug", slug);
      formData.set("message", trimmed);
      formData.set("surface", surface);
      const result = await sendAgentMessageAction(undefined, formData);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      if (result) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: result.reply, handledBy: result.handledBy, cart: result.cart },
        ]);
      }
    });
  };

  return (
    <div className="flex h-[30rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <AgentAvatar businessName={businessName} size={28} />
        <p className="text-sm font-semibold text-slate-800">{aiName}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-sm text-slate-400">Ask anything — products, prices, hours, delivery, and more.</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              {m.role === "assistant" && <AgentAvatar businessName={businessName} size={26} className="mt-0.5" />}
              <div className={m.role === "user" ? "max-w-[80%] text-end" : "max-w-[80%]"}>
                <p
                  className={
                    m.role === "user"
                      ? "inline-block rounded-2xl bg-slate-900 px-3 py-2 text-sm text-white"
                      : "inline-block rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-900"
                  }
                >
                  {m.role === "assistant" ? renderWithLinks(m.text) : m.text}
                </p>
                {m.cart && <CartCard cart={m.cart} currency={currency} currencyExponent={currencyExponent} />}
              </div>
            </div>
          ))}
          {pending && (
            <div className="flex items-center gap-2">
              <AgentAvatar businessName={businessName} size={26} />
              <p className="text-sm text-slate-400">Typing…</p>
            </div>
          )}
        </div>
      </div>

      {messages.length === 0 && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="border-t border-slate-100 px-4 py-2 text-xs text-red-600">{error}</p>}

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const input = formRef.current?.elements.namedItem("message") as HTMLInputElement | null;
          if (input) {
            send(input.value);
            input.value = "";
          }
        }}
        className="flex gap-2 border-t border-slate-200 p-3"
      >
        <input
          name="message"
          placeholder={`Ask ${aiName} anything...`}
          disabled={pending}
          className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
