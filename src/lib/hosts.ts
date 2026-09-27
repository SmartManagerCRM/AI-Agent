/**
 * Pure host classification — no I/O, so it is shared by the proxy, server
 * components and unit tests.
 *
 *   ai-agent.smartmanager.me           → platform marketing site
 *   app.ai-agent.smartmanager.me       → subscriber console + Super Admin (/platform)
 *   agent.ai-agent.smartmanager.me     → the standalone External Agent (addendum §14):
 *                                        agent.<root>/<tenant-slug>, no locale in the URL
 *                                        (deliberately — this is the shareable link/QR
 *                                        target, addendum §17)
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
