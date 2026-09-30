import { aiClassifyBusiness, aiExtractPage, AI_EXTRACTOR_VERSION, type AiContext, type AiPageFacts } from "./ai-extract";
import { categoryForKey, classifyFromGoogle, classifyFromSchemaTypes, type BusinessCategory, type BusinessTypeGuess } from "./business-type";
import { EXTRACTOR_VERSION, contentFingerprint, type PageExtraction } from "./extract";
import { factsFromGoogle, factsFromWebsite, typeFact, FACTS_VERSION, type FactCandidate, type WebsitePageInput } from "./facts";
import {
  fetchPlaceDetails,
  GOOGLE_ATTRIBUTION,
  parsePlaceInput,
  placesConfigured,
  PlacesError,
  resolvePlaceId,
  type PlaceDetails,
  type PlacesDeps,
} from "./google-places";
import { computeReadiness, type Readiness } from "./readiness";
import type { PageTopic } from "./source-router";
import { canonicalizeUrl, crawlWebsite, type CrawledPage, type FetchPage } from "./website";
import { loadModelConfigs, type SelectedModel } from "@/server/ai/router";
import { parseCrawlUrl, UnsafeCrawlTargetError } from "@/server/brain/url-safety";
import type { TypedSupabaseClient } from "@/server/supabase/clients";
import type { Database, IngestionJobStatus, Json } from "@/types/database";

/**
 * Business Discovery ingestion job — one run of the engine for one
 * business. Runs in the background (`after()`), as the owner who started
 * it (their user client, so RLS and `brain.write` apply to every write).
 *
 *   CREATED → DISCOVERING → FETCHING → EXTRACTING → AI_PROCESSING →
 *   NORMALIZING → VALIDATING → CONFLICT_CHECK → READY_FOR_REVIEW | COMPLETED
 *   (or FAILED / PAUSED / CANCELLED)
 *
 * Failure isolation: Google and the website run independently; one
 * failing (or a single page failing) never loses the other's results.
 */
export type IngestionInput = { mapsInput?: string | null; websiteUrl?: string | null };

export type PipelineDeps = {
  places?: PlacesDeps;
  fetchPage?: FetchPage;
  /** Model chain override (tests). */
  aiChain?: (kind: "fast" | "agent") => SelectedModel[];
  now?: () => Date;
};

const AI_TOPICS: ReadonlySet<PageTopic> = new Set(["offerings", "pricing", "policies", "ordering", "booking", "faq", "about", "hours", "home"]);
const TERMINAL: ReadonlySet<IngestionJobStatus> = new Set(["ready_for_review", "completed", "failed", "paused", "cancelled"]);
export const STALE_JOB_MINUTES = 20;

type JobUpdate = Database["public"]["Tables"]["brain_ingestion_jobs"]["Update"];
type JobRow = { id: string; tenant_id: string; status: IngestionJobStatus; input: Json; budget_usd: number };
type Tenant = { id: string; business_type_key: string; default_language: string; website_url: string | null };

class Cancelled extends Error {}

export async function runIngestionJob(supabase: TypedSupabaseClient, jobId: string, deps: PipelineDeps = {}): Promise<void> {
  const { data: job } = await supabase
    .from("brain_ingestion_jobs")
    .select("id, tenant_id, status, input, budget_usd")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.status !== "created") return;
  const run = new JobRun(supabase, job as JobRow, deps);
  try {
    await run.execute();
  } catch (error) {
    if (error instanceof Cancelled) {
      await run.event("cancelled", "warning", "Analysis cancelled.");
      return;
    }
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unexpected error.";
    await run.fail(message);
  }
}

class JobRun {
  private warnings: string[] = [];
  private errors: { step: string; message: string }[] = [];
  private budget: { limitUsd: number; spentUsd: number };
  private googleCalls = 0;
  private googleCostUsd = 0;
  private aiSkippedForBudget = 0;

  constructor(
    private supabase: TypedSupabaseClient,
    private job: JobRow,
    private deps: PipelineDeps,
  ) {
    this.budget = { limitUsd: Number(job.budget_usd) || 0.1, spentUsd: 0 };
  }

  private get tenantId() {
    return this.job.tenant_id;
  }

