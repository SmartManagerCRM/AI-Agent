import { serverEnv } from "@/server/env-core";

/**
 * Google Places connector — the OFFICIAL Places API (New) only. Nothing
 * here scrapes Google Maps pages: a Maps link is only parsed locally (and a
 * short link's redirect *header* is read, never its page), then the place
 * is resolved and read through the Places API with an explicit field mask.
 *
 * Every field, tier and cost estimate lives in `PLACES_CONFIG` below — the
 * one place to change what SmartManager asks Google for.
 *
 * Storage (Google Maps Platform Service Specific Terms, as of 2025): Place
 * IDs may be stored indefinitely; latitude/longitude may be cached for up
 * to 30 days; other Places content has no caching exception. So the raw
 * response is never persisted — the pipeline turns it into *expiring*,
 * owner-review suggestions (`GOOGLE_FACT_RETENTION_DAYS`) that only become
 * lasting Business Brain data once the owner confirms them. Have the
 * current terms reviewed before relying on this in production.
 */
export const PLACES_CONFIG = {
  endpoint: "https://places.googleapis.com/v1",
  /** Fields by billing tier. A Place Details call is billed at the highest tier any requested field belongs to. */
  fields: {
    essentials: ["id", "formattedAddress", "shortFormattedAddress", "addressComponents", "location", "types"],
    pro: ["displayName", "primaryType", "primaryTypeDisplayName", "businessStatus", "googleMapsUri"],
    enterprise: [
      "nationalPhoneNumber",
      "internationalPhoneNumber",
      "websiteUri",
      "regularOpeningHours",
      "currentOpeningHours",
      "priceLevel",
    ],
    /** Service capabilities (delivery, dine-in, …). Raises the call to the Atmosphere tier. */
    atmosphere: ["delivery", "dineIn", "takeout", "reservable", "curbsidePickup"],
  },
  includeAtmosphere: true,
  /**
   * ESTIMATED list price per call in USD, used only for SmartManager's own
   * cost reporting — Google's invoice is the truth. Verify against the
   * current Places API (New) pricing page when it changes.
   */
  estimatedCostUsd: {
    textSearchIdsOnly: 0,
    details: { essentials: 0.005, pro: 0.017, enterprise: 0.02, atmosphere: 0.025 },
  },
  timeoutMs: 8_000,
  maxRetries: 2,
  maxConcurrent: 4,
} as const;

/** Unconfirmed Google-derived facts are discarded after this many days (the lat/lng caching limit). */
export const GOOGLE_FACT_RETENTION_DAYS = 30;

export const GOOGLE_ATTRIBUTION = { provider: "Google Maps", required: true } as const;

export function placesConfigured(): boolean {
  return Boolean(apiKeyFrom({}));
}

export function detailsFieldMask(): string {
  const f = PLACES_CONFIG.fields;
  return [...f.essentials, ...f.pro, ...f.enterprise, ...(PLACES_CONFIG.includeAtmosphere ? f.atmosphere : [])].join(",");
}

export function detailsCallCostUsd(): number {
  const c = PLACES_CONFIG.estimatedCostUsd.details;
  return PLACES_CONFIG.includeAtmosphere ? c.atmosphere : c.enterprise;
}

// ── Input parsing (pure) ─────────────────────────────────────────────────

export type PlaceInput =
  | { kind: "place_id"; placeId: string }
  | { kind: "search"; query: string; lat?: number; lng?: number }
  | { kind: "short_link"; url: string }
  | { kind: "unsupported"; reason: string };

const PLACE_ID = /^[A-Za-z0-9_-]{20,300}$/;
const SHORT_LINK_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co"]);

function isGoogleMapsHost(host: string): boolean {
  const h = host.toLowerCase();
  return /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h);
}

