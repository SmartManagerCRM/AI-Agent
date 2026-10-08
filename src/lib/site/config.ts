/**
 * The public website (ai-agent.smartmanager.me): its pages and where its
 * buttons lead. Pure — shared by server and client components.
 */
export const SITE_ORIGIN = "https://ai-agent.smartmanager.me";

/** "Watch demo": the SmartManager AI Agent's own customer-facing Agent page. */
export const DEMO_AGENT_SLUG = "smartmanager";

/** Top-level pages of the public site (reserved: never a business slug). */
export const SITE_PAGES = ["pricing", "signup", "welcome", "set-password", "terms", "refund-policy", "privacy-policy", "about", "contact", "watch"] as const;

/** The landing page's sections (header links and footer). */
export const SECTION_IDS = { features: "features", howItWorks: "how-it-works", pricing: "pricing", faq: "faq" } as const;

/** The business categories on the landing page (each opens its own use-case panel). */
export const BUSINESS_CATEGORIES = ["restaurants", "retail", "salons", "fitness", "clinics", "hotels", "events", "more"] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];
