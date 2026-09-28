/**
 * Pure host classification — no I/O, so it is shared by the proxy, server
 * components and unit tests.
 *
 *   ai-agent.smartmanager.me           → platform marketing site, and (by
 *                                        path — see `resolveConsolePath`)
 *                                        the subscriber console at
 *                                        `/<locale>/<business-slug>` and
 *                                        Super Admin at `/<locale>/super-admin`
 *   agent.ai-agent.smartmanager.me     → the standalone External Agent (addendum §14):
 *                                        agent.<root>/<tenant-slug>, no locale in the URL
 *                                        (deliberately — this is the shareable link/QR
 *                                        target, addendum §17)
 *
 * The routing architecture spec is explicit that the console must never
 * live on its own subdomain (`app.<root>`, `admin.<root>`, …) — it answers
 * on the same root host as the marketing site, disambiguated by path.
 * `CONSOLE_SUBDOMAIN` still exists as a configuration knob (a deployment
 * that *can* serve a dedicated console subdomain may still point one at
 * it), but the canonical, documented shape above never uses it — and
 * `CONSOLE_URL` overrides the console's public origin to whatever actually
 * resolves in a given deployment (`consoleOrigin()` below), independent of
 * whether `classifyHost` would also recognize a `CONSOLE_SUBDOMAIN` host.
 *
 * A website-embedded widget (spec §45) is a later phase: it identifies its
 * tenant through a public embed/site key resolved by a dedicated RPC, never
 * through its own hostname (the business's own site), so it needs no `kind`
 * of its own here — it is not a host this proxy ever sees.
 */
export type HostConfig = {
  rootDomain: string;
  consoleSubdomain: string;
  agentSubdomain: string;
};

export type SiteTarget = { kind: "platform" } | { kind: "console" } | { kind: "agent" } | { kind: "invalid" };

/** Lower-cases, strips the port, a trailing dot and a leading `www.`. */
export function normalizeHost(rawHost: string | null | undefined): string {
  if (!rawHost) return "";
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith("[")) return host;
  host = host.replace(/:\d+$/, "").replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

/** Builds an absolute origin for a platform host, e.g. the console subdomain. */
export function platformOrigin(
  subdomain: string | null,
  config: HostConfig & { scheme: "http" | "https"; port?: string },
): string {
  const host = subdomain ? `${subdomain}.${config.rootDomain}` : config.rootDomain;
  return `${config.scheme}://${host}${config.port ? `:${config.port}` : ""}`;
}

/**
 * Builds the console's public origin, honoring `CONSOLE_URL` when the host
 * can't serve the console subdomain at all (see `env-core.ts`). Every
 * console/staff link should be built through this, never `platformOrigin`
 * directly, so a single override fixes them all.
 */
export function consoleOrigin(
  config: HostConfig & { scheme: "http" | "https"; port?: string; consoleUrl?: string },
): string {
  if (config.consoleUrl) return config.consoleUrl.replace(/\/+$/, "");
  return platformOrigin(config.consoleSubdomain, config);
}

export function classifyHost(rawHost: string | null | undefined, config: HostConfig): SiteTarget {
  const host = normalizeHost(rawHost);
  const root = config.rootDomain.toLowerCase();
  if (!host) return { kind: "invalid" };

  if (host === root) return { kind: "platform" };

  if (host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (sub === config.consoleSubdomain) return { kind: "console" };
    if (sub === config.agentSubdomain) return { kind: "agent" };
    return { kind: "invalid" };
  }

  return { kind: "invalid" };
}
