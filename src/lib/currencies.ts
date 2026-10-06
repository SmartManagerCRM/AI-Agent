/** Currencies of the Middle East & North Africa — listed first in the currency pickers. */
export const MENA_CURRENCIES = new Set([
  "SAR", "AED", "QAR", "KWD", "BHD", "OMR", "JOD", "EGP", "LBP", "SYP", "IQD", "LYD", "TND", "DZD", "MAD",
  "SDG", "SSP", "YER", "IRR", "TRY", "MRU", "SOS", "DJF", "KMF", "ERN",
]);

/** Middle East & North Africa first, then the rest; alphabetical within each. */
export function groupCurrencies(codes: string[]): { mena: string[]; international: string[] } {
  const sorted = [...new Set(codes)].sort();
  return { mena: sorted.filter((c) => MENA_CURRENCIES.has(c)), international: sorted.filter((c) => !MENA_CURRENCIES.has(c)) };
}
