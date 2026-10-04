import { RESERVED_SLUGS } from "@/lib/reserved-slugs";

export type ConsoleRouteDecision =
  { kind: "redirect"; to: string } | { kind: "rewrite"; internalPath: string } | { kind: "site" };

/**
 * Decides how a console-host request (after its locale prefix has already
 * been stripped) should be handled — pure and host-agnostic, like
 * `classifyHost`, so it's unit-testable and shared by every host case that
 * can serve console paths (the dedicated console subdomain, and the root
 * platform host when it answers console requests directly by path).
 *
 * Canonical shapes (routing architecture spec):
 *   - subscriber console: `/{business-slug}` — bare, no `/t/` prefix
 *   - Super Admin: `/super-admin` — never `/platform`, never a subdomain
 * Both former shapes still work, but only as a redirect to the canonical
 * one — never silently rewritten — so the address bar always shows the
 * canonical URL and nothing generates the old shape going forward.
 *
 * A `{ kind: "site" }` result happens for the bare root (`rest === ""`,
 * the marketing homepage) and the public site's own reserved pages
 * (`/pricing`, `/signup`, … — src/lib/site/config.ts) — every other single
 * top-level segment is either one of the fixed console paths above or, if
 * it isn't reserved, treated as a tenant slug lookup (which itself 404s server-side
 * in `requireTenantMember` if no such tenant exists — this function never
 * touches the database, same as `classifyHost`).
 */
export function resolveConsolePath(rest: string): ConsoleRouteDecision {
  // The true bare root ("") is the platform host's marketing homepage, not
  // a console path — callers on a host with no marketing site of its own
  // (the console subdomain) treat a "site" result as the console's own
  // bare entry instead; `/subscriber` is the explicit, non-empty alias for
  // that same bare entry when a marketing site IS present to disambiguate
  // from.
  if (rest === "/subscriber") return { kind: "rewrite", internalPath: "" };
  if (rest.startsWith("/subscriber/")) return { kind: "rewrite", internalPath: rest.slice("/subscriber".length) };

  if (rest === "/platform" || rest.startsWith("/platform/")) {
    return { kind: "redirect", to: `/super-admin${rest.slice("/platform".length)}` };
  }
  const legacyTenant = /^\/t\/([^/]+)((?:\/.*)?)$/.exec(rest);
  if (legacyTenant) return { kind: "redirect", to: `/${legacyTenant[1]}${legacyTenant[2]}` };

  if (rest === "/super-admin" || rest.startsWith("/super-admin/")) {
    return { kind: "rewrite", internalPath: `/platform${rest.slice("/super-admin".length)}` };
  }
  if (rest === "/login" || rest.startsWith("/login/")) return { kind: "rewrite", internalPath: rest };
  if (rest === "/onboarding" || rest.startsWith("/onboarding/")) return { kind: "rewrite", internalPath: rest };
  if (rest.startsWith("/invite/")) return { kind: "rewrite", internalPath: rest };

  const slugMatch = /^\/([^/]+)((?:\/.*)?)$/.exec(rest);
  if (slugMatch && !RESERVED_SLUGS.has(slugMatch[1])) {
    return { kind: "rewrite", internalPath: `/t/${slugMatch[1]}${slugMatch[2]}` };
  }

  return { kind: "site" };
}
