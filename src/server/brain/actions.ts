"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CURRENCY_EXPONENT } from "@/server/brain/discovery/extract";
import { parsePlaceInput } from "@/server/brain/discovery/google-places";
import { startDiscoveryJob } from "@/server/brain/discovery/jobs";
import { MAX_DIRECT_MENU_URLS } from "@/server/brain/discovery/pipeline";
import { parseCrawlUrl } from "@/server/brain/url-safety";
import { draftBrainCatalog } from "@/server/catalog/brain-drafts";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember, requireUser } from "@/server/tenant/context";
import type { IngestionJobStatus, Json } from "@/types/database";

/**
 * An approved Brain product or service is in the catalog straight away —
 * on the Products & Services / Bookings pages and, when the Agent is live,
 * for customers (unless its price still needs the owner, see draftBrainCatalog).
 */
async function catalogApprovedFindings(
  supabase: Awaited<ReturnType<typeof createUserClient>>,
  tenant: { id: string; currency: string; default_language: string },
  locale: string,
  slug: string,
) {
  await draftBrainCatalog(supabase, tenant).catch(() => null);
  revalidatePath(`/${locale}/${slug}/products`);
  revalidatePath(`/${locale}/${slug}/bookings`);
}

const recrawlSchema = z.object({
  url: z.url(),
  slug: z.string().min(1),
  locale: z.string(),
});

