import "server-only";

import { agentBaseUrl, platformOrigin } from "@/lib/hosts";
import { serverEnv } from "@/server/env-core";

/**
 * Every public customer-facing Agent URL, built in one place.
 *
 * Canonical today: `https://<root>/agent/<business-slug>` — path-based on
 * the platform host, which always resolves. A dedicated Agent domain is
 * used only when `AGENT_URL` is set (after its DNS record exists).
 */
export function publicAgentUrls() {
  const env = serverEnv();
  const config = {
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
    scheme: env.PUBLIC_URL_SCHEME,
    port: env.PUBLIC_URL_PORT,
    agentUrl: env.AGENT_URL,
  };
  const base = agentBaseUrl(config);
  // The widget loader script is an API route on the platform host (always resolvable).
  const platform = platformOrigin(null, config);
  return {
    base,
    agent: (slug: string) => `${base}/${encodeURIComponent(slug)}`,
    widget: (slug: string) => `${base}/widget/${encodeURIComponent(slug)}`,
    /** `path` is Agent-relative, e.g. `/pay/<id>`. */
    path: (path: string) => `${base}${path.startsWith("/") ? path : `/${path}`}`,
    embedScript: (slug: string) => `${platform}/api/widget/embed?tenant=${encodeURIComponent(slug)}`,
  };
}
