import "server-only";

import { cookies, headers } from "next/headers";

import type { AgentExperienceProps } from "@/components/agent-public/agent-experience";
import { isLocale, LOCALE_COOKIE, LOCALES, type Locale } from "@/i18n/locales";
import { DEFAULT_VOICE_GENDER } from "@/components/agent-public/voice";
import { productImageUrl } from "@/lib/product-image";
import { getPopularityByProduct } from "@/server/agent-public/recommendations";
import type { PublicTenant } from "@/server/agent-public/tenant";
import type { PaymentMethod } from "@/server/commerce/cart";
import { findActiveTable } from "@/server/commerce/tables";
import { serviceClient } from "@/server/supabase/clients";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type AgentMessages = Record<string, unknown>;

export type LoadedAgentExperience =
  | { active: false; locale: Locale; businessName: string; inactiveText: string }
  | { active: true; locale: Locale; messages: { agent: AgentMessages }; props: AgentExperienceProps };

/**
 * Everything the Customer Agent page renders, read once, server-side, for
 * one already-resolved public tenant (`resolvePublicTenant` /
 * `resolveWidgetTenant` did the validation). Read-only and tenant-scoped:
 * the same service-role reads the page always made (settings, catalog,
 * currency, about, payment config, default branch, popularity), plus the
 * display-only fields the redesigned UI shows — product descriptions,
 * bookable services and the business's contact fields. No AI call, no
 * cart or conversation row is created by opening the page.
 */
