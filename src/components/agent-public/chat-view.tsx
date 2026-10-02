"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentT } from "./agent-i18n";

import type { CartView } from "@/server/commerce/cart";

import { categoryIcon, findMentionedProducts } from "./agent-model";
import { focusRing, ProductCard, useAgentUi } from "./agent-ui";
import { AgentAvatar } from "./agent-avatar";
import { CartButton } from "./chrome";
import { BackIcon, CartIcon, CheckIcon, MicIcon, SendIcon, SpeakerIcon, StopIcon } from "./icons";
import type { ChatMessage } from "./use-agent-chat";
import { useVoice } from "./use-voice";

/** Renders assistant text with bare URLs (e.g. a payment link from `place_order`) as clickable links. */
function renderWithLinks(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="font-semibold break-all text-agent-700 underline underline-offset-2">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function useTimeFormat() {
  const { locale } = useAgentUi();
  return (at: number) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at);
}

type Suggestion = { key: string; label: string; message: string };

/**
 * The conversation surface. Replies come only from the existing
 * `sendAgentMessageAction`; this component adds presentation: the AI
 * identity, bubbles, real product cards for catalog items the reply names
 * (`findMentionedProducts`), the real cart the AI's tools returned, and
 * quick replies that are either plain messages the customer could have
 * typed or pure navigation (view cart / checkout) — never a fabricated
 * answer.
 */
