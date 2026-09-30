import type { BusinessCategory } from "./business-type";

/**
 * Source Intelligence Router — decides which pages of a website are worth
 * reading, and in what order, *generically*: pages are classified into
 * business-agnostic topics (offerings, pricing, booking, hours, ...) by
 * multilingual URL/link-text patterns, and the business category only
 * re-weights those topics (a menu matters to food service, a class
 * timetable to fitness, a doctors page to healthcare). There is no
 * industry-specific pipeline — adding an industry is a weight table here.
 *
 * Pure module (no I/O).
 */
export const ROUTER_VERSION = "router-v1";

export type PageTopic =
  | "home"
  | "offerings"
  | "pricing"
  | "booking"
  | "ordering"
  | "hours"
  | "contact"
  | "locations"
  | "about"
  | "policies"
  | "faq"
  | "team"
  | "gallery"
  | "news"
  | "careers"
  | "legal"
  | "account"
  | "unknown";

export type PriorityTier = "high" | "medium" | "low" | "very_low" | "excluded";

/** Multilingual (en/ar/fr + common transliterations) signals, matched against URL path tokens and link text. */
const TOPIC_PATTERNS: Record<Exclude<PageTopic, "home" | "unknown">, RegExp> = {
  offerings:
    /\b(menu|menus|carte|food|drinks?|beverages?|dishes|products?|shop|store|catalog(ue)?|collections?|services?|treatments?|packages?|programs?|classes|courses|offers?|specialit(y|ies)|prestations|produits|boutique|nos-services)\b|قائمة|المنيو|منيو|الطعام|المشروبات|منتجات|المنتجات|خدمات|الخدمات|باقات|الباقات|عروض|العروض|المتجر|برامج|الدورات|علاجات/i,
  pricing: /\b(pric(e|es|ing)|rates?|tarifs?|prix|fees|plans?|membership|abonnements?)\b|الأسعار|اسعار|أسعار|الاشتراك|اشتراكات|العضوية|رسوم/i,
  booking:
    /\b(book(ing)?|reserv(e|ation|ations)|r[ée]servation|appointments?|rendez-vous|rdv|schedule|timetable|planning)\b|حجز|احجز|الحجز|مواعيد|موعد|جدول/i,
  ordering: /\b(order(ing)?|delivery|takeaway|take-away|pickup|livraison|commander|commande|cart|checkout)\b|اطلب|الطلب|طلب|توصيل|التوصيل|استلام/i,
  hours: /\b(hours|opening|horaires|ouverture|timings?)\b|ساعات|أوقات|اوقات|الدوام/i,
  contact: /\b(contact(-us|ez-nous)?|get-in-touch|reach-us|nous-contacter|call-us)\b|اتصل|تواصل|اتصال/i,
  locations: /\b(locations?|branch(es)?|stores?-locator|find-us|visit-us|directions|adresses?|nos-agences|succursales)\b|فروع|الفروع|فرع|موقعنا|العنوان|المواقع/i,
  about: /\b(about(-us)?|our-story|story|who-we-are|a-propos|qui-sommes-nous|notre-histoire)\b|من-نحن|من نحن|عن-|عنا|قصتنا/i,
  policies:
    /\b(polic(y|ies)|refunds?|returns?|exchange|cancell?ation|shipping|terms-of-sale|conditions-generales|cgv|remboursement|retours?|annulation|warranty|garantie)\b|سياسة|سياسات|الاسترجاع|الاسترداد|الإلغاء|الالغاء|الاستبدال|الشحن|الضمان/i,
  faq: /\b(faqs?|questions|help|support|aide)\b|الأسئلة|الاسئلة|أسئلة|اسئلة|مساعدة/i,
  team: /\b(team|staff|doctors?|stylists?|trainers?|coaches|therapists?|equipe|[ée]quipe|m[ée]decins|nos-experts)\b|فريق|الفريق|الأطباء|الاطباء|المدربين|المدربات|الأخصائيين/i,
  gallery: /\b(gallery|galerie|photos?|portfolio|media|videos?)\b|معرض|الصور|صور/i,
  news: /\b(blog|news|articles?|press|actualit[ée]s|events?|evenements)\b|مدونة|المدونة|أخبار|اخبار|الأخبار|فعاليات/i,
  careers: /\b(careers?|jobs|hiring|recrutement|emplois?|join-us)\b|وظائف|الوظائف|توظيف/i,
  legal: /\b(privacy|cookies?|terms(-of-(use|service))?|legal|mentions-legales|confidentialit[ée]|gdpr|imprint)\b|الخصوصية|الشروط|الأحكام|شروط/i,
  account: /\b(login|log-in|sign-?in|sign-?up|register|account|my-account|wp-admin|admin|password|wishlist|compare)\b|تسجيل|حسابي|الدخول/i,
};

/** Topic base weights (0–100) — generic, before category re-weighting. */
const BASE_WEIGHT: Record<PageTopic, number> = {
  home: 100,
  offerings: 80,
  pricing: 75,
  hours: 70,
  contact: 65,
  locations: 65,
  booking: 60,
  ordering: 55,
  policies: 55,
  faq: 50,
  about: 45,
  team: 30,
  gallery: 10,
  news: 8,
  unknown: 20,
  careers: 3,
  legal: 3,
  account: 0,
};

