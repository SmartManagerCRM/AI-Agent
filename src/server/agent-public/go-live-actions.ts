"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

import { importOfferings, syncApprovedProducts } from "./catalog-sync";
import { loadGoLive } from "./go-live";

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

/** Live Agent: add approved Brain products that aren't in the catalog yet (same rules as Go live). */
export async function syncCatalogAction(_prev: GoLiveActionState, formData: FormData): Promise<GoLiveActionState> {
  const parsed = schema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return { ok: false, message: "Something went wrong — please reload the page." };
  const { locale, slug } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const added = await syncApprovedProducts(supabase, tenant, locale);
  refresh(locale, slug);
  return added > 0
    ? { ok: true, message: `${added} product(s) added — they're on your live Agent now.` }
    : { ok: false, message: "Nothing was added — you need permission to edit products, or they're already in your catalog." };
}