export async function loadAgentExperience(
  tenant: PublicTenant,
  options: { surface: "external_agent" | "website_widget"; rawTableId?: string },
): Promise<LoadedAgentExperience> {
  const supabase = serviceClient();
  const activeTable = options.rawTableId ? await findActiveTable(supabase, tenant.id, options.rawTableId) : null;

  const [
    { data: settings },
    { data: categories },
    { data: products },
    { data: currencyRow },
    { data: aboutEntry },
    { data: paymentConfig },
    { data: branch },
    { data: contact },
    { data: services },
    popularity,
  ] = await Promise.all([
    supabase.from("tenant_settings").select("agent, checkout").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("categories").select("id, name").eq("tenant_id", tenant.id).eq("is_active", true).order("position"),
    supabase
      .from("products")
      .select("id, category_id, name, description, price_minor, image_path")
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .order("created_at"),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
    supabase
      .from("business_brain_entries")
      .select("content")
      .eq("tenant_id", tenant.id)
      .eq("entry_type", "about")
      .eq("status", "approved")
      .eq("is_active", true)
      .maybeSingle(),
    supabase.from("tenant_payment_config").select("enabled_methods").eq("tenant_id", tenant.id).maybeSingle(),
    supabase
      .from("branches")
      .select("name, phone, opening_hours, address")
      .eq("tenant_id", tenant.id)
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle(),
    supabase.from("tenants").select("contact_phone, contact_email, city").eq("id", tenant.id).maybeSingle(),
    supabase
      .from("bookable_services")
      .select("id, name, duration_minutes, price_minor")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true)
      .order("created_at"),
    getPopularityByProduct(supabase, tenant.id),
  ]);

  // The Agent's own screens are translated into every supported language, so customers can always pick
  // any of them (the business's enabled languages first); replies follow the language they picked.
  const enabled = tenant.enabledLanguages.filter(isLocale);
  const languages = [...enabled, ...LOCALES.filter((l) => !enabled.includes(l))];
  const locale = await uiLocale(enabled, tenant.defaultLanguage);
  // The payment page renders its own strings server-side, so they are not shipped to the Agent page.
  const { pay: _pay, ...messages } = ((await import(`../../../messages/${locale}.json`)).default as { agent: AgentMessages }).agent;
  void _pay;
  const businessName =
    tenant.businessName[locale] ?? tenant.businessName[tenant.defaultLanguage] ?? Object.values(tenant.businessName)[0] ?? tenant.slug;

  if (!settings?.agent?.active) {
    return { active: false, locale, businessName, inactiveText: String(messages.inactive ?? "") };
  }

  const branchName = branch ? (localized(branch.name, locale, tenant.defaultLanguage) ?? null) : null;
  const openingHours = (branch?.opening_hours ?? {}) as Record<string, { open: string; close: string }[]>;
  const today = WEEKDAY_KEYS[(new Date().getDay() + 6) % 7];
  const todayHours = branch && Object.keys(openingHours).length > 0 ? (openingHours[today] ?? []).map((s) => `${s.open}–${s.close}`) : null;

  return {
    active: true,
    locale,
    messages: { agent: messages },
    props: {
      slug: tenant.slug,
      surface: options.surface,
      locale,
      fallbackLocale: tenant.defaultLanguage,
      languages,
      businessName,
      businessTypeKey: tenant.businessTypeKey,
      assistantName: settings.agent.assistant_name ?? null,
      about: localized(aboutEntry?.content, locale, tenant.defaultLanguage, true),
      greeting: settings.agent.greeting ?? null,
      backgroundUrl: productImageUrl(settings.agent.background_path),
      voiceGender: settings.agent.voice === "female" ? "female" : DEFAULT_VOICE_GENDER,
      categories: (categories ?? []).map((c) => ({ id: c.id, name: c.name })),
      products: (products ?? []).map((p) => ({
        id: p.id,
        categoryId: p.category_id,
        name: p.name,
        // Descriptions are display-only: ship just the one this customer will read.
        description: descriptionFor(p.description, locale, tenant.defaultLanguage),
        priceMinor: p.price_minor,
        imageUrl: productImageUrl(p.image_path),
      })),
      services: (services ?? []).map((s) => ({ id: s.id, name: s.name, durationMinutes: s.duration_minutes, priceMinor: s.price_minor })),
      popularProductIds: [...popularity.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
      info: {
        branchName,
        address: localized(branch?.address, locale, tenant.defaultLanguage),
        city: contact?.city ?? null,
        phone: branch?.phone ?? contact?.contact_phone ?? null,
        email: contact?.contact_email ?? null,
        todayHours,
      },
      currency: tenant.currency,
      currencyExponent: currencyRow?.exponent ?? 2,
      orderingEnabled: settings.checkout?.ordering_enabled ?? false,
      fulfillmentTypes: settings.checkout?.fulfillment_types ?? ["pickup"],
      paymentMethods: (paymentConfig?.enabled_methods ?? []) as PaymentMethod[],
      activeTable: activeTable ? { id: activeTable.id, label: activeTable.label } : null,
    },
  };
}

/**
 * The interface language the agent host negotiated (`src/proxy.ts`): when
 * the customer picked it in the Agent's language bar (the locale cookie),
 * any supported language; when only guessed from the browser
 * (Accept-Language), one this business has enabled. Else the business's
 * own default language.
 */
async function uiLocale(languages: Locale[], defaultLanguage: string): Promise<Locale> {
  const negotiated = (await headers()).get("x-next-intl-locale");
  const picked = (await cookies()).get(LOCALE_COOKIE)?.value;
  // Chosen by the customer (language bar) — any supported language; only browser-guessed ones must be enabled.
  if (isLocale(negotiated) && (negotiated === picked || languages.includes(negotiated))) return negotiated;
  if (isLocale(defaultLanguage)) return defaultLanguage;
  return languages[0] ?? LOCALES[0];
}

function localized(content: unknown, locale: string, fallbackLocale: string, allowTextKey = false): string | null {
  if (!content || typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  const value = record[locale] ?? record[fallbackLocale] ?? (allowTextKey ? record.text : undefined) ?? record.en ?? Object.values(record)[0];
  return typeof value === "string" && value.trim() ? value : null;
}

function descriptionFor(content: Record<string, string> | null, locale: string, fallbackLocale: string): Record<string, string> {
  const text = localized(content, locale, fallbackLocale);
  return text ? { [locale]: text } : {};
}
