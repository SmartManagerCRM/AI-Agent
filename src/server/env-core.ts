import { z } from "zod";

/**
 * Server environment schema. Application code imports `@/server/env`
 * (guarded by `server-only`); the proxy imports this module directly because
 * the proxy bundle cannot load `server-only`. Non-`NEXT_PUBLIC_` variables are
 * never inlined into browser bundles by Next.js.
 */
const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+$/, "must be a bare hostname without scheme or port");

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Root domain of the platform (spec §21 multi-tenancy, §45 widget bootstrap). */
  PLATFORM_ROOT_DOMAIN: hostname.default("localhost"),
  /** Subdomain that serves the subscriber console and Super Admin (`/platform`). */
  CONSOLE_SUBDOMAIN: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("app"),
  /**
   * Subdomain that serves the standalone External Agent (addendum §14):
   * `agent.<root>/<tenant-slug>`, configurable per the addendum's own
   * instruction ("the domain must be configurable").
   */
  AGENT_SUBDOMAIN: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("agent"),
  /**
   * Overrides the console's public origin, bypassing `CONSOLE_SUBDOMAIN`
   * entirely. Some hosts (e.g. shared hosting plans without wildcard/
   * additional-subdomain support) can only serve the root domain — in that
   * case set this to that same root origin (no subdomain) so console/staff
   * links point somewhere that actually resolves instead of a dead
   * subdomain. Leave unset to keep building the console origin from
   * `CONSOLE_SUBDOMAIN` + `PLATFORM_ROOT_DOMAIN` as before.
   */
  CONSOLE_URL: z.url().optional(),
  /** Supabase secret (service-role) key. Only used by narrowly scoped server services. */
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  PUBLIC_URL_SCHEME: z.enum(["http", "https"]).default("https"),
  PUBLIC_URL_PORT: z.string().regex(/^\d+$/).optional(),
  /**
   * Platform-level AI provider credentials (spec §5) — metered across every
   * tenant, not per-tenant BYO keys. Gemini is the primary, paid-tier
   * provider (added at deploy time — never assumed to be a free-tier key);
   * Anthropic is the second `AIProvider` implementation, available as the
   * model router's fallback (spec §68). Neither is required for the app to
   * boot; without them, AI features degrade to "not configured" rather than
   * failing. There is deliberately no `*_MODEL` env var — which model serves
   * a "fast" or "agent" request is read from `ai_model_configs` (spec §6:
   * never hard-code a model name), not from the environment.
   */
  GEMINI_API_KEY: z.string().min(10).optional(),
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}
