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
  /** Subdomain that can serve the subscriber console and Super Admin (`/super-admin`) — the canonical routing model answers both on the root host instead; see `src/lib/hosts.ts`. */
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
  /**
   * Public base URL of the customer-facing Agent, *only* once a dedicated
   * Agent domain has a real, verified DNS record (e.g.
   * `https://agent.smartmanager.me`); Agent links then become
   * `${AGENT_URL}/<business-slug>`. Unset (the default), Agent links are
   * path-based on the platform's own host — `https://<root>/agent/<slug>` —
   * which always resolves because it is the same host as the app. Never
   * set this to a hostname that doesn't resolve yet.
   */
  AGENT_URL: z.url().optional(),
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
  /**
   * Google Places API (New) key for Business Discovery (Google Maps
   * onboarding). Server-side only — never shipped to the browser. Optional:
   * without it, "Analyze from Google Maps" reports "not configured" and the
   * rest of the Business Brain (website, manual entries) works as before.
   * Restrict the key to the Places API (New) in Google Cloud Console.
   */
  GOOGLE_PLACES_API_KEY: z.string().min(10).optional(),
  /**
   * ElevenLabs API key for the Agent's premium voice (spoken greeting and
   * replies). Server-side only — the browser gets audio from the Agent's own
   * endpoint, never the key. Optional: without it (or without an active
   * `voice_profiles` row) the Agent speaks with the customer's device voice.
   * Which voice and model speak, and their price, are data in
   * `voice_profiles`, not environment variables.
   */
  ELEVENLABS_API_KEY: z.string().min(10).optional(),
  /**
   * `on` prints `[PERF] <operation>: <ms>` timing lines for the proxy,
   * auth/tenant resolution and the heaviest console queries (see
   * `src/server/perf.ts`). Off unless explicitly set — never logs values,
   * only operation names, durations and row counts.
   */
  PERF_LOGGING: z.enum(["on", "off"]).default("off"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}
