"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { normalizeProductName } from "@/server/brain/discovery/facts";
import { createUserClient, type TypedSupabaseClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import type { Database } from "@/types/database";

import { loadGoLive } from "./go-live";
import type { ImportableOffering } from "./launch";

type Tenant = Database["public"]["Tables"]["tenants"]["Row"];

export type GoLiveActionState = { ok: boolean; message: string } | undefined;

const schema = z.object({ locale: z.string().min(2).max(5), slug: z.string().min(1).max(48) });

function refresh(locale: string, slug: string) {
  // The LIVE / NOT LIVE badge is in the console layout; the review lives on Brain and Agent.
  revalidatePath(`/${locale}/${slug}`, "layout");
}

/**
 * Go live: optionally add the approved, readable, priced Brain products to
 * the catalog, then publish through `publish_agent` — which re-checks the
 * caller's `agent.write` permission and the minimum launch requirements on
 * the database, whatever this form sent. The tenant is always the one the
 * signed-in member's slug resolves to, never an id from the form.
 */
export async function publishAgentAction(_prev: GoLiveActionState, formData: FormData): Promise<GoLiveActionState> {
  const parsed = schema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return { ok: false, message: "Something went wrong — please reload the page." };
  const { locale, slug } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  let imported = 0;
  if (formData.get("importProducts") === "on") {
    const state = await loadGoLive(supabase, tenant, locale);
    const result = await importOfferings(supabase, tenant, state.offerings.importable);
    if (!result.ok) return { ok: false, message: result.message };
    imported = result.imported;
  }

  const { data, error } = await supabase.rpc("publish_agent", { p_tenant_id: tenant.id });
  if (error) {
    refresh(locale, slug);
    return { ok: false, message: publishError(error.message, imported) };
  }
  refresh(locale, slug);
  const parts = ["Your Agent is live."];
  if (imported) parts.push(`${imported} product(s) added to your catalog.`);
  if (data?.trial_started && data.trial_ends_at) {
    parts.push(`Your free trial started — it runs until ${new Date(data.trial_ends_at).toLocaleDateString(locale)}.`);
  }
  return { ok: true, message: parts.join(" ") };
}

export async function pauseAgentAction(_prev: GoLiveActionState, formData: FormData): Promise<GoLiveActionState> {
  const parsed = schema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return { ok: false, message: "Something went wrong — please reload the page." };
  const { locale, slug } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("pause_agent", { p_tenant_id: tenant.id });
  refresh(locale, slug);
  if (error) {
    if (error.message.startsWith("PERMISSION_ERROR")) return { ok: false, message: "Only the business owner or a manager can pause the Agent." };
    if (error.message.includes("not live")) return { ok: false, message: "The Agent isn't live." };
    return { ok: false, message: "Couldn't pause the Agent — please try again." };
  }
  return { ok: true, message: "Your Agent is paused. Customers see “temporarily unavailable” until you publish again." };
}

function publishError(message: string, imported: number): string {
  const added = imported ? ` (${imported} product(s) were added to your catalog.)` : "";
  if (message.startsWith("PERMISSION_ERROR")) return "Only the business owner or a manager can publish the Agent.";
  if (message.startsWith("LAUNCH_REQUIREMENTS")) return `Not ready to go live yet — missing: ${message.replace(/^LAUNCH_REQUIREMENTS:\s*/, "")}.${added}`;
  if (message.startsWith("PLAN_REQUIRED")) return `Your plan has ended — choose a plan in Billing to publish your Agent.${added}`;
  if (message.startsWith("LAUNCH_BLOCKED")) return "This business is suspended — contact support.";
  return `Couldn't publish the Agent — please try again.${added}`;
}

/**
 * Adds approved Brain products to the catalog under the owner's own RLS
 * session (`catalog.write`). Only what `triageOfferings` accepted: a
 * readable name, a price in the business's currency, not already listed.
 */
async function importOfferings(
  supabase: TypedSupabaseClient,
  tenant: Tenant,
  offerings: ImportableOffering[],
): Promise<{ ok: true; imported: number } | { ok: false; message: string }> {
  if (offerings.length === 0) return { ok: true, imported: 0 };
  const [{ data: currency }, { data: categories }] = await Promise.all([
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
    supabase.from("categories").select("id, name").eq("tenant_id", tenant.id),
  ]);
  const exponent = currency?.exponent ?? 2;
  const lang = (name: string) => {
    if (/[؀-ۿ]/.test(name)) return "ar";
    return tenant.default_language === "ar" ? "en" : tenant.default_language;
  };

  const categoryIds = new Map<string, string>();
  for (const c of categories ?? []) {
    for (const n of Object.values(c.name ?? {})) categoryIds.set(normalizeProductName(String(n)), c.id);
  }
  for (const label of new Set(offerings.map((o) => o.category).filter((c): c is string => Boolean(c)))) {
    const key = normalizeProductName(label);
    if (!key || categoryIds.has(key)) continue;
    const { data, error } = await supabase
      .from("categories")
      .insert({ tenant_id: tenant.id, name: { [lang(label)]: label } })
      .select("id")
      .single();
    if (error || !data) return { ok: false, message: "Couldn't add your products to the catalog — you need permission to edit products." };
    categoryIds.set(key, data.id);
  }

  const rows = offerings.map((o) => ({
    tenant_id: tenant.id,
    category_id: o.category ? (categoryIds.get(normalizeProductName(o.category)) ?? null) : null,
    name: { [lang(o.name)]: o.name },
    description: o.description ? { [lang(o.description)]: o.description } : {},
    price_minor: Math.round(o.priceMajor * 10 ** exponent),
    status: "active" as const,
  }));
  const { error } = await supabase.from("products").insert(rows);
  if (error) return { ok: false, message: "Couldn't add your products to the catalog — you need permission to edit products." };
  return { ok: true, imported: rows.length };
}
