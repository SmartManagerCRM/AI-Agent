import { LOCALES } from "@/i18n/locales";
import { SITE_PAGES } from "@/lib/site/config";

/**
 * Top-level path segments a tenant slug must never collide with — checked
 * both by the proxy's console-routing decision (`resolveConsolePath`) and
 * by slug generation at business-creation time, so a business can never
 * even be assigned a colliding slug in the first place.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set<string>([
  ...LOCALES,
  "login",
  "onboarding",
  "subscriber",
  "platform",
  "super-admin",
  "invite",
  "t",
  "api",
  // Path-based customer Agent: /agent/<business-slug>.
  "agent",
  // The Agent host's own pages: /pay/<paymentId> and /track/<orderId> (src/app/agent/pay, src/app/agent/track).
  "pay",
  "track",
  "widget",
  // Paddle's default payment link: /checkout?_ptxn=… (src/app/site/[locale]/checkout).
  "checkout",
  "admin",
  "www",
  // The public website's pages (/en/pricing, /en/signup, …): src/app/site/[locale].
  ...SITE_PAGES,
]);
