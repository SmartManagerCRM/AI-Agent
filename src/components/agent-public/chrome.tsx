"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAgentT } from "./agent-i18n";

import { LOCALE_COOKIE, LOCALE_NATIVE_NAMES, type Locale } from "@/i18n/locales";

import { focusRing, useAgentUi, type Screen } from "./agent-ui";
import { AgentAvatar } from "./agent-avatar";
import { BackIcon, CartIcon, ChatIcon, ChevronDownIcon, GlobeIcon, GridIcon, HomeIcon, PhoneIcon } from "./icons";

function switchLocale(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

/**
 * Switches the Agent's interface language among the languages this
 * business enabled. It only sets the same `NEXT_LOCALE` cookie the agent
 * host already negotiates from (src/proxy.ts) and reloads, so `<html
 * lang dir>` is rendered correctly for the new language.
 */
export function LanguageSwitcher({ tone = "light" }: { tone?: "light" | "dark" }) {
  const t = useAgentT();
  const { locale, languages } = useAgentUi();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (languages.length < 2) return null;

  const choose = (next: Locale) => {
    setOpen(false);
    if (next === locale) return;
    switchLocale(next);
  };

  const trigger =
    tone === "dark"
      ? "bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("language.label")}
        onClick={() => setOpen((v) => !v)}
        className={`${focusRing} flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold uppercase backdrop-blur transition ${trigger}`}
      >
        <GlobeIcon size={16} />
        {locale}
        <ChevronDownIcon size={14} />
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          className="motion-safe:animate-agent-fade absolute end-0 top-12 z-50 min-w-40 overflow-hidden rounded-2xl bg-white py-1 text-sm text-slate-800 shadow-xl ring-1 ring-slate-900/10"
        >
          {languages.map((l) => (
            <li key={l} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={l === locale}
                lang={l}
                onClick={() => choose(l)}
                className={`${focusRing} flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start hover:bg-agent-50 ${l === locale ? "font-semibold text-agent-800" : ""}`}
              >
                {LOCALE_NATIVE_NAMES[l]}
                <span className="text-xs uppercase text-slate-400">{l}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CartButton({ tone = "light" }: { tone?: "light" | "dark" }) {
  const t = useAgentT();
  const { cartCount, go, orderingEnabled } = useAgentUi();
  if (!orderingEnabled) return null;
  const style =
    tone === "dark"
      ? "bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15"
      : "bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50";
  return (
    <button
      type="button"
      onClick={() => go("cart")}
      aria-label={t("cart.openWithCount", { count: cartCount })}
      className={`${focusRing} relative flex h-10 w-10 items-center justify-center rounded-full backdrop-blur transition ${style}`}
    >
      <CartIcon size={20} />
      {cartCount > 0 && (
        <span
          key={cartCount}
          className="motion-safe:animate-agent-pop absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-agent-400 px-1 text-[11px] font-bold text-agent-950 ring-2 ring-white"
        >
          {cartCount}
        </span>
      )}
    </button>
  );
}

/** Business identity mark: no logo field exists, so the business's own initial on the brand surface. */
export function BusinessMark({ size = 40, tone = "dark" }: { size?: number; tone?: "light" | "dark" }) {
  const { businessName } = useAgentUi();
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-2xl font-extrabold ${
        tone === "dark" ? "bg-white/12 text-white ring-1 ring-white/25" : "bg-agent-800 text-white"
      }`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {businessName.charAt(0).toUpperCase()}
    </span>
  );
}

/** Header for every screen below Home: back, title, cart. */
export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const t = useAgentT();
  const { back } = useAgentUi();
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-900/5 bg-white/85 px-4 py-3 backdrop-blur-md lg:rounded-t-[2rem] lg:px-6">
      <button
        type="button"
        onClick={back}
        aria-label={t("nav.back")}
        className={`${focusRing} flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-800 hover:bg-slate-200`}
      >
        <BackIcon size={20} className="rtl:-scale-x-100" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
      </div>
      <LanguageSwitcher />
      <CartButton />
    </header>
  );
}

type NavItem = { key: string; label: string; icon: React.ReactNode; active: boolean; onClick: () => void; badge?: number };

/**
 * Mobile bottom navigation. Only capabilities this business actually has
 * appear: Browse only with an orderable catalog, Cart only with ordering
 * enabled, Contact only with real contact details.
 */
export function BottomNav({ screen, chatOpen, onContact }: { screen: Screen; chatOpen: boolean; onContact: (() => void) | null }) {
  const t = useAgentT();
  const { go, openChat, orderingEnabled, categories, products, cartCount, aiName } = useAgentUi();
  const items: NavItem[] = [
    { key: "home", label: t("nav.home"), icon: <HomeIcon size={22} />, active: !chatOpen && screen === "home", onClick: () => go("home") },
  ];
  if (orderingEnabled && (categories.length > 0 || products.length > 0)) {
    items.push({ key: "browse", label: t("nav.browse"), icon: <GridIcon size={22} />, active: !chatOpen && screen === "browse", onClick: () => go("browse") });
  }
  items.push({
    key: "chat",
    label: t("nav.ask"),
    icon: <ChatIcon size={22} />,
    active: chatOpen,
    onClick: () => openChat(),
  });
  if (orderingEnabled) {
    items.push({
      key: "cart",
      label: t("nav.cart"),
      icon: <CartIcon size={22} />,
      active: !chatOpen && (screen === "cart" || screen === "checkout"),
      onClick: () => go("cart"),
      badge: cartCount,
    });
  }
  if (onContact) {
    items.push({ key: "contact", label: t("nav.contact"), icon: <PhoneIcon size={21} />, active: false, onClick: onContact });
  }

  return (
    <nav
      aria-label={t("nav.label")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-900/5 bg-white/92 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-16px_rgba(15,23,42,0.25)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-around px-2">
        {items.map((item) => (
          <li key={item.key} className="flex-1">
            <button
              type="button"
              onClick={item.onClick}
              aria-current={item.active ? "page" : undefined}
              aria-label={item.key === "chat" ? t("nav.askNamed", { name: aiName }) : undefined}
              className={`${focusRing} relative flex w-full flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-medium transition ${
                item.active ? "text-agent-700" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {item.key === "chat" ? (
                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${item.active ? "ring-2 ring-agent-400" : ""}`}>
                  <AgentAvatar size={26} />
                </span>
              ) : (
                <span className="flex h-7 items-center">{item.icon}</span>
              )}
              {item.label}
              {!!item.badge && (
                <span className="absolute end-[calc(50%-1.4rem)] top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-agent-500 px-1 text-[10px] font-bold text-white">
                  {item.badge}
                </span>
              )}
              {item.active && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-agent-500" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
