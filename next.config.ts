import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Baseline security headers for every response (spec §61). A nonce-based
 * script CSP is added once payment/AI provider origins are finalized.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
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
const widgetHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors *; base-uri 'self'; object-src 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/((?!widget/).*)", headers: securityHeaders },
      { source: "/widget/:slug*", headers: widgetHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
