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
  /** Supabase secret (service-role) key. Only used by narrowly scoped server services. */
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  PUBLIC_URL_SCHEME: z.enum(["http", "https"]).default("https"),
  PUBLIC_URL_PORT: z.string().regex(/^\d+$/).optional(),
  /**
   * Platform-level AI provider credentials (spec §5) — metered across every
   * tenant, not per-tenant BYO keys. Gemini is the initial provider (spec §4);
   * Anthropic is an optional second implementation for the model router's
   * fallback path (spec §68). Neither is required for Phase 1; without them,
   * AI features degrade to "not configured" rather than failing.
   */
  GEMINI_API_KEY: z.string().min(10).optional(),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-2.0-flash"),
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  ANTHROPIC_MODEL: z.string().trim().min(1).default("claude-sonnet-5"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}
