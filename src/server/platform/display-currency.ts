import "server-only";

import { cookies } from "next/headers";

import { formatMoney } from "@/lib/money";
import { convertMinor, crossRate, loadUsdRates } from "@/server/currency/rates";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * The Super Admin's display currency (header currency bar): amounts in the
 * Super Admin console are shown converted into it, at today's public rates
 * (src/server/currency/rates.ts). A viewing preference only — kept in this
 * person's own cookie; nothing stored is converted or changed. Without a
 * choice (or without a rate) amounts show as recorded.
 */
export const DISPLAY_CURRENCY_COOKIE = "sm_display_currency";

export type DisplayMoney = {
  /** The chosen currency, or null to show amounts as recorded. */
  code: string | null;
  /** An amount in minor units of `currency`, in the display currency. */
  money: (minor: number, currency: string, exponent: number) => string;
  /** The same amount in the display currency's minor units (unchanged when there's no choice or no rate) — for charts. */
  convert: (minor: number, currency: string, exponent: number) => { minor: number; currency: string; exponent: number };
  /** An amount in US dollars (AI and voice costs), in the display currency. */
  usd: (dollars: number | null, digits?: number) => string;
};

export async function readDisplayCurrency(): Promise<string | null> {
  const value = (await cookies()).get(DISPLAY_CURRENCY_COOKIE)?.value;
  return value && /^[A-Z]{3}$/.test(value) ? value : null;
}

const plainUsd = (dollars: number | null, digits = 2) => (dollars === null ? "—" : `$${dollars.toFixed(digits)}`);

export async function displayMoney(supabase: TypedSupabaseClient, locale: string): Promise<DisplayMoney> {
  const code = await readDisplayCurrency();
  const asRecorded: DisplayMoney = {
    code: null,
    money: (minor, currency, exponent) => formatMoney(minor, currency, exponent, locale),
    convert: (minor, currency, exponent) => ({ minor, currency, exponent }),
    usd: plainUsd,
  };
  if (!code) return asRecorded;
  const [rates, { data: currency }] = await Promise.all([
    loadUsdRates(),
    supabase.from("currencies").select("exponent").eq("code", code).maybeSingle(),
  ]);
  if (!rates || !currency) return asRecorded;
  const target = currency.exponent;
  const convert = (minor: number, from: string, exponent: number) => {
    const rate = from === code ? 1 : crossRate(rates.rates, from, code);
    return rate === null ? { minor, currency: from, exponent } : { minor: convertMinor(minor, rate, exponent, target), currency: code, exponent: target };
  };
  return {
    code,
    convert,
    money: (minor, from, exponent) => {
      const shown = convert(minor, from, exponent);
      return formatMoney(shown.minor, shown.currency, shown.exponent, locale);
    },
    usd: (dollars, digits = 2) => {
      if (dollars === null) return "—";
      const rate = crossRate(rates.rates, "USD", code);
      if (rate === null) return plainUsd(dollars, digits);
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(dollars * rate);
      } catch {
        return `${(dollars * rate).toFixed(digits)} ${code}`;
      }
    },
  };
}
