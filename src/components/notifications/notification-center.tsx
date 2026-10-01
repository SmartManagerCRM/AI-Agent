"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { formatMoney } from "@/lib/money";
import { audioReady, playSound, preloadSounds, subscribeAudio, unlockAudio } from "@/lib/notifications/audio";
import {
  AlertScheduler,
  Deduper,
  acceptEvent,
  orderSummary,
  type NotificationEvent,
  type NotificationScope,
  type SoundName,
} from "@/lib/notifications/core";
import { browserSupabase } from "@/lib/supabase-browser";

/**
 * Real-time console notifications — one instance per console layout (so one
 * Realtime channel per open console, kept across page navigation):
 *
 *   Realtime INSERT on notification_events (RLS-filtered by Supabase)
 *     → acceptEvent (kind / audience / business)  → Deduper (once per order)
 *     → toast + order badge + page data refresh   → AlertScheduler (sound)
 *     → browser notification when the tab is in the background
 *
 * If the Realtime connection drops, missed events are fetched when it comes
 * back (and on return to the tab), with a slow 30 s catch-up only while it
 * stays down. Sound needs the browser's permission to play audio, which only
 * a user gesture gives: until then the control says "Enable sound" and
 * alerts are visual only.
 */

export type NotificationLabels = {
  alertsOn: string;
  alertsOff: string;
  enableSound: string;
  enablePrompt: string;
  dismiss: string;
  newBadge: string;
  // Orders
  newOrder: string;
  orderNumber: string; // "Order #{number}"
  itemsOne: string;
  itemsOther: string; // "{count} items"
  newOrders: string; // "{count} new orders"
  latest: string;
  viewOrder: string;
  viewOrders: string;
  newOrderNotification: string;
  // Platform
  newSubscriber: string;
  joined: string; // "{name} has joined SmartManager."
  plan: string; // "{plan} plan"
  upgrade: string;
  upgraded: string; // "{name} upgraded from {from} → {to}."
  viewSubscriber: string;
  newSubscriberNotification: string;
  upgradeNotification: string;
};

type Props = {
  scope: NotificationScope;
  locale: string;
  /** Tenant consoles: the business slug, for links. */
  slug?: string;
  labels: NotificationLabels;
  /** Unacknowledged orders get one softer reminder after this long. */
  reminderMs?: number;
  children: ReactNode;
};

type ContextValue = {
  soundOn: boolean;
  ready: boolean;
  toggle: () => void;
  enable: () => void;
  labels: NotificationLabels;
  unacknowledgedOrders: number;
  isNewOrder: (orderId: string) => boolean;
};

const NotificationContext = createContext<ContextValue | null>(null);

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

// ── Small browser-storage helpers (preferences only; never anything sensitive) ──
const PERMISSION_ASKED_KEY = "sm-ai-agent:alerts:notification-permission-asked";
const CLAIMED_KEY = "sm-ai-agent:alerts:claimed";
const prefListeners = new Set<() => void>();

