/**
 * Live exchange rates for switching a business's currency — from free,
 * keyless public feeds (no account, no API key):
 *
 *   1. open.er-api.com           ExchangeRate-API's open endpoint, updated daily
 *   2. @fawazahmed0/currency-api  community feed on jsDelivr, updated daily
 *   3. the same feed's Cloudflare mirror
 *
 * Tried in that order; the first valid answer wins. Answers are cached by
 * Next for an hour (public market data — nothing tenant-specific). When
 * every source fails, there is no rate: the switch is refused, never done
 * with a guessed number.
 *
 * Rates are "units of currency per 1 USD". No `server-only` import so the
 * parsers can be unit-tested; nothing here is secret.
 */

export type UsdRates = {
  /** Units of each currency per 1 USD (upper-case ISO codes). */
  rates: Record<string, number>;
  source: string;
  /** When the source last updated its rates. */
  asOf: string | null;
};

export type RatesFetcher = (url: string) => Promise<unknown>;

const SOURCES: { name: string; url: string; parse: (body: unknown) => UsdRates | null }[] = [
  { name: "open.er-api.com", url: "https://open.er-api.com/v6/latest/USD", parse: parseOpenErApi },
  {
    name: "currency-api (jsDelivr)",
    url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
    parse: (b) => parseCurrencyApi(b, "currency-api (jsDelivr)"),
  },
  {
    name: "currency-api (pages.dev)",
    url: "https://latest.currency-api.pages.dev/v1/currencies/usd.json",
    parse: (b) => parseCurrencyApi(b, "currency-api (pages.dev)"),
  },
];

/** `{"result":"success","base_code":"USD","time_last_update_utc":"…","rates":{"SAR":3.75,…}}` */
export function parseOpenErApi(body: unknown): UsdRates | null {
  const b = body as { result?: unknown; base_code?: unknown; rates?: unknown; time_last_update_utc?: unknown } | null;
  if (!b || b.result !== "success" || b.base_code !== "USD") return null;
  const rates = cleanRates(b.rates, (k) => k.toUpperCase());
  if (!rates) return null;
  const asOf = typeof b.time_last_update_utc === "string" && !Number.isNaN(Date.parse(b.time_last_update_utc))
    ? new Date(b.time_last_update_utc).toISOString()
    : null;
  return { rates, source: "open.er-api.com", asOf };
}

/** `{"date":"2026-10-03","usd":{"sar":3.75,…}}` */
export function parseCurrencyApi(body: unknown, source: string): UsdRates | null {
  const b = body as { date?: unknown; usd?: unknown } | null;
  if (!b || typeof b.usd !== "object") return null;
  const rates = cleanRates(b.usd, (k) => k.toUpperCase());
  if (!rates) return null;
  const asOf = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? `${b.date}T00:00:00.000Z` : null;
  return { rates, source, asOf };
}

/** Only positive, finite rates for 3-letter codes; USD must be 1; at least a handful of currencies. */
function cleanRates(raw: unknown, key: (k: string) => string): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z]{3}$/.test(k) || typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    out[key(k)] = v;
  }
  if (out.USD !== 1 || Object.keys(out).length < 20) return null;
  return out;
}

async function defaultFetcher(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
    // Public market data, refreshed by the sources daily: an hour's cache is plenty.
    next: { revalidate: 3600 },
  } as RequestInit);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Today's rates (per 1 USD), or null when no source answered with valid data. */
export async function loadUsdRates(fetcher: RatesFetcher = defaultFetcher): Promise<UsdRates | null> {
  for (const source of SOURCES) {
    try {
      const parsed = source.parse(await fetcher(source.url));
      if (parsed) return parsed;
    } catch {
      // try the next source
    }
  }
  return null;
}

/** 1 unit of `from` in units of `to`, or null when either rate is missing. */
export function crossRate(rates: Record<string, number>, from: string, to: string): number | null {
  const a = rates[from.toUpperCase()];
  const b = rates[to.toUpperCase()];
  return a && b ? b / a : null;
}

/**
 * Converts an amount in minor units the way the database switch does
 * (`round(amount × rate × 10^(toExp − fromExp))`) — used for the preview,
 * so what the owner sees is what they get.
 */
export function convertMinor(amountMinor: number, rate: number, fromExponent: number, toExponent: number): number {
  return Math.round(amountMinor * rate * 10 ** (toExponent - fromExponent));
}
