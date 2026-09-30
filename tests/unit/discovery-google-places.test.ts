import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  detailsFieldMask,
  expandShortLink,
  fetchPlaceDetails,
  normalizeGoogleHours,
  normalizePlace,
  parsePlaceInput,
  PlacesError,
  resolvePlaceId,
} from "@/server/brain/discovery/google-places";

const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";

describe("parsePlaceInput", () => {
  it("accepts a bare Place ID", () => {
    expect(parsePlaceInput(PLACE)).toEqual({ kind: "place_id", placeId: PLACE });
  });

  it("reads Place IDs from Maps URL parameters", () => {
    expect(parsePlaceInput(`https://www.google.com/maps/search/?api=1&query=cafe&query_place_id=${PLACE}`)).toEqual({
      kind: "place_id",
      placeId: PLACE,
    });
    expect(parsePlaceInput(`https://maps.google.com/?q=place_id:${PLACE}`)).toEqual({ kind: "place_id", placeId: PLACE });
  });

  it("turns a /maps/place link into a name search biased to its coordinates", () => {
    expect(parsePlaceInput("https://www.google.com/maps/place/Roasters+Caf%C3%A9/@24.7136,46.6753,17z/data=!3m1")).toEqual({
      kind: "search",
      query: "Roasters Café",
      lat: 24.7136,
      lng: 46.6753,
    });
  });

  it("treats plain text as a name search", () => {
    expect(parsePlaceInput("Roasters Café Riyadh")).toEqual({ kind: "search", query: "Roasters Café Riyadh" });
  });

  it("recognises share links without fetching them", () => {
    expect(parsePlaceInput("https://maps.app.goo.gl/AbCdEf123")).toEqual({ kind: "short_link", url: "https://maps.app.goo.gl/AbCdEf123" });
  });

  it("refuses non-Google hosts and cid-only links", () => {
    expect(parsePlaceInput("https://evil.example.com/maps/place/x").kind).toBe("unsupported");
    expect(parsePlaceInput("https://google.com.evil.io/maps/place/x").kind).toBe("unsupported");
    expect(parsePlaceInput("https://maps.google.com/?cid=1234567890").kind).toBe("unsupported");
    expect(parsePlaceInput("").kind).toBe("unsupported");
  });
});

describe("normalizeGoogleHours", () => {
  it("maps Google's Sunday-first periods to branch-hours keys, split shifts sorted", () => {
    expect(
      normalizeGoogleHours([
        { open: { day: 1, hour: 16, minute: 0 }, close: { day: 1, hour: 23, minute: 30 } },
        { open: { day: 1, hour: 7, minute: 0 }, close: { day: 1, hour: 12, minute: 0 } },
        { open: { day: 0, hour: 9, minute: 5 }, close: { day: 0, hour: 17, minute: 0 } },
      ]),
    ).toEqual({
      mon: [
        { open: "07:00", close: "12:00" },
        { open: "16:00", close: "23:30" },
      ],
      sun: [{ open: "09:05", close: "17:00" }],
    });
  });

  it("represents always-open as 00:00–24:00 and missing data as null", () => {
    expect(normalizeGoogleHours([{ open: { day: 0, hour: 0, minute: 0 } }])).toEqual({ sun: [{ open: "00:00", close: "24:00" }] });
    expect(normalizeGoogleHours(undefined)).toBeNull();
    expect(normalizeGoogleHours([])).toBeNull();
  });
});

describe("normalizePlace", () => {
  it("keeps only typed, non-empty values", () => {
    const place = normalizePlace({
      id: PLACE,
      displayName: { text: "Roasters Café" },
      primaryType: "coffee_shop",
      types: ["coffee_shop", "cafe", 3 as unknown as string],
      addressComponents: [
        { longText: "Riyadh", types: ["locality"] },
        { longText: "Saudi Arabia", shortText: "SA", types: ["country"] },
      ],
      location: { latitude: 24.7, longitude: 46.6 },
      nationalPhoneNumber: " ",
      delivery: true,
      dineIn: "yes",
    });
    expect(place.name).toBe("Roasters Café");
    expect(place.city).toBe("Riyadh");
    expect(place.countryCode).toBe("SA");
    expect(place.types).toEqual(["coffee_shop", "cafe"]);
    expect(place.phoneNational).toBeNull();
    expect(place.capabilities).toEqual({ delivery: true });
  });
});

describe("Places API calls", () => {
  const deps = (fetcher: unknown) => ({ fetch: fetcher as typeof fetch, apiKey: "test-places-key-000" });

  it("uses the IDs-only field mask for search, then one details call with the central mask", async () => {
    const calls: { url: string; mask: string | null }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({ url, mask: headers.get("X-Goog-FieldMask") });
      if (url.endsWith(":searchText")) return Response.json({ places: [{ id: PLACE }] });
      return Response.json({ id: PLACE, displayName: { text: "Roasters" }, primaryType: "cafe" });
    }) as typeof fetch;

    const usage = { calls: 0, estimatedCostUsd: 0 };
    const id = await resolvePlaceId({ kind: "search", query: "Roasters" }, usage, deps(fetcher));
    const details = await fetchPlaceDetails(id, usage, { languageCode: "ar" }, deps(fetcher));
    expect(details.name).toBe("Roasters");
    expect(calls[0].mask).toBe("places.id");
    expect(calls[1].url).toContain(`/places/${PLACE}?languageCode=ar`);
    expect(calls[1].mask).toBe(detailsFieldMask());
    expect(usage.calls).toBe(2);
    expect(usage.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("does not retry a rejected key, and reports it clearly", async () => {
    let n = 0;
    const fetcher = (async () => {
      n += 1;
      return new Response("denied", { status: 403 });
    }) as unknown as typeof fetch;
    const usage = { calls: 0, estimatedCostUsd: 0 };
    await expect(fetchPlaceDetails(PLACE, usage, {}, deps(fetcher))).rejects.toMatchObject({ code: "rejected" });
    expect(n).toBe(1);
    expect(usage.calls).toBe(0);
  });

  it("is a clear not_configured error without a key", async () => {
    const usage = { calls: 0, estimatedCostUsd: 0 };
    let called = false;
    const fetcher = (async () => {
      called = true;
      return Response.json({});
    }) as unknown as typeof fetch;
    const error = await fetchPlaceDetails(PLACE, usage, {}, { fetch: fetcher, apiKey: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlacesError);
    expect(error).toMatchObject({ code: "not_configured" });
    expect(called).toBe(false);
  });

  it("expands a short link from its Location header only, and only toward Google Maps", async () => {
    const good = (async () =>
      new Response(null, { status: 302, headers: { location: "https://www.google.com/maps/place/Roasters/@24.1,46.2,17z" } })) as unknown as typeof fetch;
    await expect(expandShortLink("https://maps.app.goo.gl/x", { fetch: good })).resolves.toContain("google.com/maps/place/Roasters");

    const evil = (async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })) as unknown as typeof fetch;
    await expect(expandShortLink("https://maps.app.goo.gl/x", { fetch: evil })).rejects.toMatchObject({ code: "unresolvable" });
  });
});
