import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/site/config";

/** Search engines: the public website only — never the consoles or the Agent's checkout pages. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/*/super-admin", "/*/login", "/*/onboarding", "/*/invite/", "/*/signup", "/*/welcome", "/agent/pay/", "/*/checkout"],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
