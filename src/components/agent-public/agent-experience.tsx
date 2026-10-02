"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAgentT } from "./agent-i18n";

import { formatMoney } from "@/lib/money";
import { localeDirection, type Locale } from "@/i18n/locales";
import type { PaymentMethod } from "@/server/commerce/cart";

import {
  pickText,
  type AgentBusinessInfo,
  type AgentCategory,
  type AgentProduct,
  type AgentService,
  type FulfillmentType,
} from "./agent-model";
import { AgentUiProvider, focusRing, ProductVisual, useAgentUi, type AgentUi, type Screen, type VoiceBridge } from "./agent-ui";
import { BrowseView } from "./browse-view";
import { ChatView } from "./chat-view";
import { BottomNav } from "./chrome";
import { HomeView } from "./home-view";
import { CheckIcon, CloseIcon, PlusIcon } from "./icons";
import { useAgentChat } from "./use-agent-chat";
import { useAgentCommerce } from "./use-agent-commerce";
import type { VoiceGender } from "./voice";

// Screens a customer only reaches after tapping something load on first use, keeping them out of the
// home page's initial JavaScript.
const CartScreen = dynamic(() => import("./cart-views").then((m) => m.CartScreen), { ssr: false });
const CheckoutScreen = dynamic(() => import("./cart-views").then((m) => m.CheckoutScreen), { ssr: false });
const ConfirmationScreen = dynamic(() => import("./cart-views").then((m) => m.ConfirmationScreen), { ssr: false });
const ProductSheet = dynamic(() => import("./product-sheet").then((m) => m.ProductSheet), { ssr: false });

export type AgentExperienceProps = {
  slug: string;
  surface?: "external_agent" | "website_widget";
  locale: Locale;
  fallbackLocale: string;
  languages: Locale[];
  businessName: string;
  businessTypeKey: string;
  assistantName: string | null;
  about: string | null;
  greeting: string | null;
  /** Public URL of the business's background photo (Agent settings), if any. */
  backgroundUrl: string | null;
  /** The Agent's spoken voice, chosen in Agent settings. */
  voiceGender: VoiceGender;
  categories: AgentCategory[];
  products: AgentProduct[];
  services: AgentService[];
  popularProductIds: string[];
  info: AgentBusinessInfo;
  currency: string;
  currencyExponent: number;
  orderingEnabled: boolean;
  fulfillmentTypes: FulfillmentType[];
  paymentMethods: PaymentMethod[];
  activeTable: { id: string; label: string } | null;
};

type NavState = { screen: Screen; chatOpen: boolean; categoryId: string | null };
const HOME: NavState = { screen: "home", chatOpen: false, categoryId: null };
const DONE: NavState = { screen: "done", chatOpen: false, categoryId: null };

/** How many Agent screens deep the current history entry is (0 = the page as first opened). */
function historyDepth(): number {
  const depth = (window.history.state as { depth?: unknown } | null)?.depth;
  return typeof depth === "number" ? depth : 0;
}

/**
 * The Customer Agent: one client shell around the existing deterministic
 * commerce actions (`useAgentCommerce`) and the existing AI conversation
 * action (`useAgentChat`). Screens are client state only — the public URL
 * (`agent.<root>/<slug>`) never changes — with browser Back wired through
 * `history.pushState`. Mobile shows one screen at a time with a bottom
 * nav; desktop keeps the conversation beside the storefront.
 */
