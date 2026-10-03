"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { actionT } from "@/server/i18n/action-messages";

import { convertMinor, crossRate, loadUsdRates } from "./rates";

/**
 * Switching a business's currency from the console header. The preview
 * shows the live rate and what will change; the switch fetches the rates
 * again (the same cached hour) and hands them to `change_business_currency`,
 * which converts every price in one transaction. Rates only ever come from
 * the public feeds in ./rates — never typed in or guessed.
 */

const input = z.object({
  locale: z.string(),
  slug: z.string().min(1),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
});

export type CurrencyPreview =
  | {
      ok: true;
      from: string;
      to: string;
      rate: number;
      source: string;
      asOf: string | null;
      products: number;
      services: number;
      coupons: number;
      /** Drafts that get the price listed in the new currency (exact, not converted). */
      pricedFromListing: number;
      examples: { name: string; beforeMinor: number; afterMinor: number }[];
      deliveryFee: { beforeMinor: number; afterMinor: number } | null;
      fromExponent: number;
      toExponent: number;
      /** An online payment provider is set up: it must accept the new currency. */
      paymentProvider: string | null;
    }
  | { ok: false; message: string };

export async function previewCurrencySwitchAction(raw: { locale: string; slug: string; currency: string }): Promise<CurrencyPreview> {
  const t = await actionT(raw.locale);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: t("currency.choose") };
  const to = parsed.data.currency.toUpperCase();
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  if (to === tenant.currency) return { ok: false, message: t("currency.already", { code: to }) };
  const supabase = await createUserClient();

  const [{ data: currencies }, usd, { data: products }, { count: services }, { count: coupons }, { data: settings }, { data: payment }] =
    await Promise.all([
      supabase.from("currencies").select("code, exponent").in("code", [tenant.currency, to]),
      loadUsdRates(),
      supabase
        .from("products")
        .select("name, price_minor, source_price, status")
        .eq("tenant_id", tenant.id)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase.from("bookable_services").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).not("price_minor", "is", null),
      supabase.from("coupons").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
      supabase.from("tenant_settings").select("checkout").eq("tenant_id", tenant.id).maybeSingle(),
      supabase.from("tenant_payment_config").select("enabled_methods").eq("tenant_id", tenant.id).maybeSingle(),
    ]);
  const fromExp = currencies?.find((c) => c.code === tenant.currency)?.exponent;
  const toExp = currencies?.find((c) => c.code === to)?.exponent;
  if (fromExp === undefined || toExp === undefined) return { ok: false, message: t("currency.unsupported", { code: to }) };
  if (!usd) {
    return { ok: false, message: t("currency.ratesDown") };
  }
  const rate = crossRate(usd.rates, tenant.currency, to);
  if (!rate) return { ok: false, message: t("currency.noRate", { from: tenant.currency, to }) };

  const priced = (products ?? []).filter((p) => !p.source_price);
  const label = (n: Record<string, string>) => n[parsed.data.locale] ?? Object.values(n)[0] ?? "";
  const fee = (settings?.checkout as { delivery_fee_minor?: number } | null)?.delivery_fee_minor;
  const online = (payment?.enabled_methods ?? []).filter((m) => m === "moyasar" || m === "tap");
  return {
    ok: true,
    from: tenant.currency,
    to,
    rate,
    source: usd.source,
    asOf: usd.asOf,
    products: priced.length,
    services: services ?? 0,
    coupons: coupons ?? 0,
    pricedFromListing: (products ?? []).filter((p) => p.source_price?.currency?.toUpperCase() === to).length,
    examples: priced
      .filter((p) => p.status === "active")
      .concat(priced.filter((p) => p.status !== "active"))
      .slice(0, 3)
      .map((p) => ({ name: label(p.name), beforeMinor: p.price_minor, afterMinor: convertMinor(p.price_minor, rate, fromExp, toExp) })),
    deliveryFee: typeof fee === "number" && fee > 0 ? { beforeMinor: fee, afterMinor: convertMinor(fee, rate, fromExp, toExp) } : null,
    fromExponent: fromExp,
    toExponent: toExp,
    paymentProvider: online.length > 0 ? online.map((m) => (m === "tap" ? "Tap" : "Moyasar")).join(" / ") : null,
  };
}

export type CurrencySwitchResult = { ok: true; message: string } | { ok: false; message: string };

export async function switchCurrencyAction(raw: { locale: string; slug: string; currency: string }): Promise<CurrencySwitchResult> {
  const t = await actionT(raw.locale);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: t("currency.choose") };
  const to = parsed.data.currency.toUpperCase();
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const usd = await loadUsdRates();
  if (!usd) return { ok: false, message: t("currency.ratesDownNothing") };

  // Only the currencies the platform supports go into the saved snapshot.
  const { data: supported } = await (await createUserClient()).from("currencies").select("code");
  const snapshot: Record<string, number> = {};
  for (const { code } of supported ?? []) if (usd.rates[code]) snapshot[code] = usd.rates[code];

  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("change_business_currency", {
    p_tenant_id: tenant.id,
    p_currency: to,
    p_usd_rates: snapshot,
    p_rate_source: usd.source,
    p_rates_as_of: usd.asOf,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, message: t("currency.noPermission") };
    if (/no exchange rate/.test(error.message)) return { ok: false, message: t("currency.noRateNothing", { code: to }) };
    return { ok: false, message: t("currency.failed") };
  }
  const result = data as { products?: number; services?: number; priced_from_listing?: number } | null;
  // Every console page shows amounts in the business currency.
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}`, "layout");
  return {
    ok: true,
    message:
      t("currency.done", { code: to, products: result?.products ?? 0, services: result?.services ?? 0 }) +
      ((result?.priced_from_listing ?? 0) > 0 ? t("currency.listed", { n: result?.priced_from_listing ?? 0, code: to }) : ""),
  };
}
