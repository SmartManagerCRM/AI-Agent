import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { pwaManifest } from "@/lib/pwa/manifest";
import { serviceWorkerSource } from "@/lib/pwa/service-worker";
import { config } from "@/proxy";

const ORIGIN = "https://app.example.test";

/** PNG width/height from the IHDR chunk. */
function pngSize(file: string) {
  const data = readFileSync(path.join(process.cwd(), "public", file));
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe("PWA manifest", () => {
  it("matches the required identity, entry point and display", () => {
    const m = pwaManifest();
    expect(m).toMatchObject({
      name: "SmartManager AI Agent",
      short_name: "AI Agent",
      description: "SmartManager AI Agent — intelligent ordering and business automation.",
      start_url: "/subscriber",
      scope: "/",
      display: "standalone",
      orientation: "portrait-primary",
      background_color: "#ffffff",
      theme_color: "#111827",
    });
  });

  it("lists 192, 512 and a 512 maskable icon, all present at their declared sizes", () => {
    const icons = pwaManifest().icons ?? [];
    expect(icons.some((i) => i.sizes === "192x192" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      const [w, h] = icon.sizes!.split("x").map(Number);
      expect(pngSize(icon.src)).toEqual({ width: w, height: h });
    }
    expect(pngSize("/icons/icon-180.png")).toEqual({ width: 180, height: 180 });
  });

  it("the proxy leaves /sw.js and /manifest.webmanifest alone but still routes look-alike slugs", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/sw.js")).toBe(false);
    expect(matcher.test("/manifest.webmanifest")).toBe(false);
    expect(matcher.test("/en/swajs-cafe")).toBe(true);
    expect(matcher.test("/sw.json")).toBe(true);
    expect(matcher.test("/subscriber")).toBe(true);
  });
});

// ── Service worker, run against a minimal fake worker environment ────────

type FakeResponse = { ok: boolean; type: string; status: number; body: string; clone: () => FakeResponse };

function response(body: string, status = 200): FakeResponse {
  const r: FakeResponse = { ok: status < 400, type: "basic", status, body, clone: () => r };
  return r;
}

function loadWorker({ online = true, language = "en" } = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const stores = new Map<string, Map<string, FakeResponse>>([
    ["sm-static-old", new Map()],
    ["other-app-cache", new Map()],
  ]);
  const fetched: string[] = [];
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    const key = (r: { url: string } | string) => (typeof r === "string" ? `${ORIGIN}${r}` : r.url);
    return {
      match: async (r: { url: string }) => store.get(key(r)),
      put: async (r: { url: string }, res: FakeResponse) => void store.set(key(r), res),
      addAll: async (urls: string[]) => urls.forEach((u) => store.set(key(u), response(`precached ${u}`))),
    };
  };
  const sandbox = {
    self: {
      addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn),
      location: { origin: ORIGIN },
      navigator: { language },
      registration: { navigationPreload: { enable: async () => undefined } },
      clients: { claim: async () => undefined },
      skipWaiting: () => undefined,
    },
    caches: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
    fetch: async (request: { url: string }) => {
      fetched.push(request.url);
      if (!online) throw new TypeError("Failed to fetch");
      return response(`network ${request.url}`);
    },
    Response: class {
      status: number;
      headers: Record<string, string>;
      constructor(
        public body: string,
        init: { status: number; headers: Record<string, string> },
      ) {
        this.status = init.status;
        this.headers = init.headers;
      }
    },
    URL,
  };
  vm.runInNewContext(serviceWorkerSource("build-123"), sandbox);

  /** Dispatches a fetch; resolves to the worker's response, or `null` when it lets the browser handle it. */
  async function dispatch(url: string, { method = "GET", mode = "cors" } = {}) {
    let handled = null as Promise<unknown> | null;
    listeners.fetch({
      request: { url: url.startsWith("http") ? url : `${ORIGIN}${url}`, method, mode },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (p: Promise<unknown>) => (handled = p),
      waitUntil: () => undefined,
    });
    return handled ? await handled : null;
  }
  async function lifecycle(type: "install" | "activate") {
    let done: Promise<unknown> = Promise.resolve();
    listeners[type]({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }
  return { dispatch, lifecycle, stores, fetched };
}

describe("PWA service worker", () => {
  it("never touches API calls, auth, payments, server actions, page data or other origins", async () => {
    const sw = loadWorker();
    expect(await sw.dispatch("/api/agent/qahwa-house/chat", { method: "POST" })).toBeNull();
    expect(await sw.dispatch("/api/payments/webhook")).toBeNull();
    expect(await sw.dispatch("/en/qahwa-house/orders?_rsc=abc")).toBeNull();
    expect(await sw.dispatch("/en/qahwa-house", { method: "POST" })).toBeNull();
    expect(await sw.dispatch("/_next/image?url=%2Fproduct.jpg&w=640&q=75")).toBeNull();
    expect(await sw.dispatch("https://project.supabase.co/rest/v1/orders")).toBeNull();
    expect(await sw.dispatch("https://project.supabase.co/auth/v1/token", { method: "POST" })).toBeNull();
    expect(await sw.dispatch("/agent/qahwa-house")).toBeNull();
    const cached = [...sw.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached).toEqual([]);
  });

  it("serves the build's static files from cache after the first load", async () => {
    const sw = loadWorker();
    const first = (await sw.dispatch("/_next/static/chunks/app-123.js")) as FakeResponse;
    expect(first.body).toBe(`network ${ORIGIN}/_next/static/chunks/app-123.js`);
    expect(sw.stores.get("sm-static-build-123")?.has(`${ORIGIN}/_next/static/chunks/app-123.js`)).toBe(true);
    await sw.dispatch("/_next/static/chunks/app-123.js");
    expect(sw.fetched.filter((u) => u.endsWith("app-123.js"))).toHaveLength(1);
  });

  it("loads pages from the network and stores none of them", async () => {
    const sw = loadWorker();
    const page = (await sw.dispatch("/en/qahwa-house/orders", { mode: "navigate" })) as FakeResponse;
    expect(page.body).toBe(`network ${ORIGIN}/en/qahwa-house/orders`);
    const cached = [...sw.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached.some((u) => u.includes("/orders"))).toBe(false);
  });

  it("shows the offline notice, in the page's language, when a page cannot load", async () => {
    const sw = loadWorker({ online: false });
    const en = (await sw.dispatch("/en/qahwa-house", { mode: "navigate" })) as { status: number; body: string };
    expect(en.status).toBe(503);
    expect(en.body).toContain("You're offline. Some AI Agent features require an internet connection.");
    const ar = (await sw.dispatch("/ar/qahwa-house", { mode: "navigate" })) as { body: string };
    expect(ar.body).toContain('dir="rtl"');
    expect(ar.body).toContain("أنت غير متصل بالإنترنت");
  });

  it("drops only its own old caches when a new version activates", async () => {
    const sw = loadWorker();
    await sw.lifecycle("install");
    await sw.lifecycle("activate");
    expect([...sw.stores.keys()].sort()).toEqual(["other-app-cache", "sm-static-build-123"]);
    expect(sw.stores.get("sm-static-build-123")?.has(`${ORIGIN}/icons/icon-192.png`)).toBe(true);
  });
});
