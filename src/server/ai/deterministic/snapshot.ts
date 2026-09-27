import "server-only";

import type { BrainSnapshot } from "./match";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/** Builds the deterministic matchers' input from real Phase 1/2 data — never invented, never AI-inferred. */
export async function buildBrainSnapshot(
  supabase: TypedSupabaseClient,
  tenant: { id: string; currency: string; slug: string },
  locale: string,
): Promise<BrainSnapshot> {
  const [{ data: settings }, { data: currency }, { data: products }, { data: branch }, { data: entries }] =
    await Promise.all([
      supabase.from("tenant_settings").select("agent").eq("tenant_id", tenant.id).maybeSingle(),
      supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
      supabase.from("products").select("name, price_minor").eq("status", "active"),
      supabase
        .from("branches")
        .select("name, phone, opening_hours")
        .eq("tenant_id", tenant.id)
        .eq("is_default", true)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("business_brain_entries")
        .select("entry_type, entry_key, content")
        .eq("status", "approved")
        .eq("is_active", true)
        .in("entry_type", ["delivery_info", "pickup_info", "payment_methods", "policy", "faq"]),
    ]);

  const bestText = (content: unknown): string | null => {
    if (!content || typeof content !== "object") return null;
    const record = content as Record<string, unknown>;
    const value = record[locale] ?? record.en ?? Object.values(record)[0];
    return typeof value === "string" ? value : null;
  };

  const notes: BrainSnapshot["notes"] = {};
  const faqs: BrainSnapshot["faqs"] = [];
  for (const entry of entries ?? []) {
    const text = bestText(entry.content);
    if (!text) continue;
    if (entry.entry_type === "faq") faqs.push({ entryKey: entry.entry_key, answer: text });
    else if (
      entry.entry_type === "delivery_info" ||
      entry.entry_type === "pickup_info" ||
      entry.entry_type === "payment_methods" ||
      entry.entry_type === "policy"
    ) {
      notes[entry.entry_type] = text;
    }
  }

  return {
    locale,
    assistantName: settings?.agent?.assistant_name ?? null,
    greeting: settings?.agent?.greeting ?? null,
    currency: tenant.currency,
    currencyExponent: currency?.exponent ?? 2,
    products: (products ?? []).map((p) => ({ name: p.name[locale] ?? Object.values(p.name)[0] ?? "", priceMinor: p.price_minor })),
    defaultBranch: branch
      ? {
          name: branch.name[locale] ?? Object.values(branch.name)[0] ?? tenant.slug,
          phone: branch.phone,
          openingHours: branch.opening_hours as Record<string, { open: string; close: string }[]>,
        }
      : null,
    notes,
    faqs,
  };
}
