/**
 * Hostinger runs the app under Passenger (LiteSpeed), which takes over the
 * server's `listen`: nothing serves the app at the address Next.js records
 * for itself (`process.env.__NEXT_PRIVATE_ORIGIN`, e.g. http://0.0.0.0:3000).
 *
 * After a Server Action calls `redirect()`, Next.js fetches the destination
 * page from that address — with the visitor's cookies — to send it in the
 * same response. Here that request fails ("failed to get redirect response"),
 * and on a shared server another process could be the one listening there.
 *
 * So such requests are answered at once with an empty response: Next.js then
 * does what it already did after the failure — the browser loads the
 * destination itself (one more round trip; the page is the same).
 */
type FetchInput = Parameters<typeof fetch>[0];

const urlOf = (input: FetchInput): string | null => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return typeof (input as Request)?.url === "string" ? (input as Request).url : null;
};

/** Whether a fetch goes to the app's own internal address (pure — tested in tests/unit/self-fetch.test.ts). */
export function isSelfRequest(input: FetchInput, selfOrigin: string | undefined): boolean {
  if (!selfOrigin) return false;
  const url = urlOf(input);
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(selfOrigin).origin;
  } catch {
    return false;
  }
}

let installed = false;

export function guardSelfFetch(): void {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = ((input: FetchInput, init?: RequestInit) =>
    isSelfRequest(input, process.env.__NEXT_PRIVATE_ORIGIN)
      ? Promise.resolve(new Response(null, { status: 204 }))
      : original(input, init)) as typeof fetch;
}
