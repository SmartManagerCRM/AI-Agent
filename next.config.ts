import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Baseline security headers for every response (spec §61). The
 * `Content-Security-Policy` itself is NOT here — it needs a fresh nonce on
 * every request (script-src 'nonce-…'), which this static config can't
 * express, so it's computed and set in `src/proxy.ts` instead, once, for
 * every response path.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

// The embeddable widget page (spec §45, Phase 10) exists specifically to
// be loaded in an iframe on a tenant's own (third-party) website — the
// opposite of every other route, which should never be frameable at all.
// `next.config.ts`'s `headers()` matches the *external* request path (the
// one the browser/business site actually sends), not `src/proxy.ts`'s
// internal rewrite target — the agent host's own convention (like
// `/agent/[slug]`'s external `/<slug>`, no `/agent` prefix) means the
// external shape here is `/widget/<slug>`, not `/agent/widget/<slug>`.
// (No `X-Frame-Options` here — it has no per-origin allowlist, only ALLOW/DENY,
// so it can't express "framed by any site" the way CSP's `frame-ancestors *`,
// set dynamically in `src/proxy.ts`, does.)
const widgetHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Deploy target is Hostinger shared hosting's Node.js App feature (see
  // DEPLOYMENT.md), which runs a plain `node <startup file>` — not `next
  // start` — and benefits from a minimal, dependency-pruned server rather
  // than the full `node_modules` tree. `output: "standalone"` produces
  // `.next/standalone/server.js`, a self-contained server that reads
  // `PORT`/`HOSTNAME` from the environment, which is exactly the shape a
  // shared-hosting "startup file" expects. Has no effect on `next dev`.
  output: "standalone",
  // Menu-image OCR (Business Discovery): tesseract.js runs its engine in a
  // worker thread loaded from its own package files, so it must stay an
  // external Node package (not bundled), and the standalone output must
  // carry its WASM core and the bundled Arabic/English/French language data.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  outputFileTracingIncludes: {
    "/console/**": [
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/tesseract.js/package.json",
      // The OCR worker thread's own dependencies (loaded by path, so not traced automatically).
      "./node_modules/{bmp-js,is-url,node-fetch,regenerator-runtime,wasm-feature-detect,zlibjs,whatwg-url,tr46,webidl-conversions}/**/*",
      "./node_modules/tesseract.js-core/*.js",
      "./node_modules/tesseract.js-core/*.wasm",
      "./node_modules/@tesseract.js-data/ara/4.0.0_best_int/*",
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/*",
      "./node_modules/@tesseract.js-data/fra/4.0.0_best_int/*",
    ],
  },
  async headers() {
    return [
      { source: "/((?!widget/).*)", headers: securityHeaders },
      { source: "/widget/:slug*", headers: widgetHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
