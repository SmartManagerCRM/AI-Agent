import { LOCALES } from "@/i18n/locales";

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
  "admin",
  "www",
]);
