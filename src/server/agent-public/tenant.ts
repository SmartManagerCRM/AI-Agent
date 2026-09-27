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
 * this way; anything else 404s. Which `deployment_mode` values count is
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

async function resolvePublicTenantForModes(slug: string, allowedModes: ("external_agent" | "website_widget" | "both")[]): Promise<PublicTenant | null> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, business_name, business_type_key, currency, default_language, enabled_languages, deployment_mode, status")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  if (data.status !== "active") return null;
  if (!allowedModes.includes(data.deployment_mode) && data.deployment_mode !== "both") return null;

  const { data: subscriptionRow } = await supabase
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end")
    .eq("tenant_id", data.id)
    .maybeSingle();
  if (
    !isEntitled(
      subscriptionRow
        ? { status: subscriptionRow.status, trialEndsAt: subscriptionRow.trial_ends_at, currentPeriodEnd: subscriptionRow.current_period_end }
        : null,
    )
  ) {
    return null;
  }

  return {
    id: data.id,
    slug: data.slug,
    businessName: data.business_name,
    businessTypeKey: data.business_type_key,
    currency: data.currency,
    defaultLanguage: data.default_language,
    enabledLanguages: data.enabled_languages,
  };
}

/** The standalone External Agent (addendum §14): `agent.<root>/<slug>`. */
export function resolvePublicTenant(slug: string): Promise<PublicTenant | null> {
  return resolvePublicTenantForModes(slug, ["external_agent"]);
}

/** The embeddable widget (spec §45, Phase 10): `agent.<root>/widget/<slug>`, meant to be loaded in an iframe on the tenant's own website. */
export function resolveWidgetTenant(slug: string): Promise<PublicTenant | null> {
  return resolvePublicTenantForModes(slug, ["website_widget"]);
}