/** Turns whatever the owner pasted (Maps link, share link, Place ID) into something the Places API can resolve. Never fetches anything. */
export function parsePlaceInput(raw: string): PlaceInput {
  const text = raw.trim();
  if (!text) return { kind: "unsupported", reason: "Paste your Google Maps link or Place ID." };
  if (PLACE_ID.test(text) && !text.includes(".")) return { kind: "place_id", placeId: text };
  // Plain text ("Roasters Café Riyadh") is a name search, not a link.
  if (!/^https?:\/\//i.test(text) && (/\s/.test(text) || !/[./]/.test(text))) {
    return text.length <= 200 ? { kind: "search", query: text } : { kind: "unsupported", reason: "That search is too long." };
  }

  let url: URL;
  try {
    url = new URL(text.startsWith("http") ? text : `https://${text}`);
  } catch {
    return { kind: "unsupported", reason: "That doesn't look like a Google Maps link." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: "unsupported", reason: "Use an https link." };

  const host = url.hostname.toLowerCase();
  if (SHORT_LINK_HOSTS.has(host)) return { kind: "short_link", url: `https://${host}${url.pathname}${url.search}` };
  if (!isGoogleMapsHost(host)) return { kind: "unsupported", reason: "Only Google Maps links are supported here." };

  const params = url.searchParams;
  for (const key of ["query_place_id", "place_id"]) {
    const value = params.get(key);
    if (value && PLACE_ID.test(value)) return { kind: "place_id", placeId: value };
  }
  const q = params.get("q") ?? params.get("query");
  if (q?.startsWith("place_id:")) {
    const id = q.slice("place_id:".length);
    if (PLACE_ID.test(id)) return { kind: "place_id", placeId: id };
  }

  const coords = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(url.pathname);
  const lat = coords ? Number(coords[1]) : undefined;
  const lng = coords ? Number(coords[2]) : undefined;

  const named = /\/maps\/(?:place|search)\/([^/@]+)/.exec(url.pathname);
  if (named) {
    const query = decodeURIComponent(named[1].replace(/\+/g, " ")).trim();
    if (query) return { kind: "search", query, lat, lng };
  }
  if (q) return { kind: "search", query: q.trim(), lat, lng };
  if (params.get("cid")) {
    return {
      kind: "unsupported",
      reason: "That link type can't be resolved through the Places API. Use Share → Copy link in Google Maps, or search your business name.",
    };
  }
  return { kind: "unsupported", reason: "Couldn't find a business in that link. Open your business in Google Maps and use Share → Copy link." };
}

// ── Normalized result ───────────────────────────────────────────────────

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type OpeningHours = Partial<Record<WeekdayKey, { open: string; close: string }[]>>;

export type PlaceDetails = {
  placeId: string;
  name: string | null;
  formattedAddress: string | null;
  shortAddress: string | null;
  city: string | null;
  countryCode: string | null;
  location: { lat: number; lng: number } | null;
  phoneNational: string | null;
  phoneInternational: string | null;
  website: string | null;
  mapsUri: string | null;
  businessStatus: string | null;
  primaryType: string | null;
  primaryTypeLabel: string | null;
  types: string[];
  regularHours: OpeningHours | null;
  hoursText: string[];
  openNow: boolean | null;
  priceLevel: string | null;
  capabilities: Partial<Record<"delivery" | "dineIn" | "takeout" | "reservable" | "curbsidePickup", boolean>>;
};

const DAY_KEYS: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const pad = (n: number) => String(n).padStart(2, "0");

type RawPoint = { day?: number; hour?: number; minute?: number };
type RawPlace = Record<string, unknown> & {
  id?: string;
  displayName?: { text?: string };
  primaryTypeDisplayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  regularOpeningHours?: { periods?: { open?: RawPoint; close?: RawPoint }[]; weekdayDescriptions?: string[] };
  currentOpeningHours?: { openNow?: boolean };
};

/** Google's periods (day 0 = Sunday) → SmartManager's branch-hours shape (`{ mon: [{ open, close }] }`). */
export function normalizeGoogleHours(periods: { open?: RawPoint; close?: RawPoint }[] | undefined): OpeningHours | null {
  if (!periods || periods.length === 0) return null;
  const hours: OpeningHours = {};
  for (const period of periods) {
    const open = period.open;
    if (!open || open.day === undefined) continue;
    const key = DAY_KEYS[open.day];
    if (!key) continue;
    // Open 24 hours: a single open point with no close.
    const range = period.close
      ? { open: `${pad(open.hour ?? 0)}:${pad(open.minute ?? 0)}`, close: `${pad(period.close.hour ?? 0)}:${pad(period.close.minute ?? 0)}` }
      : { open: "00:00", close: "24:00" };
    (hours[key] ??= []).push(range);
  }
  for (const key of Object.keys(hours) as WeekdayKey[]) hours[key]!.sort((a, b) => a.open.localeCompare(b.open));
  return Object.keys(hours).length > 0 ? hours : null;
}

export function normalizePlace(raw: RawPlace): PlaceDetails {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const component = (type: string) => raw.addressComponents?.find((c) => c.types?.includes(type));
  const capabilities: PlaceDetails["capabilities"] = {};
  for (const key of ["delivery", "dineIn", "takeout", "reservable", "curbsidePickup"] as const) {
    if (typeof raw[key] === "boolean") capabilities[key] = raw[key] as boolean;
  }
  return {
    placeId: String(raw.id ?? ""),
    name: str(raw.displayName?.text),
    formattedAddress: str(raw.formattedAddress),
    shortAddress: str(raw.shortFormattedAddress),
    city: str(component("locality")?.longText) ?? str(component("administrative_area_level_1")?.longText),
    countryCode: str(component("country")?.shortText),
    location:
      typeof raw.location?.latitude === "number" && typeof raw.location?.longitude === "number"
        ? { lat: raw.location.latitude, lng: raw.location.longitude }
        : null,
    phoneNational: str(raw.nationalPhoneNumber),
    phoneInternational: str(raw.internationalPhoneNumber),
    website: str(raw.websiteUri),
    mapsUri: str(raw.googleMapsUri),
    businessStatus: str(raw.businessStatus),
    primaryType: str(raw.primaryType),
    primaryTypeLabel: str(raw.primaryTypeDisplayName?.text),
    types: Array.isArray(raw.types) ? raw.types.filter((t): t is string => typeof t === "string") : [],
    regularHours: normalizeGoogleHours(raw.regularOpeningHours?.periods),
    hoursText: raw.regularOpeningHours?.weekdayDescriptions ?? [],
    openNow: typeof raw.currentOpeningHours?.openNow === "boolean" ? raw.currentOpeningHours.openNow : null,
    priceLevel: str(raw.priceLevel),
    capabilities,
  };
}

// ── Network (official API only) ─────────────────────────────────────────

export class PlacesError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "not_found" | "rejected" | "quota" | "unavailable" | "unresolvable",
  ) {
    super(message);
  }
}

