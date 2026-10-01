"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export type PwaLabels = {
  installTitle: string;
  installDescription: string;
  install: string;
  notNow: string;
  offline: string;
  updateAvailable: string;
  refresh: string;
};

// ── Install prompt ───────────────────────────────────────────────────────
// Chromium browsers fire `beforeinstallprompt` once, possibly before React
// has hydrated, so it is captured as soon as this module loads (browser
// only). Safari and Firefox never fire it: the install card then simply
// never shows.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "sm-ai-agent:install-dismissed";
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();
const notifyPrompt = () => promptListeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Show our own card instead of the browser's mini-infobar.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyPrompt();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyPrompt();
  });
}

function subscribePrompt(listener: () => void) {
  promptListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    promptListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
  } catch {
    // Storage blocked (private mode): the card just comes back next visit.
  }
}

const STANDALONE_QUERY = "(display-mode: standalone)";

/** Already running as the installed app (any platform, incl. iOS home-screen apps). */
function isStandalone(): boolean {
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function subscribeStandalone(listener: () => void) {
  const query = window.matchMedia(STANDALONE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function InstallAppButton({ labels }: { labels: PwaLabels }) {
  const installPrompt = useSyncExternalStore(
    subscribePrompt,
    () => deferredPrompt,
    () => null,
  );
  const dismissed = useSyncExternalStore(subscribePrompt, wasDismissed, () => true);
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => true);

  if (!installPrompt || dismissed || standalone) return null;

  const dismiss = () => {
    rememberDismissal();
    notifyPrompt();
  };

  const install = async () => {
    const event = installPrompt;
    // A prompt can only be shown once.
    deferredPrompt = null;
    notifyPrompt();
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "dismissed") dismiss();
    } catch {
      // The browser refused to show it; the address-bar install still works.
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby="install-app-title"
      className="fixed inset-x-4 bottom-4 z-50 rounded-xl border border-slate-200 bg-white p-4 shadow-lg sm:inset-x-auto sm:end-4 sm:w-96"
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- static app icon, already cached by the service worker */}
        <img src="/icons/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p id="install-app-title" className="text-sm font-semibold text-slate-900">
            {labels.installTitle}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{labels.installDescription}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={install}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              {labels.install}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {labels.notNow}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Service worker: registration, updates, offline notice ───────────────

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/**
 * Registers `/sw.js` in production builds (never in `next dev`, where a
 * worker would only get in the way of hot reload). Any failure is ignored:
 * the console works the same without it. A new version is only offered —
 * the page reloads when the user clicks Refresh, never in the middle of
 * whatever they are doing.
 */
export function ServiceWorkerManager({ labels }: { labels: PwaLabels }) {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = Date.now();

    const offerUpdate = () => {
      // Only an update — not the very first install — has a controller already.
      if (active && registration?.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
    };
    const checkForUpdate = () => {
      if (document.visibilityState !== "visible" || !registration) return;
      if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      registration.update().catch(() => undefined);
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        offerUpdate();
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed") offerUpdate();
          });
        });
      })
      .catch(() => undefined);
    document.addEventListener("visibilitychange", checkForUpdate);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);

  const refresh = () => {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <>
      {!online && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[60] bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950"
        >
          {labels.offline}
        </div>
      )}
      {waiting && (
        <div
          role="status"
          className="fixed inset-x-4 top-4 z-[55] mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          <span>{labels.updateAvailable}</span>
          <button
            type="button"
            onClick={refresh}
            className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-white hover:bg-emerald-400"
          >
            {labels.refresh}
          </button>
        </div>
      )}
    </>
  );
}