export function ChatView({ onClose, focusToken }: { onClose: () => void; focusToken: number }) {
  const t = useAgentT();
  const ui = useAgentUi();
  const { chat, aiName, businessName, greeting, products, categories, services, orderingEnabled, fulfillmentTypes, text } = ui;
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const formatTime = useTimeFormat();
  const hasCatalog = products.length > 0;

  // Speaking is typing by voice: the browser transcribes, the transcript is sent like any message.
  const onInterim = useCallback((heard: string) => setDraft(heard), []);
  const onFinal = useCallback(
    (heard: string) => {
      setDraft("");
      chat.send(heard, { voice: true });
    },
    [chat],
  );
  const voice = useVoice({ locale: ui.locale, onInterim, onFinal });
  const { speak } = voice;

  // A spoken question gets a spoken answer (read by the browser — no AI cost).
  const spokenReplies = useRef(new Set<number>());
  const last = chat.messages[chat.messages.length - 1];
  const previous = chat.messages[chat.messages.length - 2];
  useEffect(() => {
    if (!last || last.role !== "assistant" || !previous?.voice || spokenReplies.current.has(last.id)) return;
    spokenReplies.current.add(last.id);
    speak(last.id, last.text);
  }, [last, previous, speak]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.messages.length, chat.pending]);

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  const suggestions: Suggestion[] = [];
  if (hasCatalog) {
    suggestions.push({ key: "recommend", label: `✨\uFE0F ${t("prompts.recommendLabel")}`, message: t("prompts.recommend") });
    for (const c of categories.filter((c) => products.some((p) => p.categoryId === c.id)).slice(0, 2)) {
      const name = text(c.name);
      suggestions.push({ key: c.id, label: `${categoryIcon(c.name) ?? "•"} ${name}`, message: t("prompts.category", { category: name }) });
    }
  }
  if (services.length > 0) suggestions.push({ key: "book", label: `📅 ${t("prompts.bookLabel")}`, message: t("prompts.book") });
  if (!orderingEnabled && services.length === 0) suggestions.push({ key: "quote", label: `📝 ${t("prompts.quoteLabel")}`, message: t("prompts.quote") });
  // Only when hours are configured — otherwise the deterministic reply can't answer and it would cost an AI call.
  if (ui.info.todayHours !== null) suggestions.push({ key: "hours", label: `🕒 ${t("prompts.hoursLabel")}`, message: t("prompts.hours") });
  if (orderingEnabled && fulfillmentTypes.includes("delivery")) {
    suggestions.push({ key: "delivery", label: `🚚 ${t("prompts.deliveryLabel")}`, message: t("prompts.delivery") });
  }

  const submit = () => {
    if (!draft.trim() || chat.pending || voice.listening) return;
    voice.stopSpeaking();
    chat.send(draft);
    setDraft("");
  };

  const cartCount = ui.cartCount;

  return (
    <div className="flex h-full min-h-0 flex-col bg-agent-cream">
      <header className="relative flex items-center gap-3 bg-gradient-to-br from-agent-950 via-agent-900 to-agent-800 px-3 py-3 text-white sm:px-4 lg:rounded-t-[2rem]">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("nav.back")}
          className={`${focusRing} flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/15 lg:hidden`}
        >
          <BackIcon size={20} className="rtl:-scale-x-100" />
        </button>
        <AgentAvatar size={42} online />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base leading-tight font-bold">{aiName}</h2>
          <p className="truncate text-xs text-agent-200">
            <span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-agent-400 align-middle" aria-hidden="true" />
            {t("chat.online")} · {businessName}
          </p>
        </div>
        <CartButton tone="dark" />
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 [background-image:radial-gradient(rgba(11,79,63,0.05)_1px,transparent_1px)] [background-size:16px_16px]"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t("chat.logLabel", { name: aiName })}
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <AssistantRow>
            <Bubble>
              <p>
                {t("home.hi")} 👋 {t("chat.intro", { name: aiName })}
              </p>
              <p dir="auto" className="mt-1">
                {greeting || t("chat.defaultGreeting")}
              </p>
            </Bubble>
          </AssistantRow>

          {chat.messages.length === 0 && (
            <div className="flex flex-wrap gap-2 ps-11" aria-label={t("chat.suggestions")}>
              {suggestions.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  disabled={chat.pending}
                  onClick={() => chat.send(s.message)}
                  className={`${focusRing} motion-safe:animate-agent-rise rounded-full bg-white px-3.5 py-2 text-[13px] font-medium text-slate-800 shadow-sm ring-1 ring-slate-900/10 transition hover:bg-agent-50 hover:ring-agent-300 active:scale-[0.97]`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {chat.messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              time={formatTime(m.at)}
              listen={
                voice.canSpeak && m.role === "assistant"
                  ? {
                      speaking: voice.speakingId === m.id,
                      toggle: () => (voice.speakingId === m.id ? voice.stopSpeaking() : voice.speak(m.id, m.text)),
                    }
                  : undefined
              }
            />
          ))}

          {chat.pending && (
            <AssistantRow>
              <div className="flex h-10 items-center gap-1 rounded-3xl rounded-ss-md bg-white px-4 shadow-sm ring-1 ring-slate-900/5" aria-label={t("chat.typing", { name: aiName })} role="status">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-2 w-2 rounded-full bg-agent-600 motion-safe:animate-agent-dot" style={{ animationDelay: `${i * 160}ms` }} />
                ))}
              </div>
            </AssistantRow>
          )}

          {chat.error && (
            <p role="alert" className="ms-11 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-100">
              {chat.error}
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {orderingEnabled && cartCount > 0 && chat.messages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-slate-900/5 bg-agent-cream px-3 pt-2.5 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => ui.go("cart")} className={`${focusRing} flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-agent-800 shadow-sm ring-1 ring-agent-200`}>
            <CartIcon size={15} /> {t("chat.viewCart", { count: cartCount })}
          </button>
          <button type="button" onClick={() => ui.go("checkout")} className={`${focusRing} flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-agent-700 px-3.5 text-[13px] font-semibold text-white shadow-sm`}>
            {t("cart.checkout")}
          </button>
        </div>
      )}

      {(voice.listening || voice.errorKey) && (
        <p
          role="status"
          className={`bg-agent-cream px-4 pt-2 text-center text-xs ${voice.errorKey ? "text-red-700" : "text-agent-800"}`}
          data-testid="voice-status"
        >
          {voice.errorKey ? t(voice.errorKey) : t("voice.listening")}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 bg-agent-cream px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 lg:rounded-b-[2rem]"
      >
        <label htmlFor="agent-chat-input" className="sr-only">
          {t("chat.inputLabel")}
        </label>
        <input
          ref={inputRef}
          id="agent-chat-input"
          name="message"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (voice.errorKey) voice.clearError();
          }}
          readOnly={voice.listening}
          maxLength={1000}
          autoComplete="off"
          placeholder={voice.listening ? t("voice.listening") : t("chat.placeholder", { name: aiName })}
          className="h-12 min-w-0 flex-1 rounded-full bg-white px-5 text-[15px] text-slate-900 shadow-sm ring-1 ring-slate-900/10 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-agent-400"
        />
        {voice.canListen && (
          <button
            type="button"
            onClick={voice.listening ? voice.stop : voice.start}
            disabled={chat.pending && !voice.listening}
            aria-label={voice.listening ? t("voice.stop") : t("voice.speak")}
            aria-pressed={voice.listening}
            data-testid="voice-mic"
            className={`${focusRing} relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 transition active:scale-95 disabled:opacity-50 ${
              voice.listening ? "bg-red-600 text-white ring-red-600" : "bg-white text-agent-800 ring-slate-900/10 hover:bg-agent-50"
            }`}
          >
            {voice.listening && <span className="absolute inset-0 rounded-full bg-red-500/40 motion-safe:animate-ping" aria-hidden="true" />}
            {voice.listening ? <StopIcon size={18} className="relative" /> : <MicIcon size={21} />}
          </button>
        )}
        <button
          type="submit"
          disabled={chat.pending || !draft.trim() || voice.listening}
          aria-label={t("chat.send")}
          className={`${focusRing} flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-agent-700 text-white shadow-lg shadow-agent-900/25 transition hover:bg-agent-800 active:scale-95 disabled:bg-agent-700/50 disabled:shadow-none`}
        >
          <SendIcon size={20} className="rtl:-scale-x-100" />
        </button>
      </form>
    </div>
  );
}

