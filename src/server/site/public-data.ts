import "server-only";

import { unstable_cache } from "next/cache";

import type { PublicPlan } from "@/lib/site/pricing";
import { displayMoney, type DisplayMoney } from "@/server/platform/display-currency";
import { anonymousClient } from "@/server/supabase/clients";

/**
 * What the public website reads from the database — as a visitor (the
 * publishable key), through the two functions made for it — cached briefly
 * across requests. Only public data: plans as shown on the pricing page,
 * and the company's contact details. Saving a plan or the contact settings
 * in Super Admin clears it (revalidateTag(PUBLIC_SITE_TAG)).
 */
export const PUBLIC_SITE_TAG = "public-site";

export type SiteInfo = {
  platformName: string;
  companyName: string | null;
  companyCountry: string | null;
  supportEmail: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  socialLinks: Record<string, string>;
  currencies: string[];
};

const FALLBACK_INFO: SiteInfo = {
  platformName: "SmartManager AI Agent",
  companyName: null,
  companyCountry: null,
  supportEmail: null,
  contactEmail: null,
  contactPhone: null,
  socialLinks: {},
  currencies: ["USD"],
};

/** Prices in the visitor's chosen header currency (≈, today's rates) — the console's display-currency helper, as a visitor. */
export function siteDisplayMoney(locale: string): Promise<DisplayMoney> {
  return displayMoney(anonymousClient(), locale);
}

export const loadPublicPlans = unstable_cache(
  async (): Promise<PublicPlan[]> => {
    const { data, error } = await anonymousClient().rpc("public_subscription_plans");
    if (error || !data) return [];
    return data as PublicPlan[];
  },
  ["public-site-plans"],
  { revalidate: 300, tags: [PUBLIC_SITE_TAG] },
);

export const loadSiteInfo = unstable_cache(
  async (): Promise<SiteInfo> => {
    const { data, error } = await anonymousClient().rpc("public_site_info");
    const row = data?.[0];
    if (error || !row) return FALLBACK_INFO;
    return {
      platformName: row.platform_name,
      companyName: row.company_name,
      companyCountry: row.company_country,
      supportEmail: row.support_email,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      socialLinks: (row.social_links as Record<string, string> | null) ?? {},
      currencies: row.supported_currencies?.length ? row.supported_currencies : ["USD"],
    };
  },
  ["public-site-info"],
  { revalidate: 300, tags: [PUBLIC_SITE_TAG] },
);
