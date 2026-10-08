import type { MetadataRoute } from "next";

import { LOCALES } from "@/i18n/locales";
import { publicUrl } from "@/server/site/metadata";

const PAGES = ["", "/pricing", "/about", "/contact", "/terms", "/refund-policy", "/privacy-policy", "/watch"];

/** The public website's pages, in every language (with their language alternates). */
export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: publicUrl(locale, path),
      changeFrequency: path === "" || path === "/pricing" ? ("weekly" as const) : ("yearly" as const),
      priority: path === "" ? 1 : path === "/pricing" ? 0.9 : 0.5,
      alternates: { languages: Object.fromEntries(LOCALES.map((l) => [l, publicUrl(l, path)])) },
    })),
  );
}
