import "server-only";

import { isEntitled } from "@/server/billing/entitlement";
import { normalizeProductName } from "@/server/brain/discovery/facts";
import { isReadableName } from "@/server/brain/discovery/name-quality";
import type { TypedSupabaseClient } from "@/server/supabase/clients";
import type { AgentDeploymentStatus, Database } from "@/types/database";

import { launchChecklist, triageOfferings, type LaunchItem, type OfferingTriage } from "./launch";
import { publicAgentUrls } from "./urls";

type Tenant = Database["public"]["Tables"]["tenants"]["Row"];

export type GoLiveState = {
  status: AgentDeploymentStatus;
  isLive: boolean;
  publishedAt: string | null;
  pausedAt: string | null;
  agentUrl: string;
  businessName: string;
  businessTypeLabel: string | null;
  languages: string[];
  deploymentMode: Tenant["deployment_mode"];
  orderingEnabled: boolean;
  approvedKnowledge: number;
  activeProducts: number;
  pricedProducts: number;
  bookingServices: number;
  subscription: "none" | "entitled" | "expired";
  offerings: OfferingTriage;
  items: LaunchItem[];
  canPublish: boolean;
};

/** The Agent's deployment status alone — for the console's LIVE / NOT LIVE badge. */
export async function loadDeploymentStatus(supabase: TypedSupabaseClient, tenantId: string): Promise<AgentDeploymentStatus> {
  const { data } = await supabase.from("agent_deployments").select("status").eq("tenant_id", tenantId).maybeSingle();
  return data?.status ?? "draft";
}

/**
 * Everything the Go live review shows, read under the signed-in owner's
 * RLS session: deployment state, the launch checklist (minimum
 * requirements — not Brain readiness), and which approved Brain products
 * can be added to the catalog at publish.
 */
export async function loadGoLive(supabase: TypedSupabaseClient, tenant: Tenant, locale: string): Promise<GoLiveState> {
  const [
    { data: deployment },
    { data: subscription },
    { data: settings },
    { data: type },
    { data: facts },
    { data: products },
    { count: bookingServices },
    { data: branches },
  ] = await Promise.all([
    supabase.from("agent_deployments").select("status, published_at, paused_at").eq("tenant_id", tenant.id).maybeSingle(),
    supabase
      .from("subscriptions")
      .select("status, trial_ends_at, current_period_end, trial_limit_reached_at")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase.from("tenant_settings").select("checkout").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("business_types").select("name").eq("key", tenant.business_type_key).maybeSingle(),
    supabase
      .from("business_brain_entries")
      .select("id, fact_key, entry_type, content")
      .eq("tenant_id", tenant.id)
      .eq("status", "approved")
      .eq("is_active", true)
      .limit(2000),
    supabase.from("products").select("name, price_minor, status").eq("tenant_id", tenant.id).neq("status", "archived"),
    supabase.from("bookable_services").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("is_active", true),
    supabase.from("branches").select("opening_hours").eq("tenant_id", tenant.id).eq("is_active", true),
  ]);

  const approved = facts ?? [];
  const isOffering = (t: string) => t === "product_candidate" || t === "service_candidate";
  const offeringName = (c: unknown) => {
    const n = (c as { normalized?: { name?: unknown } } | null)?.normalized?.name;
    return typeof n === "string" ? n : "";
  };
  // An approved "product" whose name is OCR noise isn't knowledge a customer can use.
  const approvedKnowledge = approved.filter((f) => !isOffering(f.entry_type) || isReadableName(offeringName(f.content))).length;

  // Same rule as `publish_agent`: only active products count; drafts still block duplicates.
  const catalog = (products ?? []).filter((p) => p.status === "active");
  const activeProducts = catalog.length;
  const pricedProducts = catalog.filter((p) => p.price_minor > 0).length;
  const catalogNames = new Set((products ?? []).flatMap((p) => Object.values(p.name ?? {}).map((n) => normalizeProductName(String(n)))));
  const offerings = triageOfferings(approved, tenant.currency, catalogNames, normalizeProductName, isReadableName);

  const subscriptionState: GoLiveState["subscription"] = !subscription
    ? "none"
    : isEntitled({
        status: subscription.status,
        trialEndsAt: subscription.trial_ends_at,
        currentPeriodEnd: subscription.current_period_end,
        trialLimitReachedAt: subscription.trial_limit_reached_at,
      })
      ? "entitled"
      : "expired";

  const businessName = tenant.business_name[locale] ?? tenant.business_name[tenant.default_language] ?? Object.values(tenant.business_name)[0] ?? "";
  const businessTypeLabel = type ? (type.name[locale] ?? type.name.en ?? Object.values(type.name)[0] ?? tenant.business_type_key) : null;
  const orderingEnabled = settings?.checkout?.ordering_enabled ?? false;
  const has = (match: (f: (typeof approved)[number]) => boolean) => approved.some(match);

  const { items, canPublish } = launchChecklist({
    businessName,
    businessTypeLabel,
    approvedKnowledge,
    activeProducts,
    pricedProducts,
    importableProducts: offerings.importable.length,
    orderingEnabled,
    bookingServices: bookingServices ?? 0,
    subscription: subscriptionState,
    optional: {
      hours:
        has((f) => Boolean(f.fact_key?.startsWith("hours."))) ||
        (branches ?? []).some((b) => b.opening_hours && Object.keys(b.opening_hours as object).length > 0),
      description: has((f) => f.entry_type === "about"),
      policies: has((f) => ["policy", "delivery_info", "payment_methods"].includes(f.entry_type)),
      faq: has((f) => f.entry_type === "faq"),
    },
  });

  const status = deployment?.status ?? "draft";
  return {
    status,
    isLive: status === "published",
    publishedAt: deployment?.published_at ?? null,
    pausedAt: deployment?.paused_at ?? null,
    agentUrl: publicAgentUrls().agent(tenant.slug),
    businessName,
    businessTypeLabel,
    languages: tenant.enabled_languages,
    deploymentMode: tenant.deployment_mode,
    orderingEnabled,
    approvedKnowledge,
    activeProducts,
    pricedProducts,
    bookingServices: bookingServices ?? 0,
    subscription: subscriptionState,
    offerings,
    items,
    canPublish,
  };
}
