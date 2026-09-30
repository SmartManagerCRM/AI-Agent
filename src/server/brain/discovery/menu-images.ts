import { createHash } from "node:crypto";

import { aiExtractMenuImage, VISION_EXTRACTOR_VERSION, type AiContext, type VisionMenuItem } from "./ai-extract";
import type { BusinessCategory } from "./business-type";
import { EXTRACTABLE, refineWithPixels, triageImage, type ImageClass } from "./image-triage";
import { prepareImage } from "./image-prep";
import { ocrVerdict, parseMenuText } from "./menu-text";
import { isReadableName } from "./name-quality";
import { OCR_VERSION, type OcrResult } from "./ocr";
import type { ExtractedImage } from "./page-media";
import type { SafeFetchOptions, SafeFetchResult } from "../safe-fetch";

/**
 * Menu images: HTML parser → deterministic triage → OCR → vision only for
 * what OCR couldn't read → structured items with full traceability.
 * Every image is fingerprinted (SHA-256 of its bytes, plus ETag/Last-
 * Modified); an unchanged image is never re-read.
 */
export const MENU_IMAGE_VERSION = `menu-image-v1+${OCR_VERSION}+${VISION_EXTRACTOR_VERSION}`;

export const MENU_IMAGE_LIMITS = { maxImagesPerJob: 24, maxPerPage: 12, maxImageBytes: 10_000_000, timeoutMs: 15_000 };

export type MenuImageItem = Omit<VisionMenuItem, "confidence"> & {
  method: "ocr" | "vision";
  model: string | null;
  /** 0–100, after source-specific calibration. */
  confidence: number;
  imageUrl: string;
  pageUrl: string;
};

export type ImageOutcome = {
  key: string;
  imageUrl: string;
  pageUrl: string;
  class: ImageClass;
  reasons: string[];
  status: "not_menu" | "unchanged" | "processed" | "failed" | "skipped_budget" | "skipped_limit";
  method: "ocr" | "vision" | null;
  note: string | null;
  items: MenuImageItem[];
  categories: string[];
  hash: string | null;
};

export type CachedImage = { hash: string; version: string; etag: string | null; lastModified: string | null; outcome: ImageOutcome };

export type MenuImageDeps = {
  fetchImage: (url: URL, options: SafeFetchOptions) => Promise<SafeFetchResult>;
  ocr: (image: Buffer) => Promise<OcrResult | null>;
  ai: AiContext;
  category: BusinessCategory;
  cacheGet: (key: string) => Promise<CachedImage | null>;
  cachePut: (entry: { key: string; imageUrl: string; pageUrl: string; hash: string | null; etag: string | null; lastModified: string | null; outcome: ImageOutcome }) => Promise<void>;
  limits?: Partial<typeof MENU_IMAGE_LIMITS>;
  shouldStop?: () => Promise<boolean>;
};

export type MenuImageStats = {
  imagesDetected: number;
  menuImages: number;
  processed: number;
  unchanged: number;
  ocrOnly: number;
  vision: number;
  failed: number;
  skipped: number;
};

export async function processMenuImages(
  pages: { url: string; images: ExtractedImage[] }[],
  deps: MenuImageDeps,
): Promise<{ outcomes: ImageOutcome[]; stats: MenuImageStats }> {
  const limits = { ...MENU_IMAGE_LIMITS, ...deps.limits };
  const stats: MenuImageStats = { imagesDetected: 0, menuImages: 0, processed: 0, unchanged: 0, ocrOnly: 0, vision: 0, failed: 0, skipped: 0 };
  const seen = new Set<string>();
  const queue: { img: ExtractedImage; pageUrl: string; triage: ReturnType<typeof triageImage> }[] = [];

  for (const page of pages) {
    const content = page.images.filter((i) => !seen.has(i.key));
    stats.imagesDetected += content.length;
    const triaged = content
      .map((img) => ({ img, pageUrl: page.url, triage: triageImage(img, { isCatalog: true, imageCount: content.length }) }))
      .filter((t) => EXTRACTABLE.has(t.triage.class))
      .sort((a, b) => b.triage.score - a.triage.score || a.img.position - b.img.position)
      .slice(0, limits.maxPerPage);
    for (const t of triaged) {
      seen.add(t.img.key);
      queue.push(t);
    }
    for (const i of content) seen.add(i.key);
  }
  stats.menuImages = queue.length;

  const outcomes: ImageOutcome[] = [];
  for (const [index, { img, pageUrl, triage }] of queue.entries()) {
    const base: ImageOutcome = { key: img.key, imageUrl: img.url, pageUrl, class: triage.class, reasons: triage.reasons, status: "processed", method: null, note: null, items: [], categories: [], hash: null };
    if (index >= limits.maxImagesPerJob) {
      outcomes.push({ ...base, status: "skipped_limit", note: "Image limit for one analysis reached." });
      stats.skipped += 1;
      continue;
    }
    if (await deps.shouldStop?.()) break;
    const outcome = await processOne(img, pageUrl, base, deps, limits);
    outcomes.push(outcome);
    if (outcome.status === "unchanged") stats.unchanged += 1;
    else if (outcome.status === "processed") {
      stats.processed += 1;
      if (outcome.method === "ocr") stats.ocrOnly += 1;
      if (outcome.method === "vision") stats.vision += 1;
    } else if (outcome.status === "failed") stats.failed += 1;
    else if (outcome.status === "skipped_budget") stats.skipped += 1;
  }
  return { outcomes, stats };
}

