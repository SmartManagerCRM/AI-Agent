import "server-only";

import { serviceClient } from "@/server/supabase/clients";

/**
 * Resolves a tenant for the public External Agent surface (addendum §14).
 * Uses the service-role client deliberately: an anonymous visitor has no
 * Supabase session at all for RLS to key off, so the *server itself*
 * resolves and validates the tenant — never a value the client asserts —
 * before anything else runs. Only a tenant that is `active` and has opted
 * into `external_agent`/`both` is reachable this way; anything else 404s.
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

export async function resolvePublicTenant(slug: string): Promise<PublicTenant | null> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, business_name, business_type_key, currency, default_language, enabled_languages, deployment_mode, status")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  if (data.status !== "active") return null;
  if (data.deployment_mode !== "external_agent" && data.deployment_mode !== "both") return null;

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