export function AgentExperience(props: AgentExperienceProps) {
  const t = useAgentT();
  const surface = props.surface ?? "external_agent";
  const [nav, setNav] = useState<NavState>(HOME);
  const [product, setProduct] = useState<AgentProduct | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const voiceBridge = useRef<VoiceBridge | null>(null);
  const registerVoice = useCallback((bridge: VoiceBridge | null) => {
    voiceBridge.current = bridge;
  }, []);

  const commerce = useAgentCommerce({
    slug: props.slug,
    surface,
    products: props.products,
    popularProductIds: props.popularProductIds,
    activeTableId: props.activeTable?.id ?? null,
  });
  const chat = useAgentChat({ slug: props.slug, surface, tableId: props.activeTable?.id ?? null, locale: props.locale, onCart: commerce.syncCart });

  const navigate = useCallback((next: NavState, replace = false) => {
    setNav((prev) => {
      if (next.screen !== prev.screen || next.categoryId !== prev.categoryId) window.scrollTo({ top: 0 });
      return next;
    });
    try {
      const depth = historyDepth();
      if (replace) window.history.replaceState({ agentNav: next, depth }, "");
      else window.history.pushState({ agentNav: next, depth: depth + 1 }, "");
    } catch {
      // History can be unavailable in some embedded contexts — navigation still works without Back support.
    }
  }, []);

  useEffect(() => {
    try {
      window.history.replaceState({ agentNav: HOME, depth: 0 }, "");
    } catch {}
    const onPop = (e: PopStateEvent) => {
      const state = (e.state ?? {}) as { agentNav?: NavState };
      setProduct(null);
      setNav(state.agentNav ?? HOME);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const back = useCallback(() => {
    if (historyDepth() > 0) window.history.back();
    else navigate(HOME, true);
  }, [navigate]);

  const cartCount = (commerce.cart?.items ?? []).reduce((n, i) => n + i.quantity, 0);
  const { locale, fallbackLocale, currency, currencyExponent } = props;

  const ui: AgentUi = useMemo(
    () => ({
      slug: props.slug,
      surface,
      locale,
      fallbackLocale,
      languages: props.languages,
      currency,
      currencyExponent,
      businessName: props.businessName,
      businessTypeKey: props.businessTypeKey,
      aiName: props.assistantName || t("aiName", { business: props.businessName }),
      about: props.about,
      greeting: props.greeting,
      backgroundUrl: props.backgroundUrl,
      voiceGender: props.voiceGender,
      categories: props.categories,
      products: props.products,
      services: props.services,
      popularIds: props.popularProductIds,
      info: props.info,
      activeTable: props.activeTable,
      orderingEnabled: props.orderingEnabled,
      fulfillmentTypes: props.fulfillmentTypes,
      paymentMethods: props.paymentMethods,
      commerce: { ...commerce, placeOrder: (details) => commerce.placeOrder(details, () => navigate(DONE)) },
      chat,
      cartCount,
      screen: nav.screen,
      money: (minor) => formatMoney(minor, currency, currencyExponent, locale),
      text: (value) => pickText(value, locale, fallbackLocale),
      go: (screen, options) =>
        navigate({ screen, chatOpen: false, categoryId: options?.categoryId !== undefined ? options.categoryId : screen === "browse" ? null : nav.categoryId }),
      back,
      openChat: (message) => {
        navigate({ ...nav, chatOpen: true });
        if (message) chat.send(message);
        else setFocusToken((n) => n + 1);
      },
      // Called from the tap itself, so the browser lets the mic start (and the greeting speak).
      listen: () => {
        navigate({ ...nav, chatOpen: true });
        voiceBridge.current?.start();
      },
      registerVoice,
      openProduct: setProduct,
    }),
    [props, surface, locale, fallbackLocale, currency, currencyExponent, commerce, chat, cartCount, nav, navigate, back, t, registerVoice],
  );

  const hasContact = !!(props.about || props.info.phone || props.info.address || props.info.city || props.info.email || props.info.todayHours);
  const showBottomNav = !nav.chatOpen && (nav.screen === "home" || nav.screen === "browse");
  const contact = hasContact
    ? () => {
        const scroll = () => document.getElementById("agent-contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (nav.screen !== "home") {
          navigate(HOME);
          setTimeout(scroll, 60);
        } else scroll();
      }
    : null;

  return (
    <AgentUiProvider value={ui}>
      <div
        lang={locale}
        dir={localeDirection(locale)}
        className={`isolate min-h-dvh text-slate-900 antialiased ${props.backgroundUrl ? "" : "bg-agent-cream"}`}
      >
        {props.backgroundUrl && <AgentBackdrop url={props.backgroundUrl} home={nav.screen === "home" || (nav.screen === "done" && !commerce.orderResult)} />}
        <a href="#agent-main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg">
          {t("common.skipToContent")}
        </a>
        <div className="mx-auto w-full max-w-[1440px] lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6 lg:p-6 xl:grid-cols-[minmax(0,1fr)_440px]">
          <main
            id="agent-main"
            className={`${nav.chatOpen ? "hidden lg:block" : ""} min-w-0 overflow-clip ${showBottomNav ? "pb-24" : ""} lg:min-h-[calc(100dvh-3rem)] lg:rounded-[2rem] lg:pb-0 lg:ring-1 lg:ring-slate-900/5`}
          >
            {nav.screen === "home" && <HomeView />}
            {nav.screen === "browse" && <BrowseView categoryId={nav.categoryId} onCategory={(id) => navigate({ ...nav, categoryId: id }, true)} />}
            {nav.screen === "cart" && <CartScreen />}
            {nav.screen === "checkout" && <CheckoutScreen />}
            {nav.screen === "done" && (commerce.orderResult ? <ConfirmationScreen /> : <HomeView />)}
          </main>
          <aside
            aria-label={t("chat.panelLabel", { name: ui.aiName })}
            className={`${nav.chatOpen ? "fixed inset-0 z-40 flex" : "hidden"} flex-col lg:sticky lg:top-6 lg:z-auto lg:flex lg:h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[2rem] lg:shadow-[0_30px_60px_-30px_rgba(5,42,34,0.45)] lg:ring-1 lg:ring-slate-900/5`}
          >
            <ChatView onClose={back} focusToken={focusToken} />
          </aside>
        </div>

        {showBottomNav && <BottomNav screen={nav.screen} chatOpen={nav.chatOpen} onContact={contact} />}
        {product && <ProductSheet key={product.id} product={product} onClose={() => setProduct(null)} />}
        <AddedToast bottomNav={showBottomNav} chatOpen={nav.chatOpen} />
      </div>
    </AgentUiProvider>
  );
}

/**
 * The business's photo behind the whole Agent. On the landing page it is
 * shown strongly under a dark wash (white text stays readable, like the
 * hero); behind the other screens a light wash keeps lists and forms easy
 * to read. A fixed layer rather than `background-attachment: fixed`, which
 * phones ignore.
 */
function AgentBackdrop({ url, home }: { url: string; home: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10" data-testid="agent-backdrop">
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${encodeURI(url)}")` }} />
      <div
        className={`absolute inset-0 transition-colors duration-300 ${home ? "" : "bg-agent-cream/90"}`}
        style={
          home
            ? { backgroundImage: "linear-gradient(180deg, rgba(12,10,8,0.62) 0%, rgba(12,10,8,0.38) 32%, rgba(12,10,8,0.55) 62%, rgba(12,10,8,0.78) 100%)" }
            : undefined
        }
      />
    </div>
  );
}

/** "Added to cart" confirmation, carrying the Agent's existing cross-sell suggestion when one exists. */
function AddedToast({ bottomNav, chatOpen }: { bottomNav: boolean; chatOpen: boolean }) {
  const t = useAgentT();
  const { commerce, text, money, go, screen } = useAgentUi();
  const added = commerce.lastAdded;
  const { dismissLastAdded } = commerce;

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(dismissLastAdded, added.crossSell ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [added, dismissLastAdded]);

  if (!added || screen === "cart" || screen === "checkout" || screen === "done") return null;
  const cross = added.crossSell;

  return (
    <div
      role="status"
      className={`motion-safe:animate-agent-sheet fixed inset-x-3 z-40 mx-auto max-w-md rounded-3xl bg-white p-3 shadow-2xl ring-1 ring-slate-900/10 sm:inset-x-auto sm:start-6 sm:w-[26rem] lg:bottom-6 ${chatOpen ? "bottom-[8.5rem]" : bottomNav ? "bottom-24" : "bottom-4"}`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-agent-500 text-white">
          <CheckIcon size={18} strokeWidth={2.6} />
        </span>
        <p className="min-w-0 flex-1 text-sm">
          <span className="block font-bold text-slate-900">{t("toast.added")}</span>
          <span className="block truncate text-slate-500">{text(added.product.name)}</span>
        </p>
        <button type="button" onClick={() => { dismissLastAdded(); go("cart"); }} className={`${focusRing} h-9 shrink-0 rounded-full bg-agent-700 px-4 text-xs font-semibold text-white hover:bg-agent-800`}>
          {t("toast.viewCart")}
        </button>
        <button type="button" onClick={dismissLastAdded} aria-label={t("common.close")} className={`${focusRing} flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100`}>
          <CloseIcon size={16} />
        </button>
      </div>
      {cross && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-agent-50 p-2.5 ring-1 ring-agent-100">
          <ProductVisual product={cross} className="h-12 w-12 shrink-0 rounded-xl" iconClassName="text-2xl" />
          <p className="min-w-0 flex-1 text-xs">
            <span className="block font-semibold text-agent-800">{t("toast.pairsWell")}</span>
            <span className="block truncate font-bold text-slate-900">
              {text(cross.name)} · <span className="tabular-nums">{money(cross.priceMinor)}</span>
            </span>
          </p>
          <button
            type="button"
            disabled={commerce.pending}
            onClick={() => commerce.addToCart(cross)}
            aria-label={t("product.addNamed", { name: text(cross.name) })}
            className={`${focusRing} flex h-9 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-xs font-semibold text-agent-800 ring-1 ring-agent-200 hover:bg-agent-100 disabled:opacity-60`}
          >
            <PlusIcon size={14} /> {t("product.add")}
          </button>
        </div>
      )}
    </div>
  );
}

