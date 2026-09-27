import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Customer session identity for the External Agent (addendum §14) — there
 * is no customer account system yet, so "the same customer" means "the
 * same HttpOnly cookie". Only the SHA-256 hash of the token is ever stored
 * (`conversations.session_token_hash`); the raw token lives only in the
 * cookie, the same "hash only, never the raw value" pattern this product's
 * sibling project uses for guest cart/booking tokens.
 *
 * No `import "server-only"` here (it is imported by its own unit tests,
 * same reasoning as `src/server/ai/gemini.ts`) — `next/headers` already
 * makes this unusable outside a request context regardless.
 */
const COOKIE_PREFIX = "sma_agent_";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Cookie name is per-tenant-slug so one browser can hold separate sessions for separate businesses. */
export function sessionCookieName(tenantSlug: string): string {
  return `${COOKIE_PREFIX}${tenantSlug}`;
}

export async function readSessionToken(tenantSlug: string): Promise<string | null> {
  const store = await cookies();
  return store.get(sessionCookieName(tenantSlug))?.value ?? null;
}

export async function writeSessionToken(tenantSlug: string, token: string, options?: { crossSite?: boolean }): Promise<void> {
  const store = await cookies();
  // A cookie set from the widget's iframe (spec §45) is third-party from
  // the embedding page's point of view — Chrome/Firefox require
  // `SameSite=None; Secure` for it to be sent at all in that context (a
  // plain `Lax` cookie is silently dropped there). Safari's ITP still
  // blocks or expires it regardless; that's a documented Phase 10
  // limitation, not something this flag can fix.
  store.set(sessionCookieName(tenantSlug), token, {
    httpOnly: true,
    sameSite: options?.crossSite ? "none" : "lax",
    secure: options?.crossSite ? true : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}