/** Re-scans one website source (incremental: unchanged pages are skipped by fingerprint). */
export async function recrawlSourceAction(formData: FormData): Promise<void> {
  const parsed = recrawlSchema.safeParse({
    url: formData.get("url"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const user = await requireUser(parsed.data.locale);
  const supabase = await createUserClient();
  await startDiscoveryJob(supabase, { tenantId: tenant.id, userId: user.id, input: { websiteUrl: parsed.data.url }, trigger: "refresh" });
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}

// ── Business Discovery ────────────────────────────────────────────────────

const discoverySchema = z.object({
  slug: z.string().min(1),
  locale: z.string(),
  mapsInput: z.string().trim().max(2000).optional(),
  websiteUrl: z.string().trim().max(2000).optional(),
  menuUrls: z.string().trim().max(5000).optional(),
});

export type DiscoveryStartState = { error?: string; jobId?: string } | undefined;

/** "Analyze my business": Google Maps listing and/or website (either may be missing) → background ingestion job. */
export async function startDiscoveryAction(_prev: DiscoveryStartState, formData: FormData): Promise<DiscoveryStartState> {
  const parsed = discoverySchema.safeParse({
    slug: formData.get("slug"),
    locale: formData.get("locale"),
    mapsInput: formData.get("mapsInput") || undefined,
    websiteUrl: formData.get("websiteUrl") || undefined,
    menuUrls: formData.get("menuUrls") || undefined,
  });
  if (!parsed.success) return { error: "Check the links you entered." };
  const { mapsInput, websiteUrl } = parsed.data;
  const menuUrls = (parsed.data.menuUrls ?? "")
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
  if (menuUrls.length > MAX_DIRECT_MENU_URLS) return { error: `Add up to ${MAX_DIRECT_MENU_URLS} menu links.` };
  for (const link of menuUrls) {
    try {
      parseCrawlUrl(/^https?:\/\//i.test(link) ? link : `https://${link}`);
    } catch (error) {
      return { error: `${link}: ${error instanceof Error ? error.message : "not a valid link"}` };
    }
  }
  if (!mapsInput && !websiteUrl && menuUrls.length === 0) return { error: "Add your Google Maps link, your website, or a menu link." };
  if (websiteUrl) {
    try {
      parseCrawlUrl(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Enter a valid website address." };
    }
  }
  if (mapsInput && parsePlaceInput(mapsInput).kind === "unsupported") {
    const parsedPlace = parsePlaceInput(mapsInput);
    return { error: parsedPlace.kind === "unsupported" ? parsedPlace.reason : "Check the Google Maps link." };
  }

  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const user = await requireUser(parsed.data.locale);
  const supabase = await createUserClient();
  const { count } = await supabase.from("brain_ingestion_jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
  const result = await startDiscoveryJob(supabase, {
    tenantId: tenant.id,
    userId: user.id,
    input: { mapsInput: mapsInput ?? null, websiteUrl: websiteUrl ?? null, menuUrls },
    trigger: (count ?? 0) === 0 ? "onboarding" : "manual",
  });
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
  return result.ok ? { jobId: result.jobId } : { error: result.error, jobId: result.jobId };
}

const jobRefSchema = z.object({ jobId: z.uuid(), slug: z.string().min(1), locale: z.string() });

export async function cancelDiscoveryAction(formData: FormData): Promise<void> {
  const parsed = jobRefSchema.safeParse({ jobId: formData.get("jobId"), slug: formData.get("slug"), locale: formData.get("locale") });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("brain_ingestion_jobs")
    .update({ status: "cancelled", status_reason: "Cancelled by the owner.", completed_at: new Date().toISOString() })
    .eq("id", parsed.data.jobId)
    .eq("tenant_id", tenant.id)
    .in("status", ["created", "discovering", "fetching", "extracting", "ai_processing", "normalizing", "validating", "conflict_check"]);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}

export type DiscoveryProgress = {
  status: IngestionJobStatus;
  statusReason: string | null;
  pagesProcessed: number;
  factsProposed: number;
  conflictsDetected: number;
  events: { at: string; level: string; message: string }[];
};

/** Polled by the progress panel while a job runs. RLS-scoped: only the caller's own business's job is readable. */
export async function getDiscoveryProgressAction(locale: string, slug: string, jobId: string): Promise<DiscoveryProgress | null> {
  if (!z.uuid().safeParse(jobId).success) return null;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const [{ data: job }, { data: events }] = await Promise.all([
    supabase
      .from("brain_ingestion_jobs")
      .select("status, status_reason, pages_processed, facts_proposed, conflicts_detected")
      .eq("id", jobId)
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("brain_ingestion_events")
      .select("at, level, message")
      .eq("job_id", jobId)
      .eq("tenant_id", tenant.id)
      .order("id", { ascending: false })
      .limit(8),
  ]);
  if (!job) return null;
  return {
    status: job.status,
    statusReason: job.status_reason,
    pagesProcessed: job.pages_processed,
    factsProposed: job.facts_proposed,
    conflictsDetected: job.conflicts_detected,
    events: (events ?? []).reverse(),
  };
}

const confirmFactSchema = z.object({
  entryId: z.uuid(),
  slug: z.string().min(1),
  locale: z.string(),
  value: z.string().trim().min(1).max(4000),
  name: z.string().trim().max(160).optional(),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,9}([.,]\d{1,3})?$/, "Enter a price like 18 or 18.50.")
    .optional(),
});

/**
 * "Edit & confirm": the owner's corrected value becomes a new owner-sourced
 * version of the fact (full provenance kept) and is approved — which
 * supersedes every source's candidate and resolves an open conflict.
 */
export async function confirmFactWithEditAction(formData: FormData): Promise<void> {
  const parsed = confirmFactSchema.safeParse({
    entryId: formData.get("entryId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
    value: formData.get("value") || formData.get("name"),
    name: formData.get("name") || undefined,
    amount: formData.get("amount") || undefined,
  });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { data: entry } = await supabase
    .from("business_brain_entries")
    .select("id, fact_key, entry_type, content")
    .eq("id", parsed.data.entryId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (!entry?.fact_key) return;

  const isOffering = entry.entry_type === "product_candidate" || entry.entry_type === "service_candidate";
  let content: Record<string, unknown>;
  if (isOffering) {
    const name = parsed.data.name ?? parsed.data.value;
    const amount = parsed.data.amount ? Number(parsed.data.amount.replace(",", ".")).toFixed(CURRENCY_EXPONENT[tenant.currency] ?? 2) : null;
    content = {
      normalized: { name, amount, currency: amount ? tenant.currency : null },
      display: amount ? `${name} — ${amount} ${tenant.currency}` : `${name} (price not stated)`,
    };
  } else {
    content = { normalized: parsed.data.value, display: parsed.data.value };
  }

  const { error } = await supabase.rpc("ingest_brain_fact", {
    p_tenant_id: tenant.id,
    p_fact_key: entry.fact_key,
    p_entry_type: entry.entry_type,
    p_content: content as Json,
    p_source: "manual",
    p_source_id: null,
    p_confidence_score: 100,
    p_method: "owner",
    p_model: null,
    p_job_id: null,
    p_expires_at: null,
    p_critical: false,
  });
  if (!error) {
    const { data: ownerEntry } = await supabase
      .from("business_brain_entries")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("entry_key", `${entry.fact_key}@manual`)
      .eq("status", "pending_review")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ownerEntry) await supabase.rpc("approve_brain_entry", { p_entry_id: ownerEntry.id });
    if (isOffering) await catalogApprovedFindings(supabase, tenant, parsed.data.locale, parsed.data.slug);
  }
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}

/** Entry types whose values are critical (prices, hours/open status, policies, delivery) — never bulk-approved. */
const CRITICAL_ENTRY_TYPES = ["hours", "capability", "product_candidate", "service_candidate", "policy"];

/**
 * Approves, in one click, only the discovered suggestions that are safe to
 * accept in bulk: high confidence (≥ 85), not AI-derived, not a critical
 * fact, and not part of an open conflict. Everything else stays for
 * individual review.
 */
export async function approveSafeSuggestionsAction(formData: FormData): Promise<void> {
  const parsed = z.object({ slug: z.string().min(1), locale: z.string() }).safeParse({ slug: formData.get("slug"), locale: formData.get("locale") });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const [{ data: candidates }, { data: conflicts }] = await Promise.all([
    supabase
      .from("business_brain_entries")
      .select("id, fact_key, entry_type, confidence_score, extraction_method")
      .eq("tenant_id", tenant.id)
      .eq("status", "pending_review")
      .gte("confidence_score", 85)
      .in("extraction_method", ["structured_api", "structured_data"])
      .order("confidence_score", { ascending: false }), // the most authoritative source wins per fact
    supabase.from("business_brain_conflicts").select("entry_key").eq("tenant_id", tenant.id).eq("status", "open"),
  ]);
  const conflicted = new Set((conflicts ?? []).map((c) => c.entry_key));
  const approvedKeys = new Set<string>();
  for (const c of candidates ?? []) {
    if (!c.fact_key || CRITICAL_ENTRY_TYPES.includes(c.entry_type) || conflicted.has(c.fact_key) || approvedKeys.has(c.fact_key)) continue;
    approvedKeys.add(c.fact_key); // one value per fact — a second source's candidate for the same fact waits for the owner
    await supabase.rpc("approve_brain_entry", { p_entry_id: c.id });
  }
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}

const toggleSourceSchema = z.object({
  sourceId: z.uuid(),
  isActive: z.enum(["true", "false"]),
  slug: z.string().min(1),
  locale: z.string(),
});

export async function toggleSourceActiveAction(formData: FormData): Promise<void> {
  const parsed = toggleSourceSchema.safeParse({
    sourceId: formData.get("sourceId"),
    isActive: formData.get("isActive"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("business_sources")
    .update({ is_active: parsed.data.isActive === "true" })
    .eq("id", parsed.data.sourceId);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}

const entryActionSchema = z.object({
  entryId: z.uuid(),
  slug: z.string().min(1),
  locale: z.string(),
});

export async function approveBrainEntryAction(formData: FormData): Promise<void> {
  const parsed = entryActionSchema.safeParse({
    entryId: formData.get("entryId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("approve_brain_entry", { p_entry_id: parsed.data.entryId });
  if (!error) await catalogApprovedFindings(supabase, tenant, parsed.data.locale, parsed.data.slug);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}

export async function rejectBrainEntryAction(formData: FormData): Promise<void> {
  const parsed = entryActionSchema.safeParse({
    entryId: formData.get("entryId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;
  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("reject_brain_entry", { p_entry_id: parsed.data.entryId, p_reason: null });
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}

export async function archiveBrainEntryAction(formData: FormData): Promise<void> {
  const parsed = entryActionSchema.safeParse({
    entryId: formData.get("entryId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;
  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("set_brain_entry_active", { p_entry_id: parsed.data.entryId, p_active: false });
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}

const createEntrySchema = z.object({
  tenantId: z.uuid(),
  entryType: z.enum(["about", "policy", "faq", "promotion", "instruction", "terminology", "delivery_info", "pickup_info", "payment_methods"]),
  entryKey: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/, "Use lowercase letters, numbers and hyphens."),
  text: z.string().trim().min(1).max(4000),
  locale: z.string(),
  slug: z.string().min(1),
});

/** Manual admin entry (spec §11 "add missing information"). */
export async function createBrainEntryAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createEntrySchema.safeParse({
    tenantId: formData.get("tenantId"),
    entryType: formData.get("entryType"),
    entryKey: formData.get("entryKey"),
    text: formData.get("text"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("create_brain_entry", {
    p_tenant_id: parsed.data.tenantId,
    p_entry_type: parsed.data.entryType,
    p_entry_key: parsed.data.entryKey,
    p_content: { [parsed.data.locale]: parsed.data.text },
    p_source: "manual",
    p_source_id: null,
  });
  if (error) return "VALIDATION_ERROR: could not save that entry — please try again.";

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}

const resolveConflictSchema = z.object({
  conflictId: z.uuid(),
  resolvedValueJson: z.string().min(1),
  slug: z.string().min(1),
  locale: z.string(),
});

/** Owner picks which of two disagreeing source values is correct (addendum §6, §12). */
export async function resolveBrainConflictAction(formData: FormData): Promise<void> {
  const parsed = resolveConflictSchema.safeParse({
    conflictId: formData.get("conflictId"),
    resolvedValueJson: formData.get("resolvedValueJson"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  let resolvedValue: Json;
  try {
    resolvedValue = JSON.parse(parsed.data.resolvedValueJson) as Json;
  } catch {
    return;
  }

  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("resolve_brain_conflict", { p_conflict_id: parsed.data.conflictId, p_resolved_value: resolvedValue });
  if (!error) await catalogApprovedFindings(supabase, tenant, parsed.data.locale, parsed.data.slug);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/brain`);
}
