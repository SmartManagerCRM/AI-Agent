import type * as cheerio from "cheerio";

import type { ExtractedOffering } from "./extract";

/**
 * Everything on a page beyond its text that can carry catalog information:
 * images (a menu is often *only* images), headings, OpenGraph data and
 * catalog data embedded as JSON in the page. Pure — parses markup only.
 */
export type ImageSourceKind = "img" | "picture" | "background" | "og" | "json";

export type ExtractedImage = {
  /** Absolute URL of the best (largest/original) rendition to download. */
  url: string;
  /** Identity of the image regardless of resize parameters — the dedupe/fingerprint key. */
  key: string;
  alt: string | null;
  title: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  /** Nearest preceding heading (menu section / category context). */
  context: string | null;
  /** href when the image is wrapped in a link. */
  link: string | null;
  source: ImageSourceKind;
  /** Inside header/footer/nav — page chrome (logos, icons), not content. */
  inChrome: boolean;
  /** DOM order on the page (menus are usually shown in order). */
  position: number;
};

export type ProductCard = { name: string; description: string | null; category: string | null; imageUrl?: string | null };

export type PageMedia = {
  headings: string[];
  /** Item cards (title + description) — on a menu/catalog page, product names even when no price is shown. */
  cards: ProductCard[];
  og: { title: string | null; description: string | null; image: string | null; siteName: string | null };
  images: ExtractedImage[];
  embeddedOfferings: ExtractedOffering[];
};

