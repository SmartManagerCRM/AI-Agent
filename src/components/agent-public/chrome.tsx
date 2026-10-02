"use client";

import { useAgentT } from "./agent-i18n";

import { LOCALE_COOKIE, LOCALE_NATIVE_NAMES, type Locale } from "@/i18n/locales";

import { focusRing, useAgentUi, type Screen } from "./agent-ui";
import { AgentAvatar } from "./agent-avatar";
import { BackIcon, CartIcon, ChatIcon, GridIcon, HomeIcon, PhoneIcon } from "./icons";

function switchLocale(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  // On a locale-prefixed Agent URL (/ar/agent/<slug>) the path would outrank the cookie:
  // go to the canonical, prefix-free URL instead of reloading.
  const { pathname, search, hash } = window.location;
  const canonical = pathname.replace(/^\/(?:en|ar|fr)(?=\/agent\/)/, "");
  if (canonical !== pathname) window.location.assign(new URL(`${canonical}${search}${hash}`, window.location.origin).href);
  else window.location.reload();
}

/** Language codes as letters (never flags: a language isn't a country). */
const LANGUAGE_LETTERS: Record<Locale, string> = { en: "EN", ar: "AR", fr: "FR" };

/**
 * The Agent's language bar: every language the Agent speaks, as letters,
 * next to the cart. Picking one only sets the same `NEXT_LOCALE` cookie the
 * agent host already negotiates from (src/proxy.ts) and reloads, so `<html
 * lang dir>` is rendered correctly; the conversation then replies in it.
 */
export function LanguageSwitcher({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  const t = useAgentT();
  const { locale, languages } = useAgentUi();
  if (languages.length < 2) return null;

  const track = tone === "dark" ? "bg-white/10 ring-1 ring-white/20" : "bg-white ring-1 ring-slate-200";
  const idle = tone === "dark" ? "text-white/80 hover:bg-white/15 hover:text-white" : "text-slate-600 hover:bg-slate-100";
  const active = tone === "dark" ? "bg-white text-agent-900 shadow-sm" : "bg-agent-700 text-white shadow-sm";

  return (
    <div role="group" aria-label={t("language.label")} className={`flex h-10 shrink-0 items-center gap-0.5 rounded-full p-1 backdrop-blur ${track} ${className}`} data-testid="language-bar">
      {languages.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          title={LOCALE_NATIVE_NAMES[l]}
          aria-label={LOCALE_NATIVE_NAMES[l]}
          aria-pressed={l === locale}
          onClick={() => l !== locale && switchLocale(l)}
          className={`${focusRing} flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tracking-wide transition ${l === locale ? active : idle}`}
        >
          {LANGUAGE_LETTERS[l]}
        </button>
      ))}
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
  const { go, openChat, orderingEnabled, products, cartCount, aiName } = useAgentUi();
  const items: NavItem[] = [
    { key: "home", label: t("nav.home"), icon: <HomeIcon size={22} />, active: !chatOpen && screen === "home", onClick: () => go("home") },
  ];
  // Browsing the catalog doesn't need online ordering — only the cart does.
  if (products.length > 0) {
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
