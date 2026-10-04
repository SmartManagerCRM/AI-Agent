"use server";

import { cookies } from "next/headers";

import { DISPLAY_CURRENCY_COOKIE } from "@/server/platform/display-currency";
import { loadSiteInfo } from "@/server/site/public-data";

/**
 * The website header's currency choice: prices are shown converted into it
 * at today's public rates (the same display-currency preference and rates as
 * the console — src/server/platform/display-currency.ts). A viewing
 * preference only, in the visitor's own cookie; what a plan is billed in
 * never changes.
 */
export async function setSiteCurrencyAction(code: string): Promise<boolean> {
  const { currencies } = await loadSiteInfo();
  if (!/^[A-Z]{3}$/.test(code) || !currencies.includes(code)) return false;
  (await cookies()).set(DISPLAY_CURRENCY_COOKIE, code, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return true;
}
