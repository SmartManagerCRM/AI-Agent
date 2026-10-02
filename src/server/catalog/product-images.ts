import { createHash } from "node:crypto";

import { PRODUCT_IMAGE_BUCKET } from "@/lib/product-image";
import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from "@/server/brain/safe-fetch";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Product photos — found on a menu page / imported file, or uploaded by the
 * owner — are kept in our own storage, never shown from the source site:
 *
 *   1. download   SSRF-guarded (`safeFetch`, every redirect re-checked), at
 *                 most 6 MB, image content types only; or a small inline
 *                 data URI from a saved page
 *   2. check      by the file's own bytes (JPEG / PNG / WebP / GIF / AVIF —
 *                 never SVG or anything else, whatever the URL says)
 *   3. re-encode  with sharp: orientation fixed, metadata stripped, at most
 *                 1000 px, WebP — a hostile file is never stored as-is
 *   4. store      `catalog-images/<tenant>/<product>-<hash>.webp`; then the
 *                 product row is updated **with the caller's own session**, so
 *                 RLS (`catalog.write`) decides whether this user may change
 *                 this product — if not, the stored file is removed again
 *
 * The storage write uses the service role (the bucket has no write policy
 * for users), always under the product's own tenant folder.
 */

const MAX_DOWNLOAD = 6_000_000;
const MAX_EDGE = 1000;
const MAX_PIXELS = 40_000_000;

export type ImageJob = { productId: string; imageUrl: string };
/** The SSRF-guarded fetch (injectable so callers can share theirs, and tests can fake the network). */
export type ImageFetcher = (url: URL, options: SafeFetchOptions) => Promise<SafeFetchResult>;
export type ImageAttachResult = { attached: number; failed: number; skipped: number };

type SharpLike = (
  input: Buffer,
  options?: { limitInputPixels?: number; failOn?: string; animated?: boolean },
) => {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  rotate(): ReturnType<SharpLike>;
  resize(o: { width?: number; height?: number; fit?: string; withoutEnlargement?: boolean }): ReturnType<SharpLike>;
  webp(o?: { quality?: number }): ReturnType<SharpLike>;
  toBuffer(): Promise<Buffer>;
};

let sharpLoader: Promise<SharpLike | null> | null = null;
function loadSharp(): Promise<SharpLike | null> {
  sharpLoader ??= import("sharp").then((m) => (m.default ?? m) as unknown as SharpLike).catch(() => null);
  return sharpLoader;
}

/** The image format by its first bytes — the only thing trusted about an uploaded or downloaded file. */
export function sniffImage(b: Uint8Array): "jpeg" | "png" | "webp" | "gif" | "avif" | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && /^(avif|avis)$/.test(ascii(8, 12))) return "avif";
  return null;
}

/**
 * A safe, small WebP of the picture — or null when the bytes are not a
 * real raster image (or are too large / a decompression bomb).
 */
export async function normalizeImage(bytes: Uint8Array): Promise<{ data: Buffer; contentType: "image/webp" } | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOWNLOAD || !sniffImage(bytes)) return null;
  const sharp = await loadSharp();
  if (!sharp) return null; // never store an unprocessed file
  try {
    const input = Buffer.from(bytes);
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
    if (!meta.width || !meta.height || meta.width < 32 || meta.height < 32) return null; // icons, tracking pixels
    const data = await sharp(input, { limitInputPixels: MAX_PIXELS, animated: false })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return { data, contentType: "image/webp" };
  } catch {
    return null;
  }
}

/** Downloads an image reference found on a menu (http(s) URL or inline data URI). */
export async function downloadImage(ref: string, fetcher?: ImageFetcher): Promise<Uint8Array | null> {
  const data = /^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/=]+)$/i.exec(ref);
  if (data) {
    const bytes = Buffer.from(data[2], "base64");
    return bytes.byteLength <= MAX_DOWNLOAD ? new Uint8Array(bytes) : null;
  }
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const result = await (fetcher ?? safeFetch)(url, {
    binary: true,
    maxBytes: MAX_DOWNLOAD,
    timeoutMs: 8_000,
    accept: ["image/", "application/octet-stream", "binary/octet-stream"],
  });
  if (!result.ok || result.truncated || !result.data) return null;
  return result.data;
}

export type StorageWriter = {
  upload(path: string, data: Buffer, contentType: string): Promise<boolean>;
  remove(paths: string[]): Promise<void>;
};

/** The real bucket, written with the service role (see the header comment). */
export function bucketWriter(service: TypedSupabaseClient): StorageWriter {
  const bucket = service.storage.from(PRODUCT_IMAGE_BUCKET);
  return {
    async upload(path, data, contentType) {
      const { error } = await bucket.upload(path, data, { contentType, upsert: true, cacheControl: "31536000" });
      return !error;
    },
    async remove(paths) {
      if (paths.length > 0) await bucket.remove(paths);
    },
  };
}

/**
 * Stores one already-downloaded picture for a product and points the
 * product at it. `supabase` is the caller's own session: the product update
 * runs under RLS, so a user without `catalog.write` on that product changes
 * nothing (and the stored file is removed again).
 */
export async function storeProductImage(
  supabase: TypedSupabaseClient,
  storage: StorageWriter,
  tenantId: string,
  productId: string,
  bytes: Uint8Array,
  sourceUrl: string | null,
): Promise<boolean> {
  const image = await normalizeImage(bytes);
  if (!image) return false;
  const hash = createHash("sha256").update(image.data).digest("hex").slice(0, 16);
  const path = `${tenantId}/${productId}-${hash}.webp`;
  const { data: current } = await supabase
    .from("products")
    .select("image_path")
    .eq("tenant_id", tenantId)
    .eq("id", productId)
    .maybeSingle();
  if (!current) return false;
  if (current.image_path === path) return true;
  if (!(await storage.upload(path, image.data, image.contentType))) return false;
  const { data: updated } = await supabase
    .from("products")
    .update({ image_path: path, image_source_url: sourceUrl && !sourceUrl.startsWith("data:") ? sourceUrl.slice(0, 2000) : null })
    .eq("tenant_id", tenantId)
    .eq("id", productId)
    .select("id");
  if (!updated || updated.length === 0) {
    await storage.remove([path]);
    return false;
  }
  if (current.image_path && current.image_path !== path) await storage.remove([current.image_path]);
  return true;
}

/**
 * Downloads and stores the pictures found for many products, a few at a
 * time, within a time budget (whatever is left is reported, never retried
 * in a loop). The same picture used by several products is downloaded once.
 */
export async function attachProductImages(
  supabase: TypedSupabaseClient,
  storage: StorageWriter,
  tenantId: string,
  jobs: ImageJob[],
  options: { budgetMs?: number; concurrency?: number; fetcher?: ImageFetcher } = {},
): Promise<ImageAttachResult> {
  const deadline = Date.now() + (options.budgetMs ?? 30_000);
  const result: ImageAttachResult = { attached: 0, failed: 0, skipped: 0 };
  const downloads = new Map<string, Promise<Uint8Array | null>>();
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() > deadline) {
        result.skipped += 1;
        continue;
      }
      let download = downloads.get(job.imageUrl);
      if (!download) {
        download = downloadImage(job.imageUrl, options.fetcher).catch(() => null);
        downloads.set(job.imageUrl, download);
      }
      const bytes = await download;
      const ok = bytes ? await storeProductImage(supabase, storage, tenantId, job.productId, bytes, job.imageUrl).catch(() => false) : false;
      if (ok) result.attached += 1;
      else result.failed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, Math.max(jobs.length, 1)) }, worker));
  return result;
}