const MAX_IMAGES = 80;
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|bmp|svg)(?=$|[?#/])/i;

export function extractPageMedia($: cheerio.CheerioAPI, base: URL | null): PageMedia {
  const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();
  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => {
    const t = clean($(el).text());
    if (t && t.length <= 120 && headings.length < 40) headings.push(t);
  });

  const meta = (p: string) => clean($(`meta[property="${p}"]`).attr("content") ?? $(`meta[name="${p}"]`).attr("content")) || null;
  const og = { title: meta("og:title"), description: meta("og:description"), image: meta("og:image"), siteName: meta("og:site_name") };

  const images = new Map<string, ExtractedImage>();
  let position = 0;
  const add = (raw: string | undefined, info: Omit<ExtractedImage, "url" | "key" | "position" | "width" | "height"> & { width?: number | null; height?: number | null }) => {
    if (!raw || images.size >= MAX_IMAGES) return;
    const resolved = resolveImageUrl(raw.trim(), base);
    if (!resolved) return;
    const { url, key, width, height } = resolved;
    const existing = images.get(key);
    if (existing) {
      // The same picture seen twice: keep the richest description of it.
      existing.alt ??= info.alt;
      existing.title ??= info.title;
      existing.caption ??= info.caption;
      existing.width ??= info.width ?? width;
      existing.height ??= info.height ?? height;
      if (existing.source === "json" && info.source !== "json") existing.source = info.source;
      existing.inChrome = existing.inChrome && info.inChrome;
      return;
    }
    images.set(key, { ...info, url, key, width: info.width ?? width, height: info.height ?? height, position: position++ });
  };

  const contextOf = (el: Parameters<typeof $>[0]) => {
    const heading = $(el).closest("section, article, div").prevAll("h1, h2, h3, h4").first().text() || $(el).prevAll("h1, h2, h3, h4").first().text();
    const t = clean(heading);
    return t && t.length <= 80 ? t : null;
  };
  const chrome = (el: Parameters<typeof $>[0]) => $(el).closest("header, footer, nav, [role=navigation], [role=banner]").length > 0;

  $("img, picture source").each((_, el) => {
    const node = $(el);
    const isSource = el.tagName === "source";
    const img = isSource ? node.closest("picture").find("img").first() : node;
    const candidates = [
      bestFromSrcset(node.attr("srcset") ?? node.attr("data-srcset")),
      node.attr("data-src"),
      node.attr("data-lazy-src"),
      node.attr("data-original"),
      node.attr("src"),
    ].filter((c): c is string => Boolean(c && !c.startsWith("data:")));
    const figure = node.closest("figure");
    add(candidates[0], {
      alt: clean(img.attr("alt")) || null,
      title: clean(img.attr("title")) || clean(node.closest("[title]").attr("title")) || null,
      caption: clean(figure.find("figcaption").first().text()) || clean(img.attr("aria-label")) || null,
      width: toInt(img.attr("width")),
      height: toInt(img.attr("height")),
      context: contextOf(el),
      link: node.closest("a[href]").attr("href") ?? null,
      source: isSource ? "picture" : "img",
      inChrome: chrome(el),
    });
  });

  $("[style*='background']").each((_, el) => {
    const style = $(el).attr("style") ?? "";
    for (const m of style.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      add(m[2], {
        alt: clean($(el).attr("aria-label")) || null,
        title: clean($(el).attr("title")) || null,
        caption: null,
        context: contextOf(el),
        link: $(el).closest("a[href]").attr("href") ?? null,
        source: "background",
        inChrome: chrome(el),
      });
    }
  });

  if (og.image) add(og.image, { alt: og.title, title: null, caption: null, context: null, link: null, source: "og", inChrome: false });

  // Images referenced only from embedded page data (JS-rendered galleries).
  const embeddedOfferings: ExtractedOffering[] = [];
  $('script[type="application/json"], script#__NEXT_DATA__, script:not([src])').each((_, el) => {
    const type = $(el).attr("type") ?? "";
    if (type === "application/ld+json") return;
    const body = $(el).contents().text();
    if (body.length < 20 || body.length > 3_000_000) return;
    for (const m of body.matchAll(/https?:\\?\/\\?\/[^"'\s<>\\]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s<>\\]*)?/gi)) {
      add(m[0].replace(/\\\//g, "/"), { alt: null, title: null, caption: null, context: null, link: null, source: "json", inChrome: false });
      if (images.size >= MAX_IMAGES) break;
    }
    if (type === "application/json" || $(el).attr("id") === "__NEXT_DATA__") {
      try {
        embeddedOfferings.push(...offeringsFromEmbeddedJson(JSON.parse(body)));
      } catch {
        // not JSON we can read
      }
    }
  });

  return { headings, cards: extractCards($, base), og, images: [...images.values()], embeddedOfferings: embeddedOfferings.slice(0, 300) };
}

// ── A product's own picture ─────────────────────────────────────────────

/** Inline images small enough to keep (base64 data URIs in saved pages). */
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;
const MAX_DATA_URI = 7_000_000;
/** Page chrome and placeholders — never a product's photo. */
const NOT_A_PHOTO = /(sprite|icon|logo|placeholder|spinner|loading|blank|pixel|spacer|avatar|badge|flag)/i;

/**
 * Turns an image reference found on a product into a URL the server can
 * download: an absolute http(s) URL (resolved against the page), or a
 * small inline data URI. SVGs, page chrome and unresolvable relative paths
 * (a file with no address to resolve against) give null.
 */
export function productImageRef(raw: string | undefined | null, base: URL | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.startsWith("data:")) return value.length <= MAX_DATA_URI && DATA_IMAGE.test(value) ? value.replace(/\s+/g, "") : null;
  let u: URL;
  try {
    u = new URL(value, base ?? undefined);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.hostname.endsWith(".invalid")) return null; // relative path in a file with no web address
  if (/\.svg$/i.test(u.pathname) || NOT_A_PHOTO.test(u.pathname)) return null;
  u.hash = "";
  return u.toString();
}

/** The picture inside one product element (img / picture / lazy-load attributes / background image). */
export function imageInElement($: cheerio.CheerioAPI, el: unknown, base: URL | null): string | null {
  const node = $(el as never);
  for (const img of node.find("img, picture source").toArray()) {
    const i = $(img);
    if (i.closest("header, footer, nav").length > 0) continue;
    const width = toInt(i.attr("width"));
    if (width !== null && width < 48) continue; // icons
    const raw = [
      bestFromSrcset(i.attr("srcset") ?? i.attr("data-srcset")),
      i.attr("data-src"),
      i.attr("data-lazy-src"),
      i.attr("data-original"),
      i.attr("src"),
    ].find((c) => c && c.trim() && !/^data:image\/(gif|svg)/i.test(c.trim()) && c.trim() !== "#");
    const ref = productImageRef(raw, base);
    if (ref) return ref;
  }
  for (const styled of [node.toArray()[0], ...node.find("[style*='background']").toArray()]) {
    const style = styled ? ($(styled as never).attr("style") ?? "") : "";
    const m = /url\((['"]?)([^'")]+)\1\)/.exec(style);
    const ref = m ? productImageRef(m[2], base) : null;
    if (ref) return ref;
  }
  return null;
}

/** An image field of embedded catalog data ("image", "imageUrl", { url }, [..]) — absolute URLs only. */
export function imageFromJson(obj: Record<string, unknown>): string | null {
  for (const k of ["image", "imageUrl", "image_url", "imageURL", "photo", "photoUrl", "picture", "thumbnail", "thumbnailUrl", "img"]) {
    let v: unknown = obj[k];
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === "object") v = (v as Record<string, unknown>).url ?? (v as Record<string, unknown>).src ?? (v as Record<string, unknown>).contentUrl;
    if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) {
      const ref = productImageRef(v, null);
      if (ref) return ref;
    }
  }
  return null;
}

// ── Image URLs ──────────────────────────────────────────────────────────

/**
 * Resolves an image reference to (download URL, identity key). CDN resize
 * variants of one picture share a key, and — where the CDN serves the
 * original at a stable URL (Wix) — the original is downloaded instead of a
 * thumbnail, which is what makes the text on a menu image legible.
 */
export function resolveImageUrl(raw: string, base: URL | null): { url: string; key: string; width: number | null; height: number | null } | null {
  let u: URL;
  try {
    u = new URL(raw, base ?? undefined);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  const host = u.hostname.toLowerCase();

  // Wix: static.wixstatic.com/media/<id>~mv2.jpg/v1/fill/w_980,h_1386,.../<name>.jpg
  if (host.endsWith("wixstatic.com")) {
    const m = /^\/media\/([^/]+\.(?:jpe?g|png|webp|gif))(\/v1\/[^/]+\/([^/]+))?/i.exec(u.pathname);
    if (m) {
      const dims = m[3] ?? "";
      return {
        url: `https://${host}/media/${m[1]}`,
        key: `wix:${m[1]}`,
        width: toInt(/(?:^|,)w_(\d+)/.exec(dims)?.[1]),
        height: toInt(/(?:^|,)h_(\d+)/.exec(dims)?.[1]),
      };
    }
  }
  if (!IMAGE_EXT.test(u.pathname) && !/\/(image|images|media|uploads|photos?)\//i.test(u.pathname) && !u.searchParams.has("format")) {
    return null;
  }
  // Shopify-style size suffixes: name_600x800.jpg → name.jpg
  const shopify = /_(\d+)x(\d+)(?=\.(?:jpe?g|png|webp)$)/i.exec(u.pathname);
  const width = shopify ? toInt(shopify[1]) : toInt(u.searchParams.get("w") ?? u.searchParams.get("width"));
  const height = shopify ? toInt(shopify[2]) : toInt(u.searchParams.get("h") ?? u.searchParams.get("height"));
  const keyUrl = new URL(u.toString());
  for (const p of ["w", "h", "width", "height", "q", "quality", "fit", "auto", "format", "fm", "dpr", "v", "ver"]) keyUrl.searchParams.delete(p);
  keyUrl.pathname = keyUrl.pathname.replace(/_(\d+)x(\d+)(?=\.(?:jpe?g|png|webp)$)/i, "");
  return { url: u.toString(), key: `${host}${keyUrl.pathname}${keyUrl.search}`, width, height };
}

/** Largest candidate of a srcset ("a.jpg 480w, b.jpg 1080w" → b.jpg). */
export function bestFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  let best: { url: string; size: number } | null = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, descriptor = "1x"] = part.trim().split(/\s+/);
    const n = Number.parseFloat(descriptor);
    const size = descriptor.endsWith("w") ? n : n * 1000;
    if (url && (!best || size > best.size)) best = { url, size };
  }
  return best?.url;
}

function toInt(v: string | null | undefined): number | null {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Embedded catalog JSON (ordering/catalog apps) ────────────────────────

const NAME_KEYS = ["name", "title", "productName", "itemName", "name_en", "nameEn"];
const PRICE_KEYS = ["price", "basePrice", "base_price", "unitPrice", "unit_price", "amount", "salePrice", "sale_price", "priceAmount"];
const CURRENCY_KEYS = ["currency", "currencyCode", "currency_code", "priceCurrency"];

/**
 * Walks embedded page data for product-shaped objects: a name plus a
 * numeric price. The currency is taken only when the data states it.
 */
export function offeringsFromEmbeddedJson(root: unknown): ExtractedOffering[] {
  const out: ExtractedOffering[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number, category: string | null) => {
    if (out.length >= 300 || depth > 12 || !node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1, category);
      return;
    }
    const obj = node as Record<string, unknown>;
    const name = pickString(obj, NAME_KEYS);
    const priceRaw = pickValue(obj, PRICE_KEYS);
    const price = typeof priceRaw === "number" ? priceRaw : typeof priceRaw === "string" && /^\d+([.,]\d{1,3})?$/.test(priceRaw.trim()) ? Number(priceRaw.replace(",", ".")) : null;
    if (name && name.length <= 120 && price !== null && price > 0 && price < 100_000) {
      const currencyRaw = pickString(obj, CURRENCY_KEYS);
      const currency = currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw) ? currencyRaw.toUpperCase() : null;
      out.push({
        name,
        amount: currency ? price.toFixed(["KWD", "BHD", "OMR", "JOD"].includes(currency) ? 3 : 2) : String(price),
        currency,
        description: pickString(obj, ["description", "desc", "description_en"])?.slice(0, 300) ?? null,
        category,
        kind: "product",
        method: "structured_data",
        imageUrl: imageFromJson(obj),
      });
    }
    const nextCategory = !price && name && Object.values(obj).some((v) => Array.isArray(v) && v.length > 0) ? name : category;
    for (const value of Object.values(obj)) if (value && typeof value === "object") walk(value, depth + 1, nextCategory);
  };
  walk(root, 0, null);
  return out;
}

function pickValue(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const localized = (v as Record<string, unknown>).en ?? (v as Record<string, unknown>).ar ?? Object.values(v)[0];
      if (typeof localized === "string" && localized.trim()) return localized.trim();
    }
  }
  return null;
}

