import { describe, expect, it } from "vitest";

import { MENA_CURRENCIES, groupCurrencies } from "@/lib/currencies";

describe("currency menus", () => {
  it("Middle East & North Africa first, then the rest, alphabetical within each", () => {
    expect(groupCurrencies(["USD", "TND", "EUR", "AED", "MAD", "JPY", "AED"])).toEqual({
      mena: ["AED", "MAD", "TND"],
      international: ["EUR", "JPY", "USD"],
    });
  });

  it("every Middle East & North Africa currency is grouped there — never the shekel", () => {
    for (const code of ["SAR", "AED", "QAR", "KWD", "BHD", "OMR", "JOD", "EGP", "LBP", "SYP", "IQD", "LYD", "TND", "DZD", "MAD", "SDG", "SSP", "YER", "IRR", "TRY", "MRU", "SOS", "DJF", "KMF", "ERN"]) {
      expect(MENA_CURRENCIES.has(code)).toBe(true);
    }
    expect(MENA_CURRENCIES.has("ILS")).toBe(false);
  });
});