export type PlacesUsage = { calls: number; estimatedCostUsd: number };

type Fetcher = typeof fetch;

/** Injectable for tests; production uses global fetch and the env key. `apiKey: null` means "not configured". */
export type PlacesDeps = { fetch?: Fetcher; apiKey?: string | null };

function apiKeyFrom(deps: PlacesDeps): string | null {
  if (deps.apiKey !== undefined) return deps.apiKey;
  try {
    return serverEnv().GOOGLE_PLACES_API_KEY ?? null;
  } catch {
    return null;
  }
}

let active = 0;
const waiters: (() => void)[] = [];
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= PLACES_CONFIG.maxConcurrent) await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

/** Identical in-flight requests share one call (public Google data only — never tenant data). */
const inFlight = new Map<string, Promise<unknown>>();

async function placesRequest<T>(
  path: string,
  init: { method: "GET" | "POST"; fieldMask: string; body?: unknown },
  deps: PlacesDeps,
): Promise<T> {
  const key = apiKeyFrom(deps);
  const fetcher = deps.fetch ?? fetch;
  if (!key) throw new PlacesError("Google Places isn't configured on this platform.", "not_configured");

  const dedupeKey = `${init.method} ${path} ${init.fieldMask} ${JSON.stringify(init.body ?? null)}`;
  const existing = inFlight.get(dedupeKey);
  if (existing) return existing as Promise<T>;

  const run = withSlot(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= PLACES_CONFIG.maxRetries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200)));
      let response: Response;
      try {
        response = await fetcher(`${PLACES_CONFIG.endpoint}${path}`, {
          method: init.method,
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": init.fieldMask,
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(PLACES_CONFIG.timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        lastError = error;
        continue; // network error / timeout → retry
      }
      if (response.ok) return (await response.json()) as T;
      if (response.status === 404) throw new PlacesError("Google Maps couldn't find that place.", "not_found");
      if (response.status === 400) throw new PlacesError("Google Maps couldn't read that place.", "not_found");
      if (response.status === 401 || response.status === 403) {
        throw new PlacesError("The Google Places API key was rejected (check its restrictions and billing).", "rejected");
      }
      if (response.status === 429) {
        lastError = new PlacesError("Google Places quota reached — try again later.", "quota");
        continue;
      }
      if (response.status >= 500) {
        lastError = new PlacesError("Google Places is temporarily unavailable.", "unavailable");
        continue;
      }
      throw new PlacesError(`Google Places request failed (${response.status}).`, "unavailable");
    }
    throw lastError instanceof PlacesError ? lastError : new PlacesError("Google Places didn't respond in time.", "unavailable");
  });

  inFlight.set(dedupeKey, run);
  try {
    return await run;
  } finally {
    inFlight.delete(dedupeKey);
  }
}