// ── Item cards ───────────────────────────────────────────────────────────

const CARD = "[class*=item], [class*=product], [class*=dish], [class*=menu-item], [class*=card], [data-hook*=item], figure";
const CARD_TITLE = "h2, h3, h4, h5, [class*=title], [class*=name], [data-hook*=title], figcaption, strong";

/** Cards with a short title and optional description — never used for prices (those need a written price). */
export function extractCards($: cheerio.CheerioAPI, base: URL | null = null): ProductCard[] {
  const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();
  const out: ProductCard[] = [];
  const seen = new Set<string>();
  $(CARD).each((_, el) => {
    if (out.length >= 200) return false;
    const card = $(el);
    if (card.closest("header, footer, nav").length > 0) return;
    // Innermost card only (a card inside a card is the real item).
    if (card.find(CARD).length > 0) return;
    const titleEl = card.find(CARD_TITLE).first();
    const name = clean(titleEl.text());
    if (name.length < 2 || name.length > 80 || !/\p{L}{2,}/u.test(name) || /\d{2,}/.test(name)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const description = clean(card.find("p, [class*=desc]").not(titleEl).first().text()) || null;
    const heading = clean(card.closest("section, ul, div").prevAll("h1, h2, h3").first().text()) || null;
    out.push({
      name,
      description: description && description !== name ? description.slice(0, 300) : null,
      category: heading && heading.length <= 60 ? heading : null,
      imageUrl: imageInElement($, el, base),
    });
  });
  return out;
}