function readPref(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}
function writePref(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  prefListeners.forEach((l) => l());
}
function subscribePref(listener: () => void) {
  prefListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** One open tab of the console alerts per event — the others show it silently. */
function claimEvent(eventId: string): boolean {
  try {
    const claimed: string[] = JSON.parse(window.localStorage.getItem(CLAIMED_KEY) ?? "[]");
    if (claimed.includes(eventId)) return false;
    window.localStorage.setItem(CLAIMED_KEY, JSON.stringify([...claimed, eventId].slice(-50)));
  } catch {
    // No shared storage: every tab alerts.
  }
  return true;
}

function maybeAskNotificationPermission() {
  try {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    if (window.localStorage.getItem(PERMISSION_ASKED_KEY)) return;
    window.localStorage.setItem(PERMISSION_ASKED_KEY, new Date().toISOString());
    void Notification.requestPermission().catch(() => undefined);
  } catch {
    // Not supported here: on-page alerts only.
  }
}

async function showBrowserNotification(title: string, body: string, tag: string, url: string) {
  try {
    if (document.visibilityState !== "hidden" || !("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    const options = { body, tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url } };
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await registration.showNotification(title, options);
    else new Notification(title, options).onclick = () => window.focus();
  } catch {
    // Blocked or unsupported: the on-page alert is still there.
  }
}

const SELECT = "id, kind, audience, tenant_id, entity_id, payload, created_at";
const HIGHLIGHT_MS = 10 * 60 * 1000;

export function NotificationCenter({ scope, locale, slug, labels, reminderMs = 12000, children }: Props) {
  const router = useRouter();
  const isTenant = scope.kind === "tenant";
  const prefKey = isTenant ? "sm-ai-agent:alerts:orders" : "sm-ai-agent:alerts:platform";
  const sounds: SoundName[] = useMemo(
    () => (isTenant ? ["new-order", "order-reminder"] : ["new-subscriber", "subscription-upgrade"]),
    [isTenant],
  );

  const soundOn = useSyncExternalStore(
    subscribePref,
    () => readPref(prefKey),
    () => true,
  );
  const ready = useSyncExternalStore(subscribeAudio, audioReady, () => false);
  const [alerts, setAlerts] = useState<NotificationEvent[]>([]);
  const [highlighted, setHighlighted] = useState<Map<string, number>>(() => new Map());

  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  const schedulerRef = useRef<AlertScheduler | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scopeKey = scope.kind === "tenant" ? scope.tenantId : "platform";
  const href = useCallback(
    (event: NotificationEvent) => {
      if (event.kind === "new_order_received") return `/${locale}/${slug}/orders#order-${event.entity_id}`;
      const p = event.payload as { slug?: string };
      return `/${locale}/super-admin/subscribers/${p.slug ?? ""}`;
    },
    [locale, slug],
  );

  const describe = useCallback(
    (event: NotificationEvent) => {
      if (event.kind === "new_order_received") {
        const o = orderSummary(event);
        const parts = [
          o.items ? (o.items === 1 ? labels.itemsOne : fill(labels.itemsOther, { count: o.items })) : null,
          o.totalMinor !== null && o.currency ? formatMoney(o.totalMinor, o.currency, o.exponent, locale) : null,
        ].filter(Boolean);
        return {
          title: labels.newOrder,
          heading: o.orderNumber !== null ? fill(labels.orderNumber, { number: o.orderNumber }) : labels.newOrder,
          body: parts.join(" · "),
          notification: labels.newOrderNotification,
        };
      }
      const p = event.payload as Record<string, string | null | undefined>;
      const when = (iso: string | null | undefined) =>
        iso ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "";
      if (event.kind === "new_subscriber") {
        return {
          title: labels.newSubscriber,
          heading: fill(labels.joined, { name: p.business_name ?? p.slug ?? "" }),
          body: [p.plan_name ? fill(labels.plan, { plan: p.plan_name }) : null, p.owner_email, when(p.registered_at)]
            .filter(Boolean)
            .join(" · "),
          notification: labels.newSubscriberNotification,
        };
      }
      return {
        title: labels.upgrade,
        heading: fill(labels.upgraded, {
          name: p.business_name ?? p.slug ?? "",
          from: p.from_plan_name ?? p.from_plan_key ?? "",
          to: p.to_plan_name ?? p.to_plan_key ?? "",
        }),
        body: when(p.upgraded_at),
        notification: labels.upgradeNotification,
      };
    },
    [labels, locale],
  );

  // Latest helpers for the long-lived realtime effect.
  const describeRef = useRef(describe);
  const hrefRef = useRef(href);
  useEffect(() => {
    describeRef.current = describe;
    hrefRef.current = href;
  }, [describe, href]);

  // ── Sound engine (scheduler) ────────────────────────────────────────────
  useEffect(() => {
    const scheduler = new AlertScheduler({
      play: (sound) => soundOnRef.current && playSound(sound, sound === "order-reminder" ? 0.85 : 1),
      claim: claimEvent,
      reminderMs: isTenant ? reminderMs : null,
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [isTenant, reminderMs]);

  // ── Audio: preload when idle; unlock on the first user gesture ──────────
  useEffect(() => {
    const preload = setTimeout(() => preloadSounds(sounds), 1500);
    const unlock = () => {
      if (readPref(prefKey)) void unlockAudio(sounds);
    };
    const events = ["pointerdown", "keydown", "touchend", "click"] as const;
    const onGesture = () => {
      unlock();
      if (audioReady()) events.forEach((e) => document.removeEventListener(e, onGesture, true));
    };
    events.forEach((e) => document.addEventListener(e, onGesture, true));
    // A navigation that already carried a user gesture can start audio straight away.
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive)
      unlock();
    return () => {
      clearTimeout(preload);
      events.forEach((e) => document.removeEventListener(e, onGesture, true));
    };
  }, [prefKey, sounds]);

  // ── Realtime subscription ───────────────────────────────────────────────
  useEffect(() => {
    const supabase = browserSupabase();
    const deduper = new Deduper();
    let disposed = false;
    let lastSeen: string | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const filtered = () => {
      const q = supabase.from("notification_events").select(SELECT);
      return scope.kind === "tenant" ? q.eq("tenant_id", scope.tenantId) : q.eq("audience", "platform");
    };

    const handle = (row: unknown) => {
      const event = acceptEvent(scope, row);
      if (!event || disposed) return;
      if (!lastSeen || Date.parse(event.created_at) > Date.parse(lastSeen)) lastSeen = event.created_at;
      if (!deduper.firstTime(event)) return;
      setAlerts((prev) => [...prev, event].slice(-20));
      if (event.kind === "new_order_received") {
        setHighlighted((prev) => new Map(prev).set(event.entity_id, Date.now()));
        // Re-render the server pages (order list, counts, dashboard) without a reload.
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => router.refresh(), 400);
      }
      schedulerRef.current?.add(event);
      const text = describeRef.current(event);
      void showBrowserNotification(
        text.notification,
        [text.heading, text.body].filter(Boolean).join(" — "),
        event.id,
        hrefRef.current(event),
      );
    };

    const catchUp = async () => {
      if (disposed || lastSeen === null) return;
      const { data } = await filtered().gt("created_at", lastSeen).order("created_at").limit(20);
      for (const row of data ?? []) handle(row);
    };
    const startFallback = () => {
      if (fallback === null) fallback = setInterval(() => void catchUp(), 30000);
    };
    const stopFallback = () => {
      if (fallback !== null) clearInterval(fallback);
      fallback = null;
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void catchUp();
    };

    void (async () => {
      // Only events from now on: opening the console never replays old ones.
      const { data, error } = await filtered().order("created_at", { ascending: false }).limit(1);
      if (disposed) return;
      lastSeen = error ? null : (data?.[0]?.created_at ?? new Date(0).toISOString());
      const { data: session } = await supabase.auth.getSession();
      if (disposed) return;
      if (session.session) await supabase.realtime.setAuth(session.session.access_token);
      channel = supabase
        .channel(`notifications:${scopeKey}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notification_events",
            filter: scope.kind === "tenant" ? `tenant_id=eq.${scope.tenantId}` : "audience=eq.platform",
          },
          (change) => handle(change.new),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            stopFallback();
            void catchUp();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            startFallback();
          }
        });
      document.addEventListener("visibilitychange", onVisible);
    })();

    return () => {
      disposed = true;
      stopFallback();
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
    // `scope` is identified by scopeKey; router is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  // Drop "new" highlights after a while.
  useEffect(() => {
    if (highlighted.size === 0) return;
    const t = setTimeout(() => {
      const now = Date.now();
      setHighlighted((prev) => new Map([...prev].filter(([, at]) => now - at < HIGHLIGHT_MS)));
    }, 60000);
    return () => clearTimeout(t);
  }, [highlighted]);

  const acknowledge = useCallback((ids?: string[]) => {
    schedulerRef.current?.acknowledge(ids);
    setAlerts((prev) => (ids ? prev.filter((a) => !ids.includes(a.id)) : []));
  }, []);

  const enable = useCallback(() => {
    writePref(prefKey, true);
    void unlockAudio(sounds);
    maybeAskNotificationPermission();
  }, [prefKey, sounds]);

  const toggle = useCallback(() => {
    if (!soundOn) enable();
    else if (!ready) void unlockAudio(sounds);
    else writePref(prefKey, false);
  }, [soundOn, ready, enable, prefKey, sounds]);

  const value = useMemo<ContextValue>(
    () => ({
      soundOn,
      ready,
      toggle,
      enable,
      labels,
      unacknowledgedOrders: alerts.filter((a) => a.kind === "new_order_received").length,
      isNewOrder: (orderId) => highlighted.has(orderId),
    }),
    [soundOn, ready, toggle, enable, labels, alerts, highlighted],
  );

  const orderAlerts = alerts.filter((a) => a.kind === "new_order_received");
  const platformAlerts = alerts.filter((a) => a.kind !== "new_order_received").slice(-3);
  const latestOrder = orderAlerts[orderAlerts.length - 1];

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 top-20 z-[58] flex flex-col items-stretch gap-3 sm:inset-x-auto sm:end-4 sm:w-96"
      >
        {soundOn && !ready && (
          <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-md">
            <span>{labels.enablePrompt}</span>
            <button
              type="button"
              onClick={enable}
              className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
            >
              {labels.enableSound}
            </button>
          </div>
        )}
        {latestOrder && (
          <AlertCard
            icon="🛎"
            title={labels.newOrder}
            heading={
              orderAlerts.length === 1
                ? describe(latestOrder).heading
                : fill(labels.newOrders, { count: orderAlerts.length })
            }
            body={
              orderAlerts.length === 1
                ? describe(latestOrder).body
                : `${labels.latest}: ${[describe(latestOrder).heading, describe(latestOrder).body].filter(Boolean).join(" · ")}`
            }
            actionHref={orderAlerts.length === 1 ? href(latestOrder) : `/${locale}/${slug}/orders`}
            actionLabel={orderAlerts.length === 1 ? labels.viewOrder : labels.viewOrders}
            dismissLabel={labels.dismiss}
            onDone={() => acknowledge(orderAlerts.map((a) => a.id))}
          />
        )}
        {platformAlerts.map((event) => {
          const text = describe(event);
          return (
            <AlertCard
              key={event.id}
              icon={event.kind === "new_subscriber" ? "🔔" : "🚀"}
              title={text.title}
              heading={text.heading}
              body={text.body}
              actionHref={href(event)}
              actionLabel={labels.viewSubscriber}
              dismissLabel={labels.dismiss}
              onDone={() => acknowledge([event.id])}
            />
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
}

function AlertCard(props: {
  icon: string;
  title: string;
  heading: string;
  body: string;
  actionHref: string;
  actionLabel: string;
  dismissLabel: string;
  onDone: () => void;
}) {
  return (
    <div
      role="alert"
      className="pointer-events-auto rounded-xl border border-emerald-200 bg-white p-4 shadow-lg ring-2 ring-emerald-500/20"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-base">
            {props.icon}
          </span>
          {props.title}
        </p>
        <button
          type="button"
          onClick={props.onDone}
          aria-label={props.dismissLabel}
          className="-me-1 -mt-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className="mt-2 text-base font-semibold text-slate-900">{props.heading}</p>
      {props.body && <p className="mt-0.5 text-sm text-slate-600">{props.body}</p>}
      <div className="mt-3 flex justify-end">
        <Link
          href={props.actionHref}
          prefetch={false}
          onClick={props.onDone}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          {props.actionLabel}
        </Link>
      </div>
    </div>
  );
}

// ── Pieces used elsewhere in the console ─────────────────────────────────

/** Header control: "Order alerts ON / OFF", or "Enable sound" while the browser has audio locked. */
export function SoundToggle() {
  const ctx = useContext(NotificationContext);
  if (!ctx) return null;
  const { soundOn, ready, toggle, labels } = ctx;
  const state = !soundOn ? "off" : ready ? "on" : "locked";
  const text = state === "off" ? labels.alertsOff : state === "on" ? labels.alertsOn : labels.enableSound;
  const style =
    state === "on"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
      : state === "locked"
        ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={state === "on"}
      title={state === "locked" ? labels.enablePrompt : text}
      data-testid="alerts-toggle"
      data-state={state}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ${style}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4V5z" strokeLinejoin="round" />
        {state === "off" ? (
          <path d="m16 9 5 5m0-5-5 5" strokeLinecap="round" />
        ) : (
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
        )}
      </svg>
      <span className="hidden sm:inline">{text}</span>
      <span className="sr-only sm:hidden">{text}</span>
    </button>
  );
}

/** Live count of unacknowledged new orders (sidebar "Orders" badge). */
export function useNewOrderCount(): number {
  return useContext(NotificationContext)?.unacknowledgedOrders ?? 0;
}

/** "New" pill on an order row that arrived while the console was open. */
export function NewOrderBadge({ orderId }: { orderId: string }) {
  const ctx = useContext(NotificationContext);
  if (!ctx?.isNewOrder(orderId)) return null;
  return (
    <span
      data-new-order
      className="ms-2 inline-flex animate-pulse items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
    >
      {ctx.labels.newBadge}
    </span>
  );
}
