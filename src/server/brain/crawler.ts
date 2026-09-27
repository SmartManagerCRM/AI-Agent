import "server-only";

import { createHash } from "node:crypto";

import { findBusinessJsonLd, extractPage } from "./html";
import { parseRobotsTxt, isPathAllowed, type RobotsRules } from "./robots";
import { assertSafeCrawlTarget, parseCrawlUrl, UnsafeCrawlTargetError } from "./url-safety";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Deterministic website crawler (spec §9). Everything it finds lands as
 * `pending_review` Business Brain entries (via `create_brain_entry`, source
 * "website") — never as authoritative structured data. AI-based extraction
 * (turning this raw text into draft products/policies automatically) is
 * deferred to the AI Gateway (Phase 3); this phase only gets the reviewable
 * facts in front of the owner.
 */
const MAX_PAGES = 8;
const MAX_DEPTH = 1;
const FETCH_TIMEOUT_MS = 8_000;
const MIN_DELAY_MS = 400;
const MAX_CRAWL_DELAY_MS = 2_000;
const USER_AGENT = "SmartManagerAIAgentBot/1.0 (+business-brain-onboarding)";

export type CrawlResult = { pagesCrawled: number; entriesCreated: number };

export async function runWebsiteCrawl(
  supabase: TypedSupabaseClient,
  params: { tenantId: string; sourceId: string; url: string },
): Promise<CrawlResult> {
  const { tenantId, sourceId } = params;

  await supabase.from("business_sources").update({ status: "crawling", error_message: null }).eq("id", sourceId);

  try {
    const startUrl = parseCrawlUrl(params.url);
    await assertSafeCrawlTarget(startUrl);

    const robots = await fetchRobots(startUrl);
    const delayMs = Math.min(Math.max((robots.crawlDelaySeconds ?? 0) * 1000, MIN_DELAY_MS), MAX_CRAWL_DELAY_MS);

    const visited = new Set<string>();
    const queue: { url: URL; depth: number }[] = [{ url: startUrl, depth: 0 }];
    let entriesCreated = 0;
    let pagesCrawled = 0;

    while (queue.length > 0 && pagesCrawled < MAX_PAGES) {
      const next = queue.shift();
      if (!next) break;
      const key = canonicalKey(next.url);
      if (visited.has(key)) continue;
      visited.add(key);

      if (!isPathAllowed(robots, next.url.pathname)) continue;
      if (pagesCrawled > 0) await sleep(delayMs);

      const html = await fetchText(next.url);
      if (html === null) continue;
      pagesCrawled += 1;

      const page = extractPage(html, next.url.toString());
      entriesCreated += await storePageEntries(supabase, { tenantId, sourceId, url: next.url, depth: next.depth }, page);

      if (next.depth < MAX_DEPTH) {
        for (const link of page.links) {
          let linkUrl: URL;
          try {
            linkUrl = new URL(link);
          } catch {
            continue;
          }
          if (linkUrl.hostname !== startUrl.hostname) continue;
          if (!visited.has(canonicalKey(linkUrl)) && queue.length + pagesCrawled < MAX_PAGES) {
            queue.push({ url: linkUrl, depth: next.depth + 1 });
          }
        }
      }
    }

    await supabase
      .from("business_sources")
      .update({ status: "completed", pages_crawled: pagesCrawled, last_crawled_at: new Date().toISOString() })
      .eq("id", sourceId);

    return { pagesCrawled, entriesCreated };
  } catch (error) {
    const message =
      error instanceof UnsafeCrawlTargetError || error instanceof Error ? error.message : "Crawl failed unexpectedly.";
    await supabase
      .from("business_sources")
      .update({ status: "failed", error_message: message.slice(0, 500), last_crawled_at: new Date().toISOString() })
      .eq("id", sourceId);
    throw error;
  }
}

async function storePageEntries(
  supabase: TypedSupabaseClient,
  ctx: { tenantId: string; sourceId: string; url: URL; depth: number },
  page: ReturnType<typeof extractPage>,
): Promise<number> {
  let created = 0;
  const pageKey = hash(canonicalKey(ctx.url));

  if (ctx.depth === 0 && (page.metaDescription || page.title)) {
    const { error } = await supabase.rpc("create_brain_entry", {
      p_tenant_id: ctx.tenantId,
      p_entry_type: "about",
      p_entry_key: "about",
      p_content: { text: page.metaDescription ?? page.title ?? "", title: page.title, source_url: ctx.url.toString() },
      p_source: "website",
      p_source_id: ctx.sourceId,
    });
    if (!error) created += 1;
  }

  const business = findBusinessJsonLd(page.jsonLd);
  if (business) {
    const { error } = await supabase.rpc("create_brain_entry", {
      p_tenant_id: ctx.tenantId,
      p_entry_type: "contact_note",
      p_entry_key: `contact-${pageKey}`,
      p_content: { ...business, source_url: ctx.url.toString() },
      p_source: "website",
      p_source_id: ctx.sourceId,
    });
    if (!error) created += 1;
  }

  if (page.text) {
    const { error } = await supabase.rpc("create_brain_entry", {
      p_tenant_id: ctx.tenantId,
      p_entry_type: "raw_page",
      p_entry_key: `raw-page-${pageKey}`,
      p_content: { url: ctx.url.toString(), title: page.title, text: page.text },
      p_source: "website",
      p_source_id: ctx.sourceId,
    });
    if (!error) created += 1;
  }

  return created;
}

async function fetchRobots(startUrl: URL): Promise<RobotsRules> {
  try {
    const robotsUrl = new URL("/robots.txt", startUrl.origin);
    const text = await fetchText(robotsUrl, { allowEmpty: true });
    return text ? parseRobotsTxt(text) : { disallow: [], allow: [], crawlDelaySeconds: null };
  } catch {
    return { disallow: [], allow: [], crawlDelaySeconds: null };
  }
}

async function fetchText(url: URL, options?: { allowEmpty?: boolean }): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) return options?.allowEmpty ? null : null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!options?.allowEmpty && !contentType.includes("text/html") && !contentType.includes("text/plain")) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function canonicalKey(url: URL): string {
  return `${url.origin}${url.pathname}`.replace(/\/$/, "");
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