function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="motion-safe:animate-agent-rise flex items-start gap-2">
      <AgentAvatar size={36} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">{children}</div>
    </div>
  );
}

function Bubble({ children, time }: { children: React.ReactNode; time?: string }) {
  return (
    <div className="max-w-[88%] rounded-3xl rounded-ss-md bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-800 shadow-sm ring-1 ring-slate-900/5 sm:max-w-[80%]">
      <div dir="auto" className="whitespace-pre-line">{children}</div>
      {time && <p className="mt-1 text-end text-[11px] text-slate-400 tabular-nums">{time}</p>}
    </div>
  );
}

function Message({
  message,
  time,
  listen,
}: {
  message: ChatMessage;
  time: string;
  /** Read this reply aloud (the browser's own voice), or stop reading it. */
  listen?: { speaking: boolean; toggle: () => void };
}) {
  const t = useAgentT();
  const { products } = useAgentUi();

  if (message.role === "user") {
    return (
      <div className="motion-safe:animate-agent-rise flex justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-ee-md bg-agent-700 px-4 py-3 text-[15px] leading-relaxed text-white shadow-md shadow-agent-900/15 sm:max-w-[75%]">
          <p dir="auto" className="whitespace-pre-line">
            {message.text}
          </p>
          <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-agent-100/80 tabular-nums">
            {message.voice && <MicIcon size={12} strokeWidth={2.2} aria-label={t("voice.spoken")} />}
            {time}
            <CheckIcon size={13} strokeWidth={2.4} aria-label={t("chat.sent")} />
          </p>
        </div>
      </div>
    );
  }

  // The server's own product ids when it sent them (catalog answers); otherwise products the reply names.
  const mentioned = message.productIds
    ? message.productIds.map((id) => products.find((p) => p.id === id)).filter((p) => p !== undefined)
    : findMentionedProducts(message.text, products);
  return (
    <AssistantRow>
      <Bubble time={time}>{renderWithLinks(message.text)}</Bubble>
      {listen && (
        <button
          type="button"
          onClick={listen.toggle}
          aria-pressed={listen.speaking}
          data-testid="voice-listen"
          className={`${focusRing} -mt-1 flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${
            listen.speaking ? "bg-agent-700 text-white" : "bg-white/70 text-agent-800 ring-1 ring-agent-200 hover:bg-white"
          }`}
        >
          {listen.speaking ? <StopIcon size={12} /> : <SpeakerIcon size={14} />}
          {listen.speaking ? t("voice.stopReading") : t("voice.listen")}
        </button>
      )}
      {mentioned.length > 0 && (
        <div className="-me-3 flex w-[calc(100%+0.75rem)] snap-x gap-3 overflow-x-auto pe-3 pb-2 [scrollbar-width:none] sm:-me-4 [&::-webkit-scrollbar]:hidden">
          {mentioned.map((p) => (
            <ProductCard key={p.id} product={p} variant="chat" />
          ))}
        </div>
      )}
      {message.cart && <CartSnapshot cart={message.cart} />}
    </AssistantRow>
  );
}

/** The real cart the AI's own tools returned this turn — never plain text for a cart change. */
function CartSnapshot({ cart }: { cart: CartView }) {
  const t = useAgentT();
  const { money, go, products, text } = useAgentUi();
  return (
    <div className="w-full max-w-xs rounded-2xl bg-white p-3 text-sm shadow-sm ring-1 ring-agent-200">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-agent-800 uppercase">
        <CartIcon size={14} /> {t("chat.cartUpdated")}
      </p>
      {cart.items.length === 0 ? (
        <p className="text-slate-500">{t("cart.emptyTitle")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {cart.items.map((item) => {
              const product = products.find((p) => p.id === item.productId);
              return (
                <li key={item.productId} className="flex justify-between gap-3 text-slate-700">
                  <span className="min-w-0 truncate">
                    {item.quantity} × {product ? text(product.name) : item.name}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{money(item.totalMinor)}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 font-semibold text-slate-900">
            <span>{t("cart.subtotal")}</span>
            <span className="tabular-nums">{money(cart.subtotalMinor)}</span>
          </div>
          <button type="button" onClick={() => go("cart")} className={`${focusRing} mt-2.5 h-9 w-full rounded-full bg-agent-700 text-xs font-semibold text-white hover:bg-agent-800`}>
            {t("chat.viewCart", { count: cart.items.reduce((n, i) => n + i.quantity, 0) })}
          </button>
        </>
      )}
    </div>
  );
}