/** Reads where a Google short link points (the `Location` header only — the page is never downloaded). */
export async function expandShortLink(url: string, deps: PlacesDeps = {}): Promise<string> {
  const fetcher = deps.fetch ?? fetch;
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const host = new URL(current).hostname.toLowerCase();
    if (!SHORT_LINK_HOSTS.has(host) && !isGoogleMapsHost(host)) {
      throw new PlacesError("That short link doesn't lead to Google Maps.", "unresolvable");
    }
    if (isGoogleMapsHost(host)) return current;
    const response = await fetcher(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(PLACES_CONFIG.timeoutMs) });
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      throw new PlacesError("That short link couldn't be expanded. Paste the full Google Maps link instead.", "unresolvable");
    }
    current = new URL(location, current).toString();
  }
  throw new PlacesError("That short link redirects too many times.", "unresolvable");
}

/**
 * Resolves owner input to a Place ID. Text Search asks for `places.id`
 * only (the IDs-only tier) — the details come from one Place Details call.
 */
export async function resolvePlaceId(
  input: PlaceInput,
  usage: PlacesUsage,
  deps: PlacesDeps = {},
): Promise<string> {
  let resolved = input;
  if (resolved.kind === "short_link") resolved = parsePlaceInput(await expandShortLink(resolved.url, deps));
  if (resolved.kind === "unsupported") throw new PlacesError(resolved.reason, "unresolvable");
  if (resolved.kind === "short_link") throw new PlacesError("That short link couldn't be resolved.", "unresolvable");
  if (resolved.kind === "place_id") return resolved.placeId;

  const body: Record<string, unknown> = { textQuery: resolved.query, pageSize: 1 };
  if (resolved.lat !== undefined && resolved.lng !== undefined) {
    body.locationBias = { circle: { center: { latitude: resolved.lat, longitude: resolved.lng }, radius: 500 } };
  }
  const result = await placesRequest<{ places?: { id?: string }[] }>(
    "/places:searchText",
    { method: "POST", fieldMask: "places.id", body },
    deps,
  );
  usage.calls += 1;
  usage.estimatedCostUsd += PLACES_CONFIG.estimatedCostUsd.textSearchIdsOnly;
  const id = result.places?.[0]?.id;
  if (!id) throw new PlacesError(`Google Maps has no match for "${resolved.query}".`, "not_found");
  return id;
}

export async function fetchPlaceDetails(
  placeId: string,
  usage: PlacesUsage,
  options: { languageCode?: string } = {},
  deps: PlacesDeps = {},
): Promise<PlaceDetails> {
  if (!PLACE_ID.test(placeId)) throw new PlacesError("That isn't a valid Place ID.", "not_found");
  const query = options.languageCode ? `?languageCode=${encodeURIComponent(options.languageCode)}` : "";
  const raw = await placesRequest<RawPlace>(`/places/${placeId}${query}`, { method: "GET", fieldMask: detailsFieldMask() }, deps);
  usage.calls += 1;
  usage.estimatedCostUsd += detailsCallCostUsd();
  return normalizePlace(raw);
}
