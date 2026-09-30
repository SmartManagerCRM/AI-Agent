import { assertSafeCrawlTarget, UnsafeCrawlTargetError } from "./url-safety";

/**
 * The one way the Business Brain fetches an owner-supplied URL.
 *
 *  - Redirects are followed *manually*, and every hop is re-checked by the
 *    SSRF guard — `redirect: "follow"` would let a public page 302 the
 *    server into its own network (cloud metadata, localhost admin ports).
 *  - Bodies are streamed and cut at `maxBytes`, so a huge or endless
 *    response can't exhaust memory.
 *  - Only the content types a caller asks for are read at all.
 *
 * No `server-only` import (unit-tested directly, like `url-safety.ts`).
 */
export const CRAWLER_USER_AGENT = "SmartManagerAIAgentBot/1.0 (+business-brain-onboarding)";

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Accepted content-type prefixes; anything else is refused before the body is read. */
  accept?: string[];
  /** Optional extra rule per hop (e.g. "stay on the business's own site"). */
  allowUrl?: (url: URL) => boolean;
  fetcher?: typeof fetch;
  /** SSRF check per hop; injectable only so tests can run against fakes. */
  assertTarget?: (url: URL) => Promise<void>;
};

export type SafeFetchResult =
  | { ok: true; url: URL; status: number; contentType: string; body: string; bytes: number; truncated: boolean }
  | {
      ok: false;
      url: URL;
      reason: "blocked" | "http_error" | "unsupported_type" | "too_many_redirects" | "timeout" | "network";
      status?: number;
      message: string;
    };

const DEFAULTS = { timeoutMs: 8_000, maxBytes: 1_500_000, maxRedirects: 5 };

export async function safeFetch(input: URL, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const fetcher = options.fetcher ?? fetch;
  const assertTarget = options.assertTarget ?? assertSafeCrawlTarget;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const accept = options.accept ?? ["text/html", "application/xhtml+xml"];
  const signal = AbortSignal.timeout(timeoutMs);

  let url = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, url, reason: "blocked", message: "Only http(s) links are followed." };
    }
    if (options.allowUrl && !options.allowUrl(url)) {
      return { ok: false, url, reason: "blocked", message: "Redirect leaves the allowed site." };
    }
    try {
      await assertTarget(url);
    } catch (error) {
      const message = error instanceof UnsafeCrawlTargetError ? error.message : "That address cannot be fetched.";
      return { ok: false, url, reason: "blocked", message };
    }

    let response: Response;
    try {
      response = await fetcher(url, {
        redirect: "manual",
        signal,
        headers: { "user-agent": CRAWLER_USER_AGENT, accept: accept.join(",") + ",*/*;q=0.1" },
      });
    } catch (error) {
      const timedOut = signal.aborted || (error instanceof Error && error.name === "TimeoutError");
      return { ok: false, url, reason: timedOut ? "timeout" : "network", message: timedOut ? "Timed out." : "Network error." };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) return { ok: false, url, reason: "http_error", status: response.status, message: "Redirect without a target." };
      try {
        url = new URL(location, url);
      } catch {
        return { ok: false, url, reason: "http_error", status: response.status, message: "Invalid redirect target." };
      }
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, url, reason: "http_error", status: response.status, message: `HTTP ${response.status}` };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!accept.some((type) => contentType.startsWith(type))) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, url, reason: "unsupported_type", status: response.status, message: contentType || "no content type" };
    }

    const { text, bytes, truncated } = await readCapped(response, maxBytes, contentType).catch(() => ({
      text: null,
      bytes: 0,
      truncated: false,
    }));
    if (text === null) return { ok: false, url, reason: signal.aborted ? "timeout" : "network", message: "Body could not be read." };
    return { ok: true, url, status: response.status, contentType, body: text, bytes, truncated };
  }
  return { ok: false, url, reason: "too_many_redirects", message: "Too many redirects." };
}

async function readCapped(
  response: Response,
  maxBytes: number,
  contentType: string,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const declared = Number(response.headers.get("content-length"));
  const reader = response.body?.getReader();
  if (!reader) return { text: "", bytes: 0, truncated: false };

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = Number.isFinite(declared) && declared > maxBytes;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - bytes;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      bytes += room;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: decode(merged, contentType), bytes, truncated };
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
