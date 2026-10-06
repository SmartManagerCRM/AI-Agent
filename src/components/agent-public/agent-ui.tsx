"use client";

import { createContext, useContext } from "react";
import { useAgentT } from "./agent-i18n";

import type { PaymentMethod } from "@/server/commerce/cart";
import type { Locale } from "@/i18n/locales";

import {
  categoryIcon,
  toneFor,
  type AgentBusinessInfo,
  type AgentCategory,
  type AgentProduct,
  type AgentService,
  type FulfillmentType,
  type LocalizedText,
} from "./agent-model";
import { MinusIcon, PlusIcon, TrashIcon } from "./icons";
import type { AgentChat } from "./use-agent-chat";
import type { AgentCommerce } from "./use-agent-commerce";
import type { VoiceGender } from "./voice";

export type Screen = "home" | "browse" | "book" | "cart" | "checkout" | "done";

/** What the conversation's voice exposes to the rest of the Agent (registered by the chat, which owns the mic). */
export type VoiceBridge = { start: () => void; stop: () => void };

export type AgentUi = {
  slug: string;
  surface: "external_agent" | "website_widget";
  locale: Locale;
  fallbackLocale: string;
  languages: Locale[];
  currency: string;
  currencyExponent: number;
  businessName: string;
  businessTypeKey: string;
  aiName: string;
  about: string | null;
  greeting: string | null;
  /** The business's photo behind the whole Agent, if it set one. */
  backgroundUrl: string | null;
  /** The business's own logo, if it uploaded one. */
  logoUrl: string | null;
  voiceGender: VoiceGender;
  /** The platform's premium voice speaks for this Agent (device voice only as a fallback). */
  premiumVoice: boolean;
  categories: AgentCategory[];
  products: AgentProduct[];
  services: AgentService[];
  /** Today's date where the business is (YYYY-MM-DD): the first day a customer can book. */
  bookingToday: string;
  popularIds: string[];
  info: AgentBusinessInfo;
  activeTable: { id: string; label: string } | null;
  orderingEnabled: boolean;
  fulfillmentTypes: FulfillmentType[];
  paymentMethods: PaymentMethod[];
  commerce: AgentCommerce;
  chat: AgentChat;
  cartCount: number;
  screen: Screen;
  money: (minor: number) => string;
  text: (value: LocalizedText | null | undefined) => string;
  go: (screen: Screen, options?: { categoryId?: string | null; serviceId?: string | null }) => void;
  back: () => void;
  openChat: (message?: string) => void;
  /** The customer leaves the conversation: voice stops, the chat closes (the widget, or the page when the browser allows). */
  leave: () => void;
  /** Opens the conversation and starts listening (the landing page's mic). */
  listen: () => void;
  /** The chat registers its mic here (null when it unmounts) so `listen` can start it. */
  registerVoice: (bridge: VoiceBridge | null) => void;
  openProduct: (product: AgentProduct) => void;
};

const AgentUiContext = createContext<AgentUi | null>(null);
export const AgentUiProvider = AgentUiContext.Provider;

export function useAgentUi(): AgentUi {
  const value = useContext(AgentUiContext);
  if (!value) throw new Error("useAgentUi must be used inside AgentUiProvider");
  return value;
}

/** Shared focus ring for every interactive element in the Agent. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-400 focus-visible:ring-offset-2";

/**
 * The product/service "image". No image field exists in the catalog, and
 * the Agent never fabricates product photography — so the visual is the
 * product's category icon (or its initial) on a soft tone shared by its
 * category.
 */
export function ProductVisual({
  product,
  className = "",
  iconClassName = "text-4xl",
}: {
  product: AgentProduct;
  className?: string;
  iconClassName?: string;
}) {
  const { categories, text } = useAgentUi();
  const category = categories.find((c) => c.id === product.categoryId) ?? null;
  const icon = categoryIcon(category?.name);
  const name = text(product.name);
  if (product.imageUrl) {
    return (
      <div className={`relative overflow-hidden bg-slate-100 ${className}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- our own storage bucket; already resized WebP */}
        <img src={product.imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br ${toneFor(product.categoryId ?? product.id)} ${className}`}
      aria-hidden="true"
    >
      <span className="absolute -end-6 -top-6 h-20 w-20 rounded-full bg-white/40" />
      <span className="absolute -bottom-8 -start-4 h-24 w-24 rounded-full bg-white/30" />
      <span className="relative flex aspect-square h-[62%] max-h-36 items-center justify-center rounded-full bg-white/75 shadow-[inset_0_-6px_12px_rgba(15,23,42,0.06),0_10px_24px_-12px_rgba(15,23,42,0.35)] ring-1 ring-white">
        {icon ? (
          <span className={`drop-shadow-sm ${iconClassName}`}>{icon}</span>
        ) : (
          <span className={`font-bold text-slate-700/70 ${iconClassName}`}>{name.charAt(0).toUpperCase() || "•"}</span>
        )}
      </span>
    </div>
  );
}

export function PopularBadge() {
  const t = useAgentT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700 ring-1 ring-orange-100">
      🔥 {t("popular")}
    </span>
  );
}