  async execute() {
    await this.setStatus("discovering", { started_at: this.now().toISOString() });
    await this.event("discovering", "info", "Analysis started.");

    const { data: purged } = await this.supabase.rpc("purge_expired_brain_facts", { p_tenant_id: this.tenantId });
    if (purged) await this.event("discovering", "info", `Removed ${purged} expired, unconfirmed suggestion(s).`);

    const { data: tenant } = await this.supabase
      .from("tenants")
      .select("id, business_type_key, default_language, website_url")
      .eq("id", this.tenantId)
      .maybeSingle();
    if (!tenant) throw new Error("Business not found.");

    const input = (this.job.input ?? {}) as IngestionInput;
    const rows = await loadModelConfigs(this.supabase).catch(() => []);
    const ai: AiContext = {
      rows,
      budget: this.budget,
      chain: this.deps.aiChain,
      record: async (call) => {
        const { error } = await this.supabase.rpc("record_ingestion_ai_call", {
          p_tenant_id: this.tenantId,
          p_job_id: this.job.id,
          p_source_document_id: call.documentId,
          p_purpose: call.purpose,
          p_provider: call.provider,
          p_model: call.model,
          p_input_tokens: call.inputTokens,
          p_output_tokens: call.outputTokens,
          p_estimated_cost_usd: call.costUsd,
          p_latency_ms: call.latencyMs,
          p_success: call.success,
          p_error_message: call.error,
        });
        if (error) this.warnings.push("An AI call could not be recorded.");
      },
    };

    const mapsInput = input.mapsInput?.trim() || null;
    const explicitWebsite = input.websiteUrl?.trim() || null;
    let category = categoryForKey(tenant.business_type_key);

    // Google and an explicitly given website run in parallel; a website found only through Google runs after it.
    const googleTask = mapsInput ? this.isolate("google", () => this.runGoogle(mapsInput, tenant as Tenant, ai)) : Promise.resolve(null);
    const websiteTask = explicitWebsite ? this.isolate("website", () => this.runWebsite(explicitWebsite, category, ai)) : null;
    const google = await googleTask;
    if (google?.guess) category = google.guess.category;
    let website = websiteTask ? await websiteTask : null;
    const discoveredWebsite = !explicitWebsite ? (google?.place.website ?? tenant.website_url ?? null) : null;
    if (!websiteTask && discoveredWebsite) {
      await this.event("discovering", "info", `Found the website ${discoveredWebsite}.`);
      website = await this.isolate("website", () => this.runWebsite(discoveredWebsite, category, ai));
    }
    if (!mapsInput && !explicitWebsite && !discoveredWebsite) {
      await this.event("discovering", "warning", "No Google Maps link or website given — add your details manually, or connect a source.");
    }
    await this.checkCancelled();

    // Normalize → validate → conflict check.
    await this.setStatus("normalizing");
    const facts: FactCandidate[] = [...(google?.facts ?? [])];
    if (website) {
      facts.push(...factsFromWebsite(website.pages));
      if (!google?.guess) {
        const schemaTypes = website.pages.flatMap((p) => p.extraction.business?.types ?? []);
        const guess = classifyFromSchemaTypes(schemaTypes);
        if (guess) facts.push(typeFact(guess, "website", null, website.pages[0]?.url ?? null));
      }
    }
    await this.event("normalizing", "info", `${facts.length} fact candidate(s) prepared.`);

    await this.setStatus("validating");
    const valid = facts.filter((f) => validFact(f));
    if (valid.length < facts.length) this.warnings.push(`${facts.length - valid.length} candidate(s) failed validation and were skipped.`);

    await this.setStatus("conflict_check");
    const sourceIds = { google_business: google?.sourceId ?? null, website: website?.sourceId ?? null };
    let created = 0;
    let unchanged = 0;
    let conflicts = 0;
    let failed = 0;
    for (const fact of valid) {
      const { data, error } = await this.supabase.rpc("ingest_brain_fact", {
        p_tenant_id: this.tenantId,
        p_fact_key: fact.factKey,
        p_entry_type: fact.entryType,
        p_content: fact.content as unknown as Json,
        p_source: fact.source,
        p_source_id: sourceIds[fact.source],
        p_confidence_score: fact.confidence,
        p_method: fact.method,
        p_model: fact.model,
        p_job_id: this.job.id,
        p_expires_at: fact.expiresAt,
        p_critical: fact.critical,
      });
      if (error) failed += 1;
      else if (data === "unchanged") unchanged += 1;
      else if (data === "conflict") {
        conflicts += 1;
        created += 1;
      } else created += 1;
    }
    if (failed > 0) this.errors.push({ step: "conflict_check", message: `${failed} fact(s) could not be saved.` });
    await this.event(
      "conflict_check",
      conflicts > 0 ? "warning" : "success",
      `${created} new or changed, ${unchanged} unchanged${conflicts ? `, ${conflicts} conflicting with another source` : ""}.`,
    );

    const readiness = await loadReadiness(this.supabase, this.tenantId);
    const anySource = Boolean(google) || Boolean(website);
    const final: IngestionJobStatus = !anySource && this.errors.length > 0 && (mapsInput || explicitWebsite)
      ? "failed"
      : this.aiSkippedForBudget > 0
        ? "paused"
        : created > 0 || conflicts > 0
          ? "ready_for_review"
          : "completed";
    const reason =
      final === "paused"
        ? `The analysis budget was reached; ${this.aiSkippedForBudget} page(s) were read without AI. Run the analysis again to continue.`
        : final === "failed"
          ? (this.errors[0]?.message ?? "No source could be read.")
          : null;
    await this.update({
      status: final,
      status_reason: reason,
      completed_at: this.now().toISOString(),
      facts_proposed: created,
      conflicts_detected: conflicts,
      sources_processed: Number(Boolean(google)) + Number(Boolean(website)),
      readiness: readiness as unknown as Json,
      warnings: this.warnings as unknown as Json,
      errors: this.errors as unknown as Json,
    });
    await this.event(final, final === "failed" ? "error" : final === "paused" ? "warning" : "success", `Finished — Business Brain readiness ${readiness.score}%.`, {
      readiness: readiness.score,
    });
  }

