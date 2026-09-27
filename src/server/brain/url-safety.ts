import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * No `server-only` import here (unlike `crawler.ts`, which does): this
 * module is imported directly by its own unit tests, and `server-only`'s
 * throwing stub only resolves away under the `react-server` bundler
 * condition Next.js sets, not under Vitest. The `node:dns`/`node:net`
 * imports already make this unusable outside a Node server runtime.
 *
 * SSRF guard for owner-supplied crawl targets (spec §9, §61). A business
 * owner can point the crawler at *any* URL they type in, so before the
 * server makes a single outbound request on their behalf it must refuse
 * anything that resolves to this platform's own network: loopback, private
 * ranges, link-local, and other reserved blocks. This is a best-effort
 * defense (a resolved address is re-checked at connect time by nothing here
 * — a determined DNS-rebinding attacker could still race it), appropriate
 * for a low-value onboarding convenience feature, not a substitute for
 * network-level egress controls in production.
 */
export class UnsafeCrawlTargetError extends Error {}

export function parseCrawlUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeCrawlTargetError("Enter a valid http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeCrawlTargetError("Only http/https URLs can be crawled.");
  }
  if (url.username || url.password) {
    throw new UnsafeCrawlTargetError("URLs with embedded credentials are not allowed.");
  }
  return url;
}

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".localhost", ".internal"];

export async function assertSafeCrawlTarget(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UnsafeCrawlTargetError("That hostname cannot be crawled.");
  }

  if (isIP(hostname)) {
    if (isPrivateOrReservedAddress(hostname)) {
      throw new UnsafeCrawlTargetError("That address cannot be crawled.");
    }
    return;
  }

  let addresses: string[];
  try {
    const results = await dnsLookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new UnsafeCrawlTargetError("That hostname could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(isPrivateOrReservedAddress)) {
    throw new UnsafeCrawlTargetError("That address cannot be crawled.");
  }
}

function isPrivateOrReservedAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("::ffff:127.") ||
      normalized === "::"
    );
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;

  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 0) return true; // "this network"
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}