export function QuantityStepper({
  quantity,
  onChange,
  label,
  disabled,
  size = "md",
  allowRemove = false,
}: {
  quantity: number;
  onChange: (next: number) => void;
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
  allowRemove?: boolean;
}) {
  const t = useAgentT();
  const button = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const showTrash = allowRemove && quantity === 1;
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-agent-50 p-1 ring-1 ring-agent-100">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(quantity - 1)}
        aria-label={showTrash ? t("cart.remove", { name: label }) : t("cart.decrease", { name: label })}
        className={`${button} ${focusRing} flex items-center justify-center rounded-full bg-white text-agent-800 shadow-sm transition active:scale-95 disabled:opacity-50`}
      >
        {showTrash ? <TrashIcon size={16} /> : <MinusIcon size={16} />}
      </button>
      <span className="min-w-7 text-center text-sm font-semibold text-slate-900 tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        disabled={disabled || quantity >= 99}
        onClick={() => onChange(quantity + 1)}
        aria-label={t("cart.increase", { name: label })}
        className={`${button} ${focusRing} flex items-center justify-center rounded-full bg-agent-700 text-white shadow-sm transition active:scale-95 disabled:opacity-50`}
      >
        <PlusIcon size={16} />
      </button>
    </div>
  );
}

/**
 * One product card, three densities: `grid` (browse), `rail` (home
 * carousels) and `chat` (under an AI message). Everything shown is a real
 * catalog field; the add button calls the real add-to-cart action, and a
 * product already in the cart shows its real server-side quantity.
 */
export function ProductCard({ product, variant = "grid" }: { product: AgentProduct; variant?: "grid" | "rail" | "chat" }) {
  const t = useAgentT();
  const { text, money, commerce, orderingEnabled, openProduct, popularIds } = useAgentUi();
  const name = text(product.name);
  const description = text(product.description);
  const inCart = commerce.cart?.items.find((i) => i.productId === product.id);
  const isPopular = popularIds.includes(product.id);
  const width = variant === "grid" ? "w-full" : variant === "rail" ? "w-44 shrink-0 lg:w-auto" : "w-40 shrink-0";

  return (
    <article
      className={`${width} group flex snap-start flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_24px_-12px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_16px_32px_-16px_rgba(15,23,42,0.28)]`}
    >
      <button
        type="button"
        onClick={() => openProduct(product)}
        className={`${focusRing} flex flex-1 flex-col text-start`}
        aria-label={t("product.viewDetails", { name })}
      >
        <div className="relative">
          <ProductVisual
            product={product}
            className={variant === "chat" ? "h-24" : "aspect-[4/3] w-full"}
            iconClassName={variant === "chat" ? "text-4xl" : "text-5xl"}
          />
          {isPopular && (
            <span className="absolute start-2 top-2">
              <PopularBadge />
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 px-3 pt-2.5">
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-slate-900">{name}</h3>
          {description && <p className="line-clamp-2 text-xs leading-snug text-slate-500">{description}</p>}
          <p className="mt-auto pt-1 text-[15px] font-bold text-slate-900 tabular-nums">{money(product.priceMinor)}</p>
        </div>
      </button>
      {orderingEnabled && (
        <div className="px-3 pt-2 pb-3">
          {inCart ? (
            <QuantityStepper
              size="sm"
              allowRemove
              quantity={inCart.quantity}
              label={name}
              disabled={commerce.pending}
              onChange={(q) => commerce.changeQuantity(product.id, q)}
            />
          ) : (
            <button
              type="button"
              disabled={commerce.pending}
              onClick={() => commerce.addToCart(product)}
              className={`${focusRing} flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-agent-700 text-xs font-semibold text-white shadow-sm transition hover:bg-agent-800 active:scale-[0.97] disabled:opacity-60`}
              aria-label={t("product.addNamed", { name })}
            >
              <PlusIcon size={15} />
              {t("product.add")}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) {
  // On the business's own photo (landing page) the headings are light, like the hero above them.
  const onPhoto = !!useAgentUi().backgroundUrl;
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className={`text-lg font-bold tracking-tight ${onPhoto ? "text-white drop-shadow" : "text-slate-900"}`}>{title}</h2>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={`${focusRing} shrink-0 rounded-full px-2 py-1 text-sm font-semibold ${
            onPhoto ? "bg-white/15 text-white backdrop-blur hover:bg-white/25" : "text-agent-700 hover:bg-agent-50"
          }`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