  // ── Google ────────────────────────────────────────────────────────────

  private async runGoogle(mapsInput: string, tenant: Tenant, ai: AiContext) {
    if (!(this.deps.places?.apiKey ?? placesConfigured())) {
      throw new PlacesError("Google Maps import isn't configured on this platform yet.", "not_configured");
    }
    await this.event("google", "info", "Reading your Google Maps listing (official Places API).");
    const usage = { calls: 0, estimatedCostUsd: 0 };
    let place: PlaceDetails;
    try {
      const placeId = await resolvePlaceId(parsePlaceInput(mapsInput), usage, this.deps.places);
      place = await fetchPlaceDetails(placeId, usage, { languageCode: tenant.default_language }, this.deps.places);
    } finally {
      this.googleCalls += usage.calls;
      this.googleCostUsd += usage.estimatedCostUsd;
      this.budget.spentUsd += usage.estimatedCostUsd;
      await this.update({ google_calls: this.googleCalls, google_cost_usd: round6(this.googleCostUsd) });
    }

    // Only the Place ID is stored as a source reference (it may be kept indefinitely); the Places content itself is not persisted raw.
    const sourceId = await this.upsertSource("google_business", place.placeId, place.mapsUri, {
      ...GOOGLE_ATTRIBUTION,
      place_id: place.placeId,
    });
    await this.update({ place_id: place.placeId });

    let guess: BusinessTypeGuess | null = classifyFromGoogle({ primaryType: place.primaryType, types: place.types, label: place.primaryTypeLabel });
    if (!guess) {
      const result = await aiClassifyBusiness(ai, { name: place.name, description: null, googleTypes: place.types, websiteTitle: null });
      if (result.status === "ok") guess = result.value;
    }
    if (guess) await this.update({ detected_business_type: guess.key });
    if (place.businessStatus && place.businessStatus !== "OPERATIONAL") {
      this.warnings.push(`Google lists this business as ${place.businessStatus.replace(/_/g, " ").toLowerCase()}.`);
    }

    await this.supabase
      .from("business_sources")
      .update({
        status: "completed",
        processing_status: "processed",
        last_fetched_at: this.now().toISOString(),
        last_processed_at: this.now().toISOString(),
        last_scanned_at: this.now().toISOString(),
        extraction_version: FACTS_VERSION,
        error_message: null,
      })
      .eq("id", sourceId);
    await this.event("google", "success", `Found "${place.name ?? "your business"}" on Google Maps${guess ? ` (${guess.label ?? guess.key})` : ""}.`, {
      calls: usage.calls,
      estimated_cost_usd: round6(usage.estimatedCostUsd),
    });
    return { place, guess, sourceId, facts: factsFromGoogle(place, guess, this.now()) };
  }