/** Category re-weighting (added to the base weight). Only what differs from the generic default. */
const CATEGORY_BOOST: Record<BusinessCategory, Partial<Record<PageTopic, number>>> = {
  food_service: { offerings: 15, ordering: 15, hours: 10, locations: 5, booking: 5 },
  beauty: { offerings: 10, pricing: 15, booking: 20, team: 10 },
  wellness: { offerings: 10, pricing: 15, booking: 20 },
  fitness: { pricing: 15, booking: 15, offerings: 10, hours: 5 },
  healthcare: { booking: 20, team: 20, offerings: 10, locations: 5, faq: 5 },
  retail: { offerings: 10, policies: 20, ordering: 10, locations: 5, faq: 5 },
  hospitality: { offerings: 10, booking: 20, pricing: 10, policies: 10 },
  education: { offerings: 15, pricing: 10, faq: 10, booking: 5 },
  automotive: { offerings: 10, booking: 15, pricing: 10 },
  home_services: { offerings: 15, booking: 10, locations: 10, pricing: 5 },
  professional_services: { offerings: 15, team: 10, booking: 5, about: 10 },
  engineering: { offerings: 15, about: 15, team: 5, gallery: 15 },
  general: {},
};

/** Per-topic cap on how many pages of one topic are read (keeps one blog/menu section from eating the page budget). */
const TOPIC_CAP: Record<PageTopic, number> = {
  home: 1,
  offerings: 6,
  pricing: 3,
  booking: 2,
  ordering: 2,
  hours: 1,
  contact: 2,
  locations: 3,
  about: 2,
  policies: 4,
  faq: 2,
  team: 2,
  gallery: 0,
  news: 0,
  careers: 0,
  legal: 0,
  account: 0,
  unknown: 3,
};

export type PageCandidate = {
  url: string;
  /** Link text(s) pointing at the page (menus/nav labels are the strongest hint). */
  linkText?: string;
  /** Link depth from the homepage (0 = homepage). */
  depth: number;
  /** Came from the sitemap. */
  inSitemap?: boolean;
};

export type RankedPage = PageCandidate & { topic: PageTopic; score: number; tier: PriorityTier };

const ASSET_EXTENSION = /\.(jpe?g|png|gif|webp|svg|ico|css|js|mjs|zip|rar|mp4|mp3|mov|avi|woff2?|ttf|eot|xml|json|txt)$/i;

export function classifyTopic(url: URL, linkText = ""): PageTopic {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  if (path === "/" || path === "" || /^\/(en|ar|fr)\/?$/i.test(path) || /^\/index\.(html?|php)$/i.test(path)) return "home";
  // Tokenize the path (`/our-menu/drinks` → "our-menu drinks") so `\b` word
  // patterns match slug words; hyphenated phrases are kept for multi-word patterns.
  const haystacks = [path.toLowerCase().replace(/[/_.]+/g, " "), linkText.toLowerCase()];
  // Account/legal first: a "/menu/login" page is still a login page.
  for (const topic of ["account", "legal", "careers"] as const) {
    if (haystacks.some((h) => TOPIC_PATTERNS[topic].test(h))) return topic;
  }
  let best: PageTopic = "unknown";
  let bestWeight = -1;
  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS) as [Exclude<PageTopic, "home" | "unknown">, RegExp][]) {
    if (topic === "account" || topic === "legal" || topic === "careers") continue;
    if (haystacks.some((h) => pattern.test(h)) && BASE_WEIGHT[topic] > bestWeight) {
      best = topic;
      bestWeight = BASE_WEIGHT[topic];
    }
  }
  return best;
}

export function scorePage(candidate: PageCandidate, category: BusinessCategory): RankedPage {
  let url: URL;
  try {
    url = new URL(candidate.url);
  } catch {
    return { ...candidate, topic: "unknown", score: 0, tier: "excluded" };
  }
  if (ASSET_EXTENSION.test(url.pathname) || /\/(feed|wp-json|cdn-cgi|tag|author|page\/\d+)(\/|$)/i.test(url.pathname)) {
    return { ...candidate, topic: "unknown", score: 0, tier: "excluded" };
  }
  const topic = classifyTopic(url, candidate.linkText);
  let score = BASE_WEIGHT[topic] + (CATEGORY_BOOST[category][topic] ?? 0);
  if (topic !== "home") {
    score -= Math.max(0, candidate.depth - 1) * 10; // deeper pages are less likely to be canonical
    if (candidate.linkText) score += 5; // linked from navigation/content with a label
    if (candidate.inSitemap) score += 3;
    if (url.search) score -= 10; // parameterised variants (filters, sorts)
    if (url.pathname.split("/").filter(Boolean).length > 4) score -= 10;
  }
  score = Math.max(0, Math.min(100, score));
  return { ...candidate, topic, score, tier: tierFor(topic, score) };
}

export function tierFor(topic: PageTopic, score: number): PriorityTier {
  if (TOPIC_CAP[topic] === 0) return "excluded";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  if (score >= 20) return "low";
  return "very_low";
}

/**
 * Picks the pages to fetch: best score first, excluded/very-low tiers
 * never, each topic capped, the homepage always first. Duplicates (same
 * canonical URL) must already be removed by the caller.
 */
export function selectPages(candidates: PageCandidate[], category: BusinessCategory, maxPages: number): RankedPage[] {
  const ranked = candidates
    .map((c) => scorePage(c, category))
    .filter((p) => p.tier !== "excluded" && p.tier !== "very_low")
    .sort((a, b) => b.score - a.score || a.depth - b.depth || a.url.length - b.url.length);
  const perTopic = new Map<PageTopic, number>();
  const picked: RankedPage[] = [];
  for (const page of ranked) {
    if (picked.length >= maxPages) break;
    const used = perTopic.get(page.topic) ?? 0;
    if (used >= TOPIC_CAP[page.topic]) continue;
    perTopic.set(page.topic, used + 1);
    picked.push(page);
  }
  return picked;
}

/** Topics whose content can carry critical facts (prices, availability, policies) — never auto-approved. */
export const CRITICAL_TOPICS: ReadonlySet<PageTopic> = new Set(["offerings", "pricing", "policies", "ordering", "booking"]);
