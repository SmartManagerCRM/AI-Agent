import type { ExtractedImage } from "./page-media";

/**
 * Deterministic image triage — decides which images are worth OCR/vision
 * before any money is spent. Two passes: from page metadata (before
 * download) and from the real pixels' size (after download). Pure.
 */
export type ImageClass =
  | "menu_page"
  | "price_list"
  | "product_card"
  | "food_photo"
  | "category_image"
  | "decorative"
  | "logo"
  | "banner"
  | "irrelevant";

export type Triage = { class: ImageClass; score: number; reasons: string[] };

/** Classes that can carry names and prices — the only ones that go on to OCR/vision. */
export const EXTRACTABLE: ReadonlySet<ImageClass> = new Set(["menu_page", "price_list", "product_card"]);

const MENU_WORDS =
  /(menu|menus|carte|breakfast|brunch|lunch|dinner|drinks?|beverage|dessert|price|prices|pricelist|tarif|قائمة|منيو|المنيو|فطور|إفطار|غداء|عشاء|مشروبات|حلويات|أسعار|الأسعار)/i;
const LOGO_WORDS = /(logo|brand|favicon|icon|sprite|avatar|badge|symbol|شعار)/i;
const BANNER_WORDS = /(banner|hero|cover|header|slider|slide|background|bg[-_]|pattern|texture|divider|separator|placeholder|spacer|loader|arrow|button|social|facebook|instagram|twitter|whatsapp|tiktok|snapchat|youtube|google-play|app-store|payment|visa|mastercard|mada)/i;
const FOOD_WORDS = /(dish|plate|food|meal|coffee|tea|cake|salad|burger|pizza|eggs?|shakshuka|foul|falafel|pancake|croissant|juice|sandwich|طبق|قهوة|شاي|كيك|سلطة|برجر|بيتزا|بيض|شكشوكة|فول|فلافل|عصير)/i;

/** Pass 1: from what the page says about the image. */
export function triageImage(img: ExtractedImage, page: { isCatalog: boolean; imageCount: number }): Triage {
  const reasons: string[] = [];
  const text = [img.alt, img.title, img.caption, img.context, decodeFilename(img.url)].filter(Boolean).join(" ");
  const w = img.width ?? null;
  const h = img.height ?? null;
  const ratio = w && h ? w / h : null;

  if (/\.(svg|gif)(?=$|[?#])/i.test(img.url)) return { class: "decorative", score: 0, reasons: ["vector/animated format"] };
  if (w !== null && h !== null && (w < 160 || h < 160)) return { class: LOGO_WORDS.test(text) ? "logo" : "decorative", score: 0, reasons: [`small ${w}x${h}`] };
  if (LOGO_WORDS.test(text)) return { class: "logo", score: 0, reasons: ["logo/icon wording"] };
  if (img.inChrome && !MENU_WORDS.test(text)) return { class: "decorative", score: 0, reasons: ["in page header/footer"] };
  if (ratio !== null && ratio > 3) return { class: "banner", score: 0, reasons: [`very wide ${ratio.toFixed(1)}:1`] };
  if (BANNER_WORDS.test(text) && !MENU_WORDS.test(text)) return { class: "banner", score: 0, reasons: ["banner/decoration wording"] };

  let score = 0;
  if (MENU_WORDS.test(text)) {
    score += 5;
    reasons.push("menu wording");
  }
  if (page.isCatalog) {
    score += 3;
    reasons.push("on a menu/catalog page");
  }
  if (img.source === "img" || img.source === "picture") score += 1;
  if (img.source === "og" || img.source === "json") score -= 1;
  // Menu pages are usually portrait sheets (A4 ≈ 0.71) or large landscape spreads.
  if (ratio !== null && ratio >= 0.5 && ratio <= 0.85 && (h ?? 0) >= 600) {
    score += 2;
    reasons.push("portrait sheet");
  } else if (ratio !== null && ratio > 1.2 && ratio <= 2 && (w ?? 0) >= 900) {
    score += 1;
    reasons.push("large landscape");
  }
  // On a catalog page with few images, every content image is likely a menu sheet.
  if (page.isCatalog && page.imageCount <= 12 && !img.inChrome) score += 1;

  if (score >= 6) return { class: "menu_page", score, reasons };
  if (score >= 4) return { class: FOOD_WORDS.test(text) ? "product_card" : "price_list", score, reasons };
  if (FOOD_WORDS.test(text)) return { class: "food_photo", score, reasons: [...reasons, "food wording"] };
  if (img.link && MENU_WORDS.test(img.link)) return { class: "category_image", score, reasons: [...reasons, "links to a menu section"] };
  return { class: "irrelevant", score, reasons };
}

/** Pass 2: with the real pixel size and byte size (text-dense images compress poorly). */
export function refineWithPixels(t: Triage, px: { width: number; height: number; bytes: number }): Triage {
  if (px.width < 250 || px.height < 250) return { class: "decorative", score: 0, reasons: [...t.reasons, `tiny ${px.width}x${px.height}`] };
  const ratio = px.width / px.height;
  if (ratio > 3.2) return { class: "banner", score: 0, reasons: [...t.reasons, `banner ${ratio.toFixed(1)}:1`] };
  if (t.class === "irrelevant" || t.class === "food_photo") {
    // A large portrait image on a catalog page that we underrated: promote it.
    if (ratio >= 0.5 && ratio <= 0.85 && px.height >= 900 && t.score >= 3) return { class: "menu_page", score: t.score + 2, reasons: [...t.reasons, "portrait sheet (pixels)"] };
  }
  return t;
}

function decodeFilename(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    return decodeURIComponent(last).replace(/[-_.~]+/g, " ");
  } catch {
    return "";
  }
}