  // ── Website ───────────────────────────────────────────────────────────

  private async runWebsite(rawUrl: string, category: BusinessCategory, ai: AiContext) {
    const url = parseCrawlUrl(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    const origin = canonicalizeUrl(url.origin)!;
    const sourceId = await this.upsertSource("website", origin, url.toString(), null);
    await this.supabase.from("business_sources").update({ status: "crawling", processing_status: "processing", error_message: null }).eq("id", sourceId);

    await this.setStatus("fetching");
    await this.event("website", "info", `Reading ${url.hostname}.`);
    let pagesFetched = 0;
    let crawl;
    try {
      crawl = await crawlWebsite(url, {
        category,
        fetchPage: this.deps.fetchPage,
        onPage: async () => {
          pagesFetched += 1;
          await this.update({ pages_processed: pagesFetched });
        },
        shouldStop: () => this.isCancelled(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The website could not be read.";
      await this.supabase
        .from("business_sources")
        .update({ status: "failed", processing_status: /robots/i.test(message) ? "blocked" : "failed", error_message: message.slice(0, 500), last_scanned_at: this.now().toISOString() })
        .eq("id", sourceId);
      throw error;
    }
    for (const f of crawl.failed.slice(0, 5)) this.warnings.push(`Couldn't read ${f.url} (${f.reason}).`);
    if (crawl.skippedByRobots > 0) await this.event("website", "info", `${crawl.skippedByRobots} page(s) skipped as the site's robots.txt asks.`);

    // Fingerprint every page; unchanged pages reuse their cached extraction (and AI result).
    await this.setStatus("extracting");
    const docs = await this.saveDocuments(sourceId, crawl.pages);
    const changed = docs.filter((d) => d.status !== "unchanged").length;
    await this.update({ documents_processed: docs.length });
    await this.event("extracting", "info", `${docs.length} page(s) read — ${changed} new or changed, ${docs.length - changed} unchanged.`);

    // Gated AI: only pages with a gap deterministic extraction couldn't fill, best pages first, within budget.
    await this.checkCancelled();
    const needsAi = docs
      .filter((d) => d.aiCached === null && AI_TOPICS.has(d.page.topic) && aiGap(d.page.topic, d.page.extraction, crawl.pages.length))
      .sort((a, b) => b.page.score - a.page.score);
    if (needsAi.length > 0) {
      await this.setStatus("ai_processing");
      let aiUsed = 0;
      for (const doc of needsAi) {
        await this.checkCancelled();
        const result = await aiExtractPage(ai, { documentId: doc.id, url: doc.page.finalUrl, topic: doc.page.topic, text: doc.page.extraction.text, category });
        if (result.status === "ok") {
          doc.aiCached = result.value;
          aiUsed += 1;
          await this.supabase
            .from("brain_source_documents")
            .update({ extraction: serializeExtraction(doc.page.extraction, result.value, doc.hash) })
            .eq("id", doc.id);
        } else if (result.status === "skipped" && result.reason === "budget") {
          this.aiSkippedForBudget = needsAi.length - needsAi.indexOf(doc);
          await this.event("ai_processing", "warning", `Analysis budget reached — ${this.aiSkippedForBudget} page(s) kept to rule-based extraction.`);
          break;
        } else if (result.status === "skipped" && result.reason === "no_model") {
          await this.event("ai_processing", "info", "No AI model is configured — rule-based extraction only.");
          break;
        } else if (result.status === "failed") {
          this.warnings.push(`AI couldn't read ${doc.page.finalUrl}.`);
        }
      }
      await this.event("ai_processing", "info", `AI read ${aiUsed} page(s) that rules couldn't fully cover.`);
    } else {
      await this.event("ai_processing", "info", "No AI needed — rules covered every page.");
    }

    const now = this.now().toISOString();
    await this.supabase
      .from("business_sources")
      .update({
        status: "completed",
        processing_status: changed > 0 ? "changed" : "unchanged",
        items_processed: docs.length,
        last_fetched_at: now,
        last_scanned_at: now,
        last_processed_at: now,
        ...(changed > 0 ? { last_changed_at: now } : {}),
        extraction_status: "structured",
        extraction_version: `${EXTRACTOR_VERSION}+${AI_EXTRACTOR_VERSION}`,
      })
      .eq("id", sourceId);

    const pages: WebsitePageInput[] = docs.map((d) => ({ url: d.page.finalUrl, topic: d.page.topic, score: d.page.score, extraction: d.page.extraction, ai: d.aiCached }));
    return { sourceId, pages };
  }

  private async saveDocuments(sourceId: string, pages: CrawledPage[]) {
    const canonicals = pages.map((p) => p.canonicalUrl);
    const { data: existing } = await this.supabase
      .from("brain_source_documents")
      .select("id, canonical_url, content_hash, extraction_version, extraction")
      .eq("tenant_id", this.tenantId)
      .in("canonical_url", canonicals);
    const byCanonical = new Map((existing ?? []).map((d) => [d.canonical_url, d]));
    const now = this.now().toISOString();

    const out: { id: string; page: CrawledPage; hash: string; status: "new" | "changed" | "unchanged"; aiCached: AiPageFacts | null }[] = [];
    for (const page of pages) {
      const hash = contentFingerprint(page.extraction);
      const previous = byCanonical.get(page.canonicalUrl);
      const sameContent = previous?.content_hash === hash && previous.extraction_version === EXTRACTOR_VERSION;
      const status = !previous ? "new" : sameContent ? "unchanged" : "changed";
      const cachedAi = sameContent ? cachedAiFrom(previous?.extraction, hash) : null;
      const row = {
        tenant_id: this.tenantId,
        source_id: sourceId,
        url: page.finalUrl,
        canonical_url: page.canonicalUrl,
        kind: "page" as const,
        topic: page.topic,
        priority_score: page.score,
        title: page.extraction.title?.slice(0, 300) ?? null,
        content_hash: hash,
        status: (status === "unchanged" ? "unchanged" : "processed") as "unchanged" | "processed",
        extraction_version: EXTRACTOR_VERSION,
        extraction: serializeExtraction(page.extraction, cachedAi, hash),
        error_message: page.truncated ? "Page was larger than the size limit; only the first part was read." : null,
        last_fetched_at: now,
        last_processed_at: now,
        ...(status !== "unchanged" ? { last_changed_at: now } : {}),
      };
      const { data, error } = await this.supabase
        .from("brain_source_documents")
        .upsert(row, { onConflict: "tenant_id,canonical_url" })
        .select("id")
        .single();
      if (error || !data) {
        this.warnings.push(`Couldn't save ${page.finalUrl}.`);
        continue;
      }
      out.push({ id: data.id, page, hash, status, aiCached: cachedAi });
    }
    return out;
  }

  private async upsertSource(sourceType: "website" | "google_business", externalId: string, url: string | null, attribution: Record<string, unknown> | null): Promise<string> {
    const { data: existing } = await this.supabase
      .from("business_sources")
      .select("id")
      .eq("tenant_id", this.tenantId)
      .eq("source_type", sourceType)
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) {
      await this.supabase.from("business_sources").update({ url, attribution: attribution as Json, is_active: true }).eq("id", existing.id);
      return existing.id;
    }
    const { data, error } = await this.supabase
      .from("business_sources")
      .insert({ tenant_id: this.tenantId, source_type: sourceType, external_id: externalId, url, attribution: attribution as Json, status: "pending", processing_status: "new" })
      .select("id")
      .single();
    if (error || !data) throw new Error("Could not register the source.");
    return data.id;
  }

  // ── Plumbing ──────────────────────────────────────────────────────────

  private async isolate<T>(step: string, work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      const message =
        error instanceof PlacesError || error instanceof UnsafeCrawlTargetError || error instanceof Error ? error.message : "Unexpected error.";
      this.errors.push({ step, message: message.slice(0, 300) });
      await this.event(step, "error", message.slice(0, 300));
      return null;
    }
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private async isCancelled(): Promise<boolean> {
    const { data } = await this.supabase.from("brain_ingestion_jobs").select("status").eq("id", this.job.id).maybeSingle();
    return data?.status === "cancelled";
  }

  private async checkCancelled() {
    if (await this.isCancelled()) throw new Cancelled();
  }

  private async setStatus(status: IngestionJobStatus, extra: JobUpdate = {}) {
    await this.checkCancelled();
    await this.update({ status, ...extra });
  }

  private async update(values: JobUpdate) {
    await this.supabase.from("brain_ingestion_jobs").update(values).eq("id", this.job.id).neq("status", "cancelled");
  }

  async event(step: string, level: "info" | "success" | "warning" | "error", message: string, data?: Record<string, unknown>) {
    await this.supabase
      .from("brain_ingestion_events")
      .insert({ tenant_id: this.tenantId, job_id: this.job.id, step, level, message: message.slice(0, 500), data: (data ?? null) as Json });
  }

  async fail(message: string) {
    this.errors.push({ step: "job", message });
    await this.update({ status: "failed", status_reason: message, completed_at: this.now().toISOString(), errors: this.errors as unknown as Json, warnings: this.warnings as unknown as Json });
    await this.event("failed", "error", message);
  }
}

// ── Helpers (pure) ──────────────────────────────────────────────────────

/** Whether a page has a gap that deterministic extraction left and AI might fill. */
export function aiGap(topic: PageTopic, x: PageExtraction, pageCount: number): boolean {
  switch (topic) {
    case "offerings":
    case "pricing":
      return x.offerings.filter((o) => o.amount).length < 2;
    case "policies":
    case "ordering":
    case "booking":
      return true; // policies/terms are prose — no rule-based extractor
    case "faq":
      return x.faqs.length === 0;
    case "about":
      return !x.description && !x.business?.description;
    case "hours":
      return !x.business?.hours;
    case "home":
      // A one-page site: the homepage is all there is.
      return pageCount === 1 && (x.offerings.length < 2 || !x.business?.hours);
    default:
      return false;
  }
}

function validFact(f: FactCandidate): boolean {
  if (!/^[a-z0-9][a-z0-9_.:-]{0,118}$/.test(f.factKey)) return false;
  if (!f.content.display || String(f.content.display).length > 4000) return false;
  if (f.confidence < 0 || f.confidence > 100) return false;
  return true;
}

function serializeExtraction(x: PageExtraction, ai: AiPageFacts | null, hash: string): Json {
  // The page text and link list are not stored — only what was extracted from them.
  const { text: _text, links: _links, ...rest } = x;
  return { ...rest, text_length: x.text.length, ai: ai ? { ...ai, content_hash: hash } : null } as unknown as Json;
}

function cachedAiFrom(extraction: Json | null | undefined, hash: string): AiPageFacts | null {
  const ai = (extraction as { ai?: (AiPageFacts & { content_hash?: string }) | null } | null)?.ai;
  return ai && ai.content_hash === hash && ai.version === AI_EXTRACTOR_VERSION ? ai : null;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export async function loadReadiness(supabase: TypedSupabaseClient, tenantId: string): Promise<Readiness> {
  const [{ data: facts }, { data: conflicts }, { data: products }, { data: branches }] = await Promise.all([
    supabase
      .from("business_brain_entries")
      .select("fact_key, entry_type, status, content")
      .eq("tenant_id", tenantId)
      .in("status", ["approved", "pending_review"])
      .eq("is_active", true),
    supabase.from("business_brain_conflicts").select("entry_key").eq("tenant_id", tenantId).eq("status", "open"),
    supabase.from("products").select("price_minor").eq("tenant_id", tenantId).eq("status", "active"),
    supabase.from("branches").select("phone, opening_hours").eq("tenant_id", tenantId).eq("is_active", true),
  ]);
  return computeReadiness({
    facts: facts ?? [],
    openConflictKeys: (conflicts ?? []).map((c) => c.entry_key),
    activeProducts: products?.length ?? 0,
    pricedProducts: (products ?? []).filter((p) => p.price_minor > 0).length,
    branchesWithHours: (branches ?? []).filter((b) => b.opening_hours && Object.keys(b.opening_hours as object).length > 0).length,
    branchesWithPhone: (branches ?? []).filter((b) => Boolean(b.phone)).length,
  });
}

export function isTerminal(status: IngestionJobStatus): boolean {
  return TERMINAL.has(status);
}
