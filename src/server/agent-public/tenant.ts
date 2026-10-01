import "server-only";

import { isEntitled } from "@/server/billing/entitlement";
import { serviceClient } from "@/server/supabase/clients";

/**
 * Resolves a tenant for a public, unauthenticated Agent surface — the
 * standalone External Agent (addendum §14) or the embeddable widget
 * (spec §45, Phase 10). Uses the service-role client deliberately: an
 * anonymous visitor has no Supabase session at all for RLS to key off, so
 * the *server itself* resolves and validates the tenant — never a value
 * the client asserts — before anything else runs. Only a tenant that is
 * `active`, has opted into the surface asking (`deployment_mode`), and
 * has an entitled subscription (spec §98 Phase 7 — a lapsed trial 404s
 * here for a clean "not available" page rather than a working chat UI
 * that `runAgentGateway` would then refuse on every message) is reachable
 * this way — and only once its Agent deployment is PUBLISHED (Go live);
 * anything else is refused, with the reason (`PublicAgentResolution`). Which `deployment_mode` values count is
 * the one thing that differs between the two surfaces — everything else
 * (status, entitlement, the shape returned) is identical, so both
 * exported functions share one implementation.
 */
export type PublicTenant = {
  id: string;
  slug: string;
  businessName: Record<string, string>;
  businessTypeKey: string;
  currency: string;
  defaultLanguage: string;
  enabledLanguages: string[];
};

/**
 * Why a public Agent URL does or doesn't open — the page shows each case
 * differently ("Business not found" ≠ "Agent not live yet" ≠ "temporarily
 * unavailable"). Every state is decided on the server from the stored
 * records; the slug is only a lookup key, never an authorization.
 */
export type PublicAgentResolution =
  | { state: "live"; tenant: PublicTenant }
  | { state: "not_found" }
  | { state: "not_live"; businessName: Record<string, string>; defaultLanguage: string }
  | { state: "paused"; businessName: Record<string, string>; defaultLanguage: string }
  | { state: "unavailable"; businessName: Record<string, string>; defaultLanguage: string };

async function resolveForModes(slug: string, allowedModes: ("external_agent" | "website_widget" | "both")[]): Promise<PublicAgentResolution> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, business_name, business_type_key, currency, default_language, enabled_languages, deployment_mode, status")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return { state: "not_found" };
  const named = { businessName: data.business_name, defaultLanguage: data.default_language };
  // A suspended/closed business is not advertised as existing.
  if (data.status === "suspended" || data.status === "closed") return { state: "not_found" };
  // Still onboarding: it exists but has never gone live (publishing activates it).
  if (data.status !== "active") return { state: "not_live", ...named };

  // Only a PUBLISHED deployment is reachable — readiness alone never makes an Agent public.
  const { data: deployment } = await supabase.from("agent_deployments").select("status").eq("tenant_id", data.id).maybeSingle();
  if (deployment?.status === "paused") return { state: "paused", ...named };
  if (deployment?.status !== "published") return { state: "not_live", ...named };

  if (!allowedModes.includes(data.deployment_mode) && data.deployment_mode !== "both") return { state: "not_live", ...named };

  const { data: subscriptionRow } = await supabase
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end, trial_limit_reached_at")
    .eq("tenant_id", data.id)
    .maybeSingle();
  if (
    !isEntitled(
      subscriptionRow
        ? {
            status: subscriptionRow.status,
            trialEndsAt: subscriptionRow.trial_ends_at,
            currentPeriodEnd: subscriptionRow.current_period_end,
            trialLimitReachedAt: subscriptionRow.trial_limit_reached_at,
          }
        : null,
    )
  ) {
    return { state: "unavailable", ...named };
  }

  return {
    state: "live",
    tenant: {
      id: data.id,
      slug: data.slug,
      businessName: data.business_name,
      businessTypeKey: data.business_type_key,
      currency: data.currency,
      defaultLanguage: data.default_language,
      enabledLanguages: data.enabled_languages,
    },
  };
}

/** The standalone External Agent page (`/agent/<slug>`), with the reason when it can't open. */
export function resolvePublicAgent(slug: string): Promise<PublicAgentResolution> {
  return resolveForModes(slug, ["external_agent"]);
}

/** The embeddable widget page (`/agent/widget/<slug>`), with the reason when it can't open. */
export function resolveWidgetAgent(slug: string): Promise<PublicAgentResolution> {
  return resolveForModes(slug, ["website_widget"]);
}

/** For public Server Actions: the tenant only when its Agent is live, else null. */
export async function resolvePublicTenant(slug: string): Promise<PublicTenant | null> {
  const r = await resolvePublicAgent(slug);
  return r.state === "live" ? r.tenant : null;
}

export async function resolveWidgetTenant(slug: string): Promise<PublicTenant | null> {
  const r = await resolveWidgetAgent(slug);
  return r.state === "live" ? r.tenant : null;
}
