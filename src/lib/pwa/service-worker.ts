/**
 * The service worker served at `/sw.js` (see `src/app/sw.js/route.ts`).
 *
 * What it caches — and only this: the build's own static files
 * (`/_next/static/…`, content-hashed and identical for every visitor), the
 * app icons, the favicon and the notification sounds. Every page, API call, server action, RSC
 * payload, auth request, payment and anything on another origin (Supabase,
 * payment gateways) goes straight to the network untouched, so no business,
 * order, customer, payment or session data is ever stored here and no stale
 * figures can be shown. With no network, a page load gets a small offline
 * notice instead of the browser's error page.
 *
 * Updates never take over on their own: a new worker waits until the page
 * asks for it (`SKIP_WAITING`, sent when the user clicks "Refresh").
 */

/** Same-origin paths served cache-first: immutable build output. */
export const SW_IMMUTABLE_PREFIX = "/_next/static/";
/** Same-origin paths served from cache and refreshed in the background (icons, notification sounds). */
export const SW_ICON_PATHS = ["/icons/", "/brand/", "/sounds/", "/favicon.ico"] as const;
export const SW_PRECACHE = ["/icons/icon-192.png", "/favicon.ico"] as const;

export const OFFLINE_COPY = {
  en: { message: "You're offline. Some AI Agent features require an internet connection.", retry: "Try again" },
  ar: { message: "أنت غير متصل بالإنترنت. تتطلب بعض ميزات AI Agent اتصالاً بالإنترنت.", retry: "إعادة المحاولة" },
  fr: {
    message: "Vous êtes hors ligne. Certaines fonctionnalités d’AI Agent nécessitent une connexion Internet.",
    retry: "Réessayer",
  },
} as const;

export function serviceWorkerSource(version: string): string {
  return `/* SmartManager AI Agent service worker (build ${version.replace(/[^\w.-]/g, "")}) */
"use strict";
const STATIC_CACHE = ${JSON.stringify(`sm-static-${version}`)};
const IMMUTABLE_PREFIX = ${JSON.stringify(SW_IMMUTABLE_PREFIX)};
const ICON_PATHS = ${JSON.stringify(SW_ICON_PATHS)};
const PRECACHE = ${JSON.stringify(SW_PRECACHE)};
const OFFLINE_COPY = ${JSON.stringify(OFFLINE_COPY)};

self.addEventListener("install", (event) => {
  // A missing icon must not stop the worker from installing.
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).catch(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("sm-") && key !== STATIC_CACHE).map((key) => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(event, url));
    return;
  }
  if (url.pathname.startsWith(IMMUTABLE_PREFIX)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (!url.search && ICON_PATHS.some((path) => url.pathname === path || (path.endsWith("/") && url.pathname.startsWith(path)))) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
  // Everything else (pages' data, APIs, auth, payments, images) is not handled here.
});

// A console notification (new order, new subscriber, upgrade) shown while the
// tab was in the background: focus an open console window, or open one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/subscriber", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === target.origin);
    if (open) {
      await open.focus();
      if ("navigate" in open) await open.navigate(target.href).catch(() => undefined);
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

/** Pages always come from the network; only a failed load gets the offline notice. */
async function navigate(event, url) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch (error) {
    return offlinePage(url);
  }
}

function cacheable(response) {
  return response && response.ok && response.type === "basic";
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (cacheable(response)) await cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  return network;
}

function offlinePage(url) {
  const segment = url.pathname.split("/")[1];
  const fallback = String((self.navigator && self.navigator.language) || "en").slice(0, 2);
  const lang = OFFLINE_COPY[segment] ? segment : OFFLINE_COPY[fallback] ? fallback : "en";
  const copy = OFFLINE_COPY[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  const html = '<!doctype html><html lang="' + lang + '" dir="' + dir + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#111827">' +
    '<title>SmartManager AI Agent</title><style>' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;' +
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Arabic",sans-serif}' +
    'main{max-width:22rem;padding:2rem 1.5rem;text-align:center}img{width:72px;height:72px;border-radius:16px}' +
    'p{font-size:1rem;line-height:1.5;margin:1.25rem 0}a{display:inline-block;padding:.6rem 1.25rem;border-radius:.5rem;' +
    'background:#059669;color:#fff;text-decoration:none;font-weight:600}</style></head><body><main>' +
    '<img src="/icons/icon-192.png" alt="SmartManager AI Agent"><p role="status">' + copy.message + '</p>' +
    '<a href="">' + copy.retry + '</a></main></body></html>';
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}
`;
}
