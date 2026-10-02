import { describe, expect, it } from "vitest";

import { convertMinor, crossRate, loadUsdRates, parseCurrencyApi, parseOpenErApi } from "@/server/currency/rates";

/** The shape open.er-api.com answers with (abridged). */
const openEr = (rates: Record<string, number>) => ({
  result: "success",
  provider: "https://www.exchangerate-api.com",
  time_last_update_utc: "Sat, 03 Oct 2026 00:02:31 +0000",
  base_code: "USD",
  rates,
});
/** 20+ currencies, as a real feed returns many. */
const MANY: Record<string, number> = {
  USD: 1, SAR: 3.75, AED: 3.6725, KWD: 0.3075, BHD: 0.376, OMR: 0.3845, QAR: 3.64, EGP: 48.5, JOD: 0.709, MAD: 9.9,
  TND: 3.1, EUR: 0.92, GBP: 0.78, JPY: 149.5, TRY: 34.2, INR: 83.9, CNY: 7.1, LBP: 89500, IQD: 1310, DZD: 134.5, KMF: 452.5,
};

describe("exchange-rate feeds (keyless)", () => {
  it("reads open.er-api.com", () => {
    const r = parseOpenErApi(openEr(MANY));
    expect(r?.source).toBe("open.er-api.com");
    expect(r?.rates.SAR).toBe(3.75);
    expect(r?.asOf).toBe("2026-10-03T00:02:31.000Z");
  });

  it("reads the currency-api feed (lower-case codes)", () => {
    const lower = Object.fromEntries(Object.entries(MANY).map(([k, v]) => [k.toLowerCase(), v]));
    const r = parseCurrencyApi({ date: "2026-10-03", usd: lower }, "currency-api (jsDelivr)");
    expect(r?.rates.KWD).toBe(0.3075);
    expect(r?.asOf).toBe("2026-10-03T00:00:00.000Z");
  });

  it("refuses broken or suspicious answers instead of guessing", () => {
    expect(parseOpenErApi({ result: "error", "error-type": "rate-limited" })).toBeNull();
    expect(parseOpenErApi(openEr({ ...MANY, USD: 1.2 }))).toBeNull(); // base must be USD = 1
    expect(parseOpenErApi(openEr({ USD: 1, SAR: 3.75 }))).toBeNull(); // too few currencies to be a real feed
    expect(parseOpenErApi(openEr({ ...MANY, SAR: -3 }))?.rates.SAR).toBeUndefined(); // bad values dropped
    expect(parseCurrencyApi(null, "x")).toBeNull();
  });

  it("falls back to the next source; no source → no rates", async () => {
    const calls: string[] = [];
    const lower = Object.fromEntries(Object.entries(MANY).map(([k, v]) => [k.toLowerCase(), v]));
    const r = await loadUsdRates(async (url) => {
      calls.push(url);
      if (url.includes("open.er-api.com")) throw new Error("network");
      return { date: "2026-10-03", usd: lower };
    });
    expect(r?.source).toBe("currency-api (jsDelivr)");
    expect(calls).toHaveLength(2);
    expect(await loadUsdRates(async () => ({ result: "error" }))).toBeNull();
  });

  it("cross rates and conversion match the database switch (round(minor × rate × 10^(toExp − fromExp)))", () => {
    const rate = crossRate(MANY, "SAR", "KWD")!;
    expect(rate).toBeCloseTo(0.082, 10);
    expect(convertMinor(1800, rate, 2, 3)).toBe(1476); // SAR 18.00 → KWD 1.476
    expect(convertMinor(15000, rate, 2, 3)).toBe(12300);
    expect(convertMinor(1500, crossRate(MANY, "USD", "JPY")!, 2, 0)).toBe(2243); // USD 15.00 → ¥2,243
    expect(crossRate(MANY, "SAR", "XYZ")).toBeNull();
  });
});
