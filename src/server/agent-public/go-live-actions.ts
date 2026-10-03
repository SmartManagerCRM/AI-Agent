"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { actionT } from "@/server/i18n/action-messages";

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
  const t = await actionT(formData.get("locale"));
  const parsed = schema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return { ok: false, message: t("reload") };
  const { locale, slug } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  let imported = 0;
  if (formData.get("importProducts") === "on") {
    const state = await loadGoLive(supabase, tenant, locale);
    const result = await importOfferings(supabase, tenant, state.offerings.importable);
    if (!result.ok) return { ok: false, message: t("goLive.importNoPermission") };
    imported = result.imported;
  }

  const { data, error } = await supabase.rpc("publish_agent", { p_tenant_id: tenant.id });
  if (error) {
    refresh(locale, slug);
    return { ok: false, message: publishError(t, error.message, imported) };
  }
  refresh(locale, slug);
  const parts = [t("goLive.live")];
  if (imported) parts.push(t("goLive.imported", { n: imported }));
  if (data?.trial_started && data.trial_ends_at) {
    parts.push(t("goLive.trialStarted", { date: new Date(data.trial_ends_at).toLocaleDateString(locale) }));
  }
  return { ok: true, message: parts.join(" ") };
}

export async function pauseAgentAction(_prev: GoLiveActionState, formData: FormData): Promise<GoLiveActionState> {
  const t = await actionT(formData.get("locale"));
  const parsed = schema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return { ok: false, message: t("reload") };
  const { locale, slug } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("pause_agent", { p_tenant_id: tenant.id });
  refresh(locale, slug);
  if (error) {
    if (error.message.startsWith("PERMISSION_ERROR")) return { ok: false, message: t("goLive.pauseNoPermission") };
    if (error.message.includes("not live")) return { ok: false, message: t("goLive.notLive") };
    return { ok: false, message: t("goLive.pauseFailed") };
  }
  return { ok: true, message: t("goLive.paused") };
}

function publishError(t: Awaited<ReturnType<typeof actionT>>, message: string, imported: number): string {
  const added = imported ? t("goLive.addedNote", { n: imported }) : "";
  if (message.startsWith("PERMISSION_ERROR")) return t("goLive.publishNoPermission");
  if (message.startsWith("LAUNCH_REQUIREMENTS")) return t("goLive.notReady", { missing: message.replace(/^LAUNCH_REQUIREMENTS:\s*/, "") }) + added;
  if (message.startsWith("PLAN_REQUIRED")) return t("goLive.planEnded") + added;
  if (message.startsWith("LAUNCH_BLOCKED")) return t("goLive.suspended");
  return t("goLive.publishFailed") + added;
}

/** Live Agent: add approved Brain products that aren't in the catalog yet (same rules as Go live). */
export async function syncCatalogAction(_prev: GoLiveActionState, formData: FormData): Promise<GoLiveActionState> {
  const t = await actionT(formData.get("locale"));
  const parsed = schema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return { ok: false, message: t("reload") };
  const { locale, slug } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const added = await syncApprovedProducts(supabase, tenant, locale);
  refresh(locale, slug);
  return added > 0
    ? { ok: true, message: t("goLive.synced", { n: added }) }
    : { ok: false, message: t("goLive.nothingAdded") };
}