async function processOne(
  img: ExtractedImage,
  pageUrl: string,
  base: ImageOutcome,
  deps: MenuImageDeps,
  limits: typeof MENU_IMAGE_LIMITS,
): Promise<ImageOutcome> {
  const cached = await deps.cacheGet(img.key);
  const fresh = cached && cached.version === MENU_IMAGE_VERSION ? cached : null;

  let url: URL;
  try {
    url = new URL(img.url);
  } catch {
    return { ...base, status: "failed", note: "Invalid image URL." };
  }
  const fetched = await deps.fetchImage(url, {
    binary: true,
    accept: ["image/"],
    maxBytes: limits.maxImageBytes,
    timeoutMs: limits.timeoutMs,
    conditional: fresh ? { etag: fresh.etag, lastModified: fresh.lastModified } : undefined,
  });
  if (!fetched.ok) return { ...base, status: "failed", note: `Download failed (${fetched.message}).` };
  if (fetched.notModified && fresh) return { ...fresh.outcome, status: "unchanged", pageUrl };
  if (!fetched.data || fetched.truncated) return { ...base, status: "failed", note: "Image too large." };

  const hash = createHash("sha256").update(fetched.data).digest("hex");
  if (fresh && fresh.hash === hash) {
    await deps.cachePut({ key: img.key, imageUrl: img.url, pageUrl, hash, etag: fetched.etag ?? null, lastModified: fetched.lastModified ?? null, outcome: fresh.outcome });
    return { ...fresh.outcome, status: "unchanged", pageUrl };
  }

  const prepared = await prepareImage(fetched.data);
  if (!prepared) return save(deps, { ...base, hash, status: "failed", note: "Unreadable image format." }, fetched);
  const refined = refineWithPixels({ class: base.class, score: 0, reasons: base.reasons }, { width: prepared.width, height: prepared.height, bytes: fetched.bytes });
  if (!EXTRACTABLE.has(refined.class)) {
    return save(deps, { ...base, hash, class: refined.class, reasons: refined.reasons, status: "not_menu", note: `Not a menu image (${refined.reasons.at(-1)}).` }, fetched);
  }

  // Step 1: OCR (free, local).
  const ocr = prepared.ocr ? await deps.ocr(prepared.ocr) : null;
  const parsed = ocr ? parseMenuText(ocr.lines.map((l) => l.text)) : null;
  const verdict = ocrVerdict(ocr, parsed);
  if (verdict.sufficient && parsed && ocr) {
    const confidence = Math.round(Math.min(78, 50 + ocr.confidence * 0.3));
    const items: MenuImageItem[] = parsed.items.filter((i) => isReadableName(i.name)).map((i) => ({
      ...emptyItem(),
      name: i.name,
      amount: i.amount,
      currency: i.currency,
      category: i.category,
      method: "ocr",
      model: null,
      confidence,
      imageUrl: img.url,
      pageUrl,
    }));
    return save(deps, { ...base, hash, status: "processed", method: "ocr", note: verdict.reason, items, categories: parsed.categories }, fetched);
  }

  // Step 2: vision, only for what OCR couldn't read.
  if (!prepared.vision) return save(deps, { ...base, hash, status: "failed", note: `${verdict.reason}; image can't be sent to the vision model.` }, fetched);
  const vision = await aiExtractMenuImage(deps.ai, {
    documentId: null,
    imageUrl: img.url,
    pageUrl,
    image: prepared.vision,
    ocrText: ocr?.text ?? null,
    category: deps.category,
  });
  if (vision.status === "ok") {
    if (!vision.value.isMenu) return save(deps, { ...base, hash, status: "not_menu", method: "vision", note: "The vision model found no menu items on this image." }, fetched);
    const items: MenuImageItem[] = vision.value.items.filter((i) => isReadableName(i.name)).map((i) => ({
      ...i,
      method: "vision",
      model: vision.value.model,
      confidence: Math.round(Math.min(72, 45 + i.confidence * 27)),
      imageUrl: img.url,
      pageUrl,
    }));
    return save(deps, { ...base, hash, status: "processed", method: "vision", note: `OCR: ${verdict.reason} → vision`, items, categories: vision.value.categories }, fetched);
  }
  // Vision unavailable: keep whatever OCR did read, clearly marked lower-confidence — not cached, so it's retried next time.
  // Without vision, only OCR lines that read as real names are kept (garbled OCR never becomes a "product").
  const partial: MenuImageItem[] = (parsed?.items ?? []).filter((i) => isReadableName(i.name)).map((i) => ({
    ...emptyItem(),
    name: i.name,
    amount: i.amount,
    currency: i.currency,
    category: i.category,
    method: "ocr",
    model: null,
    confidence: 45,
    imageUrl: img.url,
    pageUrl,
  }));
  const why = vision.status === "skipped" ? (vision.reason === "budget" ? "analysis budget reached" : vision.reason === "no_model" ? "no vision model configured" : "nothing to read") : vision.reason;
  return {
    ...base,
    hash,
    status: vision.status === "skipped" && vision.reason === "budget" ? "skipped_budget" : partial.length > 0 ? "processed" : "failed",
    method: partial.length > 0 ? "ocr" : null,
    note: `OCR: ${verdict.reason}; vision not used (${why}).`,
    items: partial,
    categories: parsed?.categories ?? [],
  };
}

async function save(deps: MenuImageDeps, outcome: ImageOutcome, fetched: Extract<SafeFetchResult, { ok: true }>): Promise<ImageOutcome> {
  await deps.cachePut({
    key: outcome.key,
    imageUrl: outcome.imageUrl,
    pageUrl: outcome.pageUrl,
    hash: outcome.hash,
    etag: fetched.etag ?? null,
    lastModified: fetched.lastModified ?? null,
    outcome,
  });
  return outcome;
}

function emptyItem(): Omit<VisionMenuItem, "name" | "amount" | "currency" | "category" | "confidence"> {
  return { secondaryName: null, description: null, variants: [], modifiers: [], size: null, ingredients: [], dietary: [], availability: null };
}
