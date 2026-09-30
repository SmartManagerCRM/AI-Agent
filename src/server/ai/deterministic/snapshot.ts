import "server-only";

import type { BrainSnapshot } from "./match";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Builds the deterministic matchers' input from real Phase 1/2 data — never invented, never AI-inferred.
 *
 * Every tenant-owned query here filters by `tenant_id` explicitly: the public Agent calls this with the
 * service-role client (no RLS), so the filter is the only thing keeping one business's products and
 * knowledge out of another business's Agent.
 */
export async function buildBrainSnapshot(
  supabase: TypedSupabaseClient,
  tenant: { id: string; currency: string; slug: string },
  locale: string,
  conversationId?: string,
): Promise<BrainSnapshot> {
  const [{ data: settings }, { data: currency }, { data: products }, { data: branch }, { data: entries }, returningCustomer] =
    await Promise.all([
      supabase.from("tenant_settings").select("agent").eq("tenant_id", tenant.id).maybeSingle(),
      supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
      supabase.from("products").select("name, price_minor").eq("tenant_id", tenant.id).eq("status", "active"),
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
        .eq("tenant_id", tenant.id)
        .eq("status", "approved")
        .eq("is_active", true)
        .in("entry_type", ["about", "delivery_info", "pickup_info", "payment_methods", "policy", "faq"]),
      loadReturningCustomer(supabase, tenant.id, locale, conversationId),
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
      entry.entry_type === "about" ||
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
    returningCustomer,
  };
}

/**
 * This exact conversation's own real past orders — never another
 * customer's, never inferred. A conversation persists across visits via
 * its own session cookie (`getOrCreateConversation`), so this is genuine
 * memory of the same browser/customer, not a guess.
 */
async function loadReturningCustomer(
  supabase: TypedSupabaseClient,
  tenantId: string,
  locale: string,
  conversationId?: string,
): Promise<BrainSnapshot["returningCustomer"]> {
  if (!conversationId) return null;

  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .neq("status", "cancelled");
  if (!orders || orders.length === 0) return null;

  const { data: items } = await supabase
    .from("order_items")
    .select("product_name, quantity")
    .eq("tenant_id", tenantId)
    .in(
      "order_id",
      orders.map((o) => o.id),
    );
  const countByName = new Map<string, number>();
  for (const item of items ?? []) {
    const name = item.product_name[locale] ?? Object.values(item.product_name)[0] ?? "";
    if (!name) continue;
    countByName.set(name, (countByName.get(name) ?? 0) + item.quantity);
  }
  const topProducts = [...countByName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  return { orderCount: orders.length, topProducts };
}
