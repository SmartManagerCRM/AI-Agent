import { readFile } from "node:fs/promises";
import path from "node:path";

import { serviceWorkerSource } from "@/lib/pwa/service-worker";

export const dynamic = "force-dynamic";

/**
 * `/sw.js` — the PWA service worker (`src/lib/pwa/service-worker.ts`).
 * Stamped with this build's id, so each deployment ships a changed worker
 * and open apps can offer "New version available — Refresh". Never cached
 * by the browser or a CDN, so that check always sees the live version.
 */
let version: Promise<string> | undefined;

function buildVersion(): Promise<string> {
  version ??= readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")
    .then((id) => id.trim() || "dev")
    .catch(() => "dev");
  return version;
}

export async function GET() {
  return new Response(serviceWorkerSource(await buildVersion()), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
