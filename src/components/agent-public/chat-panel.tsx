"use client";

import { useRef, useState, useTransition } from "react";

import { sendAgentMessageAction } from "@/server/agent-public/actions";

type ChatMessage = { role: "user" | "assistant"; text: string; handledBy?: "deterministic" | "ai" };

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

type Props = { slug: string; greeting: string | null; suggestions: string[] };

export function ChatPanel({ slug, greeting, suggestions }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    greeting ? [{ role: "assistant", text: greeting }] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("slug", slug);
      formData.set("message", trimmed);
      const result = await sendAgentMessageAction(undefined, formData);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      if (result) {
        setMessages((prev) => [...prev, { role: "assistant", text: result.reply, handledBy: result.handledBy }]);
      }
    });
  };

  return (
    <div className="flex h-[28rem] flex-col rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-sm text-neutral-400">Ask anything — products, prices, hours, delivery, and more.</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "self-end text-end" : "self-start"}>
              <p
                className={
                  m.role === "user"
                    ? "inline-block rounded-2xl bg-neutral-900 px-3 py-2 text-sm text-white"
                    : "inline-block rounded-2xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900"
                }
              >
                {m.role === "assistant" ? renderWithLinks(m.text) : m.text}
              </p>
            </div>
          ))}
          {pending && <p className="text-sm text-neutral-400">Typing…</p>}
        </div>
      </div>

      {messages.length === 0 && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-neutral-100 px-4 py-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="border-t border-neutral-100 px-4 py-2 text-xs text-red-600">{error}</p>}

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
        className="flex gap-2 border-t border-neutral-200 p-3"
      >
        <input
          name="message"
          placeholder="Ask anything..."
          disabled={pending}
          className="flex-1 rounded-full border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
