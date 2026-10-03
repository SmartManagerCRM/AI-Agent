import { aiClassifyBusiness, aiExtractPage, AI_EXTRACTOR_VERSION, type AiContext, type AiPageFacts } from "./ai-extract";
import { categoryForKey, classifyFromGoogle, classifyFromSchemaTypes, type BusinessCategory, type BusinessTypeGuess } from "./business-type";
import { EXTRACTOR_VERSION, contentFingerprint, type PageExtraction } from "./extract";
import { crawlCatalog, CatalogBlockedError, type CatalogPage, type OrderingLink } from "./catalog";
import {
  factsFromCatalogPages,
  factsFromGoogle,
  factsFromMenuImages,
  factsFromWebsite,
  offeringKey,
  typeFact,
  FACTS_VERSION,
  type CatalogPageInput,
  type FactCandidate,
  type WebsitePageInput,
} from "./facts";
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
import { MENU_IMAGE_VERSION, processMenuImages, type CachedImage, type ImageOutcome, type MenuImageStats } from "./menu-images";
import { withOcrEngine } from "./ocr";
import { CATALOG_KINDS, classifyPage, kindFromUrl, type PageKind } from "./page-kind";
import type { ExtractedImage } from "./page-media";
import { computeReadiness, type Readiness } from "./readiness";
import type { PageTopic } from "./source-router";
import { canonicalizeUrl, crawlWebsite, type CrawledPage, type FetchPage } from "./website";
import { loadModelConfigs, type SelectedModel } from "@/server/ai/router";
import { draftBrainCatalog } from "@/server/catalog/brain-drafts";
import { bucketWriter } from "@/server/catalog/product-images";
import { safeFetch } from "@/server/brain/safe-fetch";
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
export type IngestionInput = {
  mapsInput?: string | null;
  websiteUrl?: string | null;
  /** Direct menu / products / services / ordering links the owner gave — each is a primary source, read deeply. */
  menuUrls?: string[] | null;
};

export const MAX_DIRECT_MENU_URLS = 5;

export type PipelineDeps = {
  places?: PlacesDeps;
  fetchPage?: FetchPage;
  /** Model chain override (tests). */
  aiChain?: (kind: "fast" | "agent") => SelectedModel[];
  /** Image downloader (tests). */
  fetchImage?: FetchPage;
  /** OCR override (tests); null disables OCR. */
  ocr?: ((image: Buffer) => Promise<import("./ocr").OcrResult | null>) | null;
  now?: () => Date;
  /**
   * Service-role client for the few columns signed-in users can't read (the
   * job's budget, model token prices — hidden by column grants). Falls back
   * to the job's own client (tests, local fixtures).
   */
  privileged?: TypedSupabaseClient;
};

const AI_TOPICS: ReadonlySet<PageTopic> = new Set(["offerings", "pricing", "policies", "ordering", "booking", "faq", "about", "hours", "home"]);
const TERMINAL: ReadonlySet<IngestionJobStatus> = new Set(["ready_for_review", "completed", "failed", "paused", "cancelled"]);
export const STALE_JOB_MINUTES = 20;

type JobUpdate = Database["public"]["Tables"]["brain_ingestion_jobs"]["Update"];
type JobRow = { id: string; tenant_id: string; status: IngestionJobStatus; input: Json; budget_usd: number };
type Tenant = { id: string; business_type_key: string; default_language: string; website_url: string | null };

class Cancelled extends Error {}

export async function runIngestionJob(supabase: TypedSupabaseClient, jobId: string, deps: PipelineDeps = {}): Promise<void> {
  const { data: job } = await (deps.privileged ?? supabase)
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
      await run.event("cancelled", "warning", "Analysis cancelled.", null, { key: "cancelled" });
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
  private pagesFetched = 0;
  private readonly startedAt = new Date().toISOString();

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
    await this.event("discovering", "info", "Analysis started.", null, { key: "started" });

    const { data: purged } = await this.supabase.rpc("purge_expired_brain_facts", { p_tenant_id: this.tenantId });
    if (purged) await this.event("discovering", "info", `Removed ${purged} expired, unconfirmed suggestion(s).`, null, { key: "purged", values: { n: purged } });

    const { data: tenant } = await this.supabase
      .from("tenants")
      .select("id, business_type_key, default_language, website_url")
      .eq("id", this.tenantId)
      .maybeSingle();
    if (!tenant) throw new Error("Business not found.");

    const input = (this.job.input ?? {}) as IngestionInput;
    const rows = await loadModelConfigs(this.deps.privileged ?? this.supabase).catch(() => []);
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

    // Direct menu/catalog links are primary sources. A "website" that is
    // really a deep menu link (/breakfast, /menu, /order, ...) is one too,
    // and the site itself is then read from its homepage.
    const menuUrls = directMenuUrls(input);
    const websiteRoot = explicitWebsite ? websiteRootOf(explicitWebsite) : null;

    // Google runs in parallel with everything else.
    const googleTask = mapsInput ? this.isolate("google", () => this.runGoogle(mapsInput, tenant as Tenant, ai)) : Promise.resolve(null);
    const menus = menuUrls.length > 0 ? await this.isolate("menu", () => this.runMenus(menuUrls, category, ai)) : null;
    const exclude = new Set(menus?.canonicals ?? []);
    const websiteTask = websiteRoot ? this.isolate("website", () => this.runWebsite(websiteRoot, category, ai, exclude)) : null;
    const google = await googleTask;
    if (google?.guess) category = google.guess.category;
    let website = websiteTask ? await websiteTask : null;
    const discoveredWebsite = !websiteRoot ? (google?.place.website ?? tenant.website_url ?? null) : null;
    if (!websiteTask && discoveredWebsite) {
      await this.event("discovering", "info", `Found the website ${discoveredWebsite}.`, null, { key: "foundWebsite", values: { url: discoveredWebsite } });
      website = await this.isolate("website", () => this.runWebsite(discoveredWebsite, category, ai, exclude));
    }
    if (!mapsInput && !explicitWebsite && !discoveredWebsite && menuUrls.length === 0) {
      await this.event("discovering", "warning", "No Google Maps link, website or menu link given — add your details manually, or connect a source.", null, { key: "noInput" });
    }
    await this.checkCancelled();

    // Menu images — from the direct menu pages, and from menu/catalog pages found on the website.
    const imagePages = [...(menus?.imagePages ?? []), ...(website?.imagePages ?? [])];
    const images = imagePages.length > 0 ? await this.isolate("menu_images", () => this.runMenuImages(imagePages, category, ai)) : null;
    if (menus) await this.saveMenuMetrics(menus, images);

    // Normalize → validate → conflict check.
    await this.setStatus("normalizing");
    const facts: FactCandidate[] = [...(google?.facts ?? [])];
    if (menus) facts.push(...factsFromCatalogPages(menus.catalogPages));
    if (images) facts.push(...factsFromMenuImages(images.outcomes.flatMap((o) => o.items)));
    if (website) {
      facts.push(...factsFromWebsite(website.pages));
      if (!google?.guess) {
        const schemaTypes = website.pages.flatMap((p) => p.extraction.business?.types ?? []);
        const guess = classifyFromSchemaTypes(schemaTypes);
        if (guess) facts.push(typeFact(guess, "website", null, website.pages[0]?.url ?? null));
      }
    }
    await this.event("normalizing", "info", `${facts.length} fact candidate(s) prepared.`, null, { key: "prepared", values: { n: facts.length } });

    await this.setStatus("validating");
    const valid = facts.filter((f) => validFact(f));
    if (valid.length < facts.length) this.warnings.push(`${facts.length - valid.length} candidate(s) failed validation and were skipped.`);

    await this.setStatus("conflict_check");
    const sourceIds: Record<FactCandidate["source"], string | null> = {
      google_business: google?.sourceId ?? null,
      website: website?.sourceId ?? null,
      online_menu: menus?.primarySourceId ?? null,
      online_ordering: menus?.orderingSourceId ?? null,
      image: menus?.primarySourceId ?? website?.sourceId ?? null,
    };
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
      null,
      { key: conflicts ? "savedWithConflicts" : "saved", values: { created, unchanged, conflicts } },
    );

    const readiness = await loadReadiness(this.supabase, this.tenantId);
    const anySource = Boolean(google) || Boolean(website) || Boolean(menus);
    const final: IngestionJobStatus = !anySource && this.errors.length > 0 && (mapsInput || explicitWebsite || menuUrls.length > 0)
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
    // What the Brain found shows up in Products & Services and Bookings right
    // away (as drafts until approved) — before the final status, whose
    // change tells open consoles to refresh.
    if (final !== "failed") {
      const added = await this.addFindingsToCatalog().catch(() => null);
      if (!added || added.failed) {
        await this.event(
          "conflict_check",
          "warning",
          "Couldn't add the products and services found to your catalog — they're still here in the Business Brain for review.",
          null,
          { key: "catalogFailed" },
        );
      }
      if (added && added.products + added.services > 0) {
        await this.event(
          "conflict_check",
          "success",
          `Added ${added.products} product(s) and ${added.services} service(s) to your catalog — as drafts until you approve them.` +
            (added.needsPrice > 0 ? ` ${added.needsPrice} were priced in another currency: set your own price on each.` : "") +
            (added.images.attached > 0 ? ` ${added.images.attached} photo(s) added.` : ""),
          null,
          { key: "catalogAdded", values: { products: added.products, services: added.services, needsPrice: added.needsPrice, photos: added.images.attached } },
        );
      }
    }

    await this.update({
      status: final,
      status_reason: reason,
      completed_at: this.now().toISOString(),
      facts_proposed: created,
      conflicts_detected: conflicts,
      sources_processed: Number(Boolean(google)) + Number(Boolean(website)) + (menus?.sourceCount ?? 0),
      readiness: readiness as unknown as Json,
      warnings: this.warnings as unknown as Json,
      errors: this.errors as unknown as Json,
    });
    await this.event(final, final === "failed" ? "error" : final === "paused" ? "warning" : "success", `Finished — Business Brain readiness ${readiness.score}%.`, {
      readiness: readiness.score,
    }, { key: "finished", values: { score: readiness.score } });
  }

  // ── Google ────────────────────────────────────────────────────────────

  private async runGoogle(mapsInput: string, tenant: Tenant, ai: AiContext) {
    if (!(this.deps.places?.apiKey ?? placesConfigured())) {
      throw new PlacesError("Google Maps import isn't configured on this platform yet.", "not_configured");
    }
    await this.event("google", "info", "Reading your Google Maps listing (official Places API).", null, { key: "readingGoogle" });
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
    }, { key: "foundGoogle", values: { name: place.name ?? "", type: guess ? (guess.label ?? guess.key) : "none" } });
    return { place, guess, sourceId, facts: factsFromGoogle(place, guess, this.now()) };
  }

  // ── Website ───────────────────────────────────────────────────────────

  private async runWebsite(rawUrl: string, category: BusinessCategory, ai: AiContext, exclude: Set<string> = new Set()) {
    const url = parseCrawlUrl(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    const origin = canonicalizeUrl(url.origin)!;
    const sourceId = await this.upsertSource("website", origin, url.toString(), null);
    await this.supabase.from("business_sources").update({ status: "crawling", processing_status: "processing", error_message: null }).eq("id", sourceId);

    await this.setStatus("fetching");
    await this.event("website", "info", `Reading ${url.hostname}.`, null, { key: "readingSite", values: { host: url.hostname } });
    let pagesFetched = 0;
    let crawl;
    try {
      crawl = await crawlWebsite(url, {
        category,
        fetchPage: this.deps.fetchPage,
        onPage: async () => {
          pagesFetched += 1;
          await this.update({ pages_processed: this.pagesFetched + pagesFetched });
        },
        shouldStop: () => this.isCancelled(),
        exclude,
      });
      this.pagesFetched += pagesFetched;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The website could not be read.";
      await this.supabase
        .from("business_sources")
        .update({ status: "failed", processing_status: /robots/i.test(message) ? "blocked" : "failed", error_message: message.slice(0, 500), last_scanned_at: this.now().toISOString() })
        .eq("id", sourceId);
      throw error;
    }
    for (const f of crawl.failed.slice(0, 5)) this.warnings.push(`Couldn't read ${f.url} (${f.reason}).`);
    if (crawl.skippedByRobots > 0) await this.event("website", "info", `${crawl.skippedByRobots} page(s) skipped as the site's robots.txt asks.`, null, { key: "robots", values: { n: crawl.skippedByRobots } });

    // Fingerprint every page; unchanged pages reuse their cached extraction (and AI result).
    await this.setStatus("extracting");
    const docs = await this.saveDocuments(sourceId, crawl.pages);
    const changed = docs.filter((d) => d.status !== "unchanged").length;
    await this.update({ documents_processed: docs.length });
    await this.event("extracting", "info", `${docs.length} page(s) read — ${changed} new or changed, ${docs.length - changed} unchanged.`, null, { key: "pagesRead", values: { n: docs.length, changed, unchanged: docs.length - changed } });

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
          await this.event("ai_processing", "warning", `Analysis budget reached — ${this.aiSkippedForBudget} page(s) kept to rule-based extraction.`, null, { key: "budget", values: { n: this.aiSkippedForBudget } });
          break;
        } else if (result.status === "skipped" && result.reason === "no_model") {
          await this.event("ai_processing", "info", "No AI model is configured — rule-based extraction only.", null, { key: "noModel" });
          break;
        } else if (result.status === "failed") {
          this.warnings.push(`AI couldn't read ${doc.page.finalUrl}.`);
        }
      }
      await this.event("ai_processing", "info", `AI read ${aiUsed} page(s) that rules couldn't fully cover.`, null, { key: "aiRead", values: { n: aiUsed } });
    } else {
      await this.event("ai_processing", "info", "No AI needed — rules covered every page.", null, { key: "noAi" });
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
    // Menu/catalog pages on the website whose text holds few prices: their images are read too.
    const imagePages = crawl.pages
      .filter((p) => {
        const kind = classifyPage(new URL(p.finalUrl), p.extraction, { linkText: p.linkText }).kind;
        return CATALOG_KINDS.has(kind) && kind !== "ONLINE_ORDERING" && p.extraction.offerings.filter((o) => o.amount).length < 3 && p.extraction.images.length > 0;
      })
      .map((p) => ({ url: p.finalUrl, images: p.extraction.images, sourceId }));
    return { sourceId, pages, imagePages };
  }

  // ── Direct menu / catalog links ──────────────────────────────────────

  private async runMenus(urls: URL[], category: BusinessCategory, ai: AiContext) {
    const catalogPages: CatalogPageInput[] = [];
    const imagePages: { url: string; images: ExtractedImage[]; sourceId: string }[] = [];
    const canonicals: string[] = [];
    const perSource: MenuSourceSummary[] = [];
    let primarySourceId: string | null = null;
    let orderingSourceId: string | null = null;
    let sourceCount = 0;

    await this.setStatus("fetching");
    for (const url of urls) {
      await this.checkCancelled();
      const canonical = canonicalizeUrl(url)!;
      const sourceId = await this.upsertSource("online_menu", canonical, url.toString(), null);
      primarySourceId ??= sourceId;
      sourceCount += 1;
      await this.supabase.from("business_sources").update({ status: "crawling", processing_status: "processing", error_message: null }).eq("id", sourceId);
      await this.event("menu", "info", `Reading the menu link ${url.toString()} (primary source).`, null, { key: "readingMenu", values: { url: url.toString() } });

      let crawl;
      try {
        crawl = await crawlCatalog(url, {
          fetchPage: this.deps.fetchPage,
          declared: "MENU",
          exclude: new Set(canonicals),
          shouldStop: () => this.isCancelled(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The menu page could not be read.";
        await this.supabase
          .from("business_sources")
          .update({ status: "failed", processing_status: error instanceof CatalogBlockedError ? "blocked" : "failed", error_message: message.slice(0, 500), last_scanned_at: this.now().toISOString() })
          .eq("id", sourceId);
        this.errors.push({ step: "menu", message: message.slice(0, 300) });
        await this.event("menu", "error", message.slice(0, 300));
        continue;
      }
      this.pagesFetched += crawl.pages.length;
      await this.update({ pages_processed: this.pagesFetched });
      const related = crawl.pages.filter((p) => p.role === "related");
      await this.event(
        "menu",
        "success",
        `Menu page read (${crawl.direct.kind.toLowerCase().replace("_", " ")}): ${crawl.direct.extraction.images.length} image(s), ${crawl.direct.extraction.offerings.length} item(s) in text; ${related.length} related menu/catalog page(s).`,
        null,
        { key: "menuRead", values: { images: crawl.direct.extraction.images.length, items: crawl.direct.extraction.offerings.length, related: related.length } },
      );
      for (const o of crawl.ordering) {
        await this.event(
          "menu",
          o.status === "read" ? "info" : "warning",
          o.status === "read" ? `Online ordering found and read: ${o.url}` : `Online ordering link found but not read: ${o.url} — ${o.reason}`,
          null,
          o.status === "read" ? { key: "orderingRead", values: { url: o.url } } : { key: "orderingNotRead", values: { url: o.url, reason: o.reason ?? "" } },
        );
      }
      if (crawl.skippedByRobots.length > 0) this.warnings.push(`${crawl.skippedByRobots.length} menu page(s) skipped as robots.txt asks.`);
      for (const f of crawl.failed.slice(0, 5)) this.warnings.push(`Couldn't read ${f.url} (${f.reason}).`);

      // Ordering pages are their own source (their prices can disagree with the menu's).
      for (const page of crawl.pages.filter((p) => p.role === "ordering")) {
        const id = await this.upsertSource("online_ordering", page.canonicalUrl, page.finalUrl, null);
        orderingSourceId ??= id;
        sourceCount += 1;
        const at = this.now().toISOString();
        await this.supabase
          .from("business_sources")
          .update({
            status: "completed",
            processing_status: "processed",
            items_processed: 1,
            last_fetched_at: at,
            last_scanned_at: at,
            last_processed_at: at,
            extraction_status: "structured",
            metrics: { kind: page.kind, products: page.extraction.offerings.length, found_via: url.toString() } as unknown as Json,
          })
          .eq("id", id);
      }

      const docs = await this.saveDocuments(sourceId, crawl.pages.map(asCrawledPage));
      await this.update({ documents_processed: (await this.countDocs()) });
      for (const page of crawl.pages) {
        canonicals.push(page.canonicalUrl);
        const doc = docs.find((d) => d.page.canonicalUrl === page.canonicalUrl);
        let aiFacts = doc?.aiCached ?? null;
        // Text-only menu pages that rules couldn't price are read by AI (images are handled separately).
        const pricedInText = page.extraction.offerings.filter((o) => o.amount).length;
        const hasImages = page.extraction.images.some((i) => !i.inChrome);
        if (!aiFacts && doc && pricedInText < 2 && !hasImages && page.extraction.text.length > 300) {
          const result = await aiExtractPage(ai, { documentId: doc.id, url: page.finalUrl, topic: "offerings", text: page.extraction.text, category });
          if (result.status === "ok") {
            aiFacts = result.value;
            await this.supabase.from("brain_source_documents").update({ extraction: serializeExtraction(page.extraction, result.value, doc.hash) }).eq("id", doc.id);
          }
        }
        catalogPages.push({ url: page.finalUrl, role: page.role, kind: page.kind, extraction: page.extraction, ai: aiFacts });
        // The direct page's images are always inspected; related pages' when they are menu/catalog pages.
        if (page.role !== "ordering" && (page.role === "direct" || CATALOG_KINDS.has(page.kind))) {
          imagePages.push({ url: page.finalUrl, images: page.extraction.images, sourceId });
        }
      }
      perSource.push({ sourceId, directUrl: url.toString(), directKind: crawl.direct.kind, related: related.map((p) => ({ url: p.finalUrl, kind: p.kind })), ordering: crawl.ordering, pages: crawl.pages });
    }
    if (primarySourceId === null) throw new Error("No menu link could be read.");
    return { catalogPages, imagePages, canonicals, primarySourceId, orderingSourceId, sourceCount, perSource };
  }

  private async runMenuImages(pages: { url: string; images: ExtractedImage[]; sourceId: string }[], category: BusinessCategory, ai: AiContext) {
    await this.setStatus("extracting");
    const sourceByPage = new Map(pages.map((p) => [p.url, p.sourceId]));
    const run = async (ocr: (image: Buffer) => Promise<import("./ocr").OcrResult | null>) =>
      processMenuImages(pages, {
        fetchImage: this.deps.fetchImage ?? this.deps.fetchPage ?? safeFetch,
        ocr,
        ai,
        category,
        shouldStop: () => this.isCancelled(),
        cacheGet: (key) => this.imageCacheGet(key),
        cachePut: (entry) => this.imageCachePut(entry, sourceByPage.get(entry.pageUrl) ?? pages[0].sourceId),
      });
    const result =
      this.deps.ocr !== undefined
        ? await run(this.deps.ocr ?? (async () => null))
        : await withOcrEngine((engine) => run((image) => engine.recognize(image)));
    const s = result.stats;
    const items = result.outcomes.reduce((n, o) => n + o.items.length, 0);
    await this.event(
      "menu_images",
      s.failed > 0 ? "warning" : "success",
      `Menu images: ${s.imagesDetected} found, ${s.menuImages} look like menus — ${s.ocrOnly} read by OCR, ${s.vision} by the vision model, ${s.unchanged} unchanged; ${items} item(s).`,
      { ...s, items },
      { key: "menuImages", values: { found: s.imagesDetected, menus: s.menuImages, ocr: s.ocrOnly, vision: s.vision, unchanged: s.unchanged, items } },
    );
    if (result.outcomes.some((o) => o.status === "skipped_budget")) this.aiSkippedForBudget += result.outcomes.filter((o) => o.status === "skipped_budget").length;
    for (const o of result.outcomes.filter((x) => x.status === "failed").slice(0, 5)) this.warnings.push(`Menu image not read: ${o.imageUrl} (${o.note ?? "error"}).`);
    return result;
  }

  private async imageCacheGet(key: string): Promise<CachedImage | null> {
    const { data } = await this.supabase
      .from("brain_source_documents")
      .select("content_hash, extraction_version, extraction")
      .eq("tenant_id", this.tenantId)
      .eq("canonical_url", `image:${key}`)
      .maybeSingle();
    const x = data?.extraction as { etag?: string | null; lastModified?: string | null; outcome?: ImageOutcome } | null;
    if (!data || !x?.outcome) return null;
    return { hash: data.content_hash ?? "", version: data.extraction_version ?? "", etag: x.etag ?? null, lastModified: x.lastModified ?? null, outcome: x.outcome };
  }

  private async imageCachePut(
    entry: { key: string; imageUrl: string; pageUrl: string; hash: string | null; etag: string | null; lastModified: string | null; outcome: ImageOutcome },
    sourceId: string,
  ) {
    const now = this.now().toISOString();
    await this.supabase.from("brain_source_documents").upsert(
      {
        tenant_id: this.tenantId,
        source_id: sourceId,
        url: entry.imageUrl,
        canonical_url: `image:${entry.key}`,
        kind: "image",
        topic: entry.outcome.class,
        title: entry.pageUrl.slice(0, 300),
        content_hash: entry.hash,
        status: entry.outcome.status === "failed" ? "failed" : entry.outcome.status === "not_menu" ? "processed" : entry.outcome.status === "unchanged" ? "unchanged" : "processed",
        extraction_version: MENU_IMAGE_VERSION,
        extraction: { etag: entry.etag, lastModified: entry.lastModified, outcome: { ...entry.outcome, status: "processed" } } as unknown as Json,
        error_message: entry.outcome.status === "failed" ? entry.outcome.note : null,
        last_fetched_at: now,
        last_processed_at: now,
      },
      { onConflict: "tenant_id,canonical_url" },
    );
  }

  private async countDocs(): Promise<number> {
    const { count } = await this.supabase
      .from("brain_source_documents")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", this.tenantId)
      .gte("last_fetched_at", this.startedAt);
    return count ?? 0;
  }

  /** What the owner sees on each menu source: images, products, categories, prices, descriptions, extraction methods. */
  private async saveMenuMetrics(menus: NonNullable<Awaited<ReturnType<JobRun["runMenus"]>>>, images: { outcomes: ImageOutcome[]; stats: MenuImageStats } | null) {
    const now = this.now().toISOString();
    for (const src of menus.perSource) {
      const pageUrls = new Set(src.pages.filter((p) => p.role !== "ordering").map((p) => p.finalUrl));
      const outcomes = (images?.outcomes ?? []).filter((o) => pageUrls.has(o.pageUrl));
      const htmlItems = src.pages.flatMap((p) => p.extraction.offerings.map((o) => ({ ...o, via: "html" as const })));
      const imageItems = outcomes.flatMap((o) => o.items);
      const cardItems = src.pages.flatMap((p) => p.extraction.cards.map((c) => ({ name: c.name, amount: null as string | null, category: c.category, description: c.description })));
      const all = [...htmlItems.map((o) => ({ name: o.name, amount: o.amount, category: o.category, description: o.description })), ...cardItems, ...imageItems];
      const byName = new Map<string, (typeof all)[number]>();
      for (const item of all) {
        const k = offeringKey(item.name);
        const prev = byName.get(k);
        if (!prev) byName.set(k, item);
        else byName.set(k, { ...prev, amount: prev.amount ?? item.amount, description: prev.description ?? item.description, category: prev.category ?? item.category });
      }
      const products = [...byName.values()];
      const metrics = {
        kind: src.directKind,
        direct_url: src.directUrl,
        analyzed_at: now,
        images_detected: src.pages.reduce((n, p) => n + (p.role === "ordering" ? 0 : p.extraction.images.length), 0),
        menu_images: outcomes.length,
        images_processed: outcomes.filter((o) => o.status === "processed" || o.status === "unchanged").length,
        images_unchanged: outcomes.filter((o) => o.status === "unchanged").length,
        images_failed: outcomes.filter((o) => o.status === "failed").length,
        products: products.length,
        categories: new Set(products.map((p) => p.category).filter(Boolean)).size,
        prices: products.filter((p) => p.amount).length,
        descriptions: products.filter((p) => p.description).length,
        extraction: {
          html: htmlItems.length > 0 || src.pages.length > 0,
          ocr: outcomes.some((o) => o.method === "ocr"),
          vision: outcomes.some((o) => o.method === "vision"),
        },
        related_pages: src.related,
        ordering: src.ordering,
      };
      await this.supabase
        .from("business_sources")
        .update({
          status: "completed",
          processing_status: "processed",
          items_processed: src.pages.length,
          last_fetched_at: now,
          last_scanned_at: now,
          last_processed_at: now,
          extraction_status: "structured",
          extraction_version: MENU_IMAGE_VERSION,
          metrics: metrics as unknown as Json,
        })
        .eq("id", src.sourceId);
    }
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

  private async upsertSource(sourceType: "website" | "google_business" | "online_menu" | "online_ordering", externalId: string, url: string | null, attribution: Record<string, unknown> | null): Promise<string> {
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

  private async addFindingsToCatalog() {
    const { data: tenant } = await this.supabase
      .from("tenants")
      .select("id, currency, default_language")
      .eq("id", this.tenantId)
      .maybeSingle();
    const storage = this.deps.privileged ? bucketWriter(this.deps.privileged) : undefined;
    // Product photos go through the same SSRF-guarded fetcher as menu images.
    return tenant ? draftBrainCatalog(this.supabase, tenant, { storage, fetchImage: this.deps.fetchImage ?? this.deps.fetchPage }) : null;
  }

  /**
   * `message` is the English text (logs, Super Admin); `i18n` names the same
   * message for the console to show in the owner's language
   * (console.discovery.event.<key>) — kept in the event's data.
   */
  async event(
    step: string,
    level: "info" | "success" | "warning" | "error",
    message: string,
    data?: Record<string, unknown> | null,
    i18n?: { key: string; values?: Record<string, string | number> },
  ) {
    const stored = i18n ? { ...(data ?? {}), i18n } : (data ?? null);
    await this.supabase
      .from("brain_ingestion_events")
      .insert({ tenant_id: this.tenantId, job_id: this.job.id, step, level, message: message.slice(0, 500), data: stored as Json });
  }

  async fail(message: string) {
    this.errors.push({ step: "job", message });
    await this.update({ status: "failed", status_reason: message, completed_at: this.now().toISOString(), errors: this.errors as unknown as Json, warnings: this.warnings as unknown as Json });
    await this.event("failed", "error", message);
  }
}

// ── Helpers (pure) ──────────────────────────────────────────────────────

type MenuSourceSummary = {
  sourceId: string;
  directUrl: string;
  directKind: PageKind;
  related: { url: string; kind: PageKind }[];
  ordering: OrderingLink[];
  pages: CatalogPage[];
};

function asCrawledPage(p: CatalogPage): CrawledPage {
  return {
    url: p.url,
    finalUrl: p.finalUrl,
    canonicalUrl: p.canonicalUrl,
    depth: p.role === "direct" ? 0 : 1,
    topic: p.role === "ordering" ? "ordering" : "offerings",
    score: p.role === "direct" ? 100 : 80,
    tier: "high",
    linkText: p.linkText ?? undefined,
    extraction: p.extraction,
    truncated: p.truncated,
  };
}

/** Menu links from the input, plus the website link itself when it is a deep menu/catalog link. */
export function directMenuUrls(input: IngestionInput): URL[] {
  const raw = [...(input.menuUrls ?? [])];
  const site = input.websiteUrl?.trim();
  if (site) {
    try {
      const u = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
      if (u.pathname.length > 1 && CATALOG_KINDS.has(kindFromUrl(u).kind)) raw.unshift(u.toString());
    } catch {
      // validated elsewhere
    }
  }
  const out: URL[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    try {
      const u = parseCrawlUrl(/^https?:\/\//i.test(r.trim()) ? r.trim() : `https://${r.trim()}`);
      const key = canonicalizeUrl(u)!;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u);
    } catch {
      // invalid links were rejected when the job was started
    }
    if (out.length >= MAX_DIRECT_MENU_URLS) break;
  }
  return out;
}

/** The site to crawl for business information: a deep menu link's own homepage. */
export function websiteRootOf(raw: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.pathname.length > 1 && CATALOG_KINDS.has(kindFromUrl(u).kind) ? u.origin + "/" : raw;
  } catch {
    return raw;
  }
}

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
