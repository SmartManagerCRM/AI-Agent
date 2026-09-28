import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Deterministic recommendation signal (spec §9/§10) — real popularity from
 * this tenant's own order history, never a fabricated "Popular" badge.
 * Returns an empty map for a business with no order history yet (an
 * honest zero, not an invented ranking).
 */
export async function getPopularityByProduct(
  supabase: TypedSupabaseClient,
  tenantId: string,
  sinceDays = 60,
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .gte("created_at", since);
  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) return new Map();

  const { data: items } = await supabase
    .from("order_items")
    .select("product_id, quantity")
    .eq("tenant_id", tenantId)
    .in("order_id", orderIds);

  const counts = new Map<string, number>();
  for (const item of items ?? []) {
    if (!item.product_id) continue;
    counts.set(item.product_id, (counts.get(item.product_id) ?? 0) + item.quantity);
  }
  return counts;
}

/** The single most popular product outside `excludeCategoryId`, if any real signal exists — a real "pairs well with" cross-sell, not invented. */
export function pickCrossSell<T extends { id: string; categoryId: string | null }>(
  products: T[],
  popularity: Map<string, number>,
  excludeCategoryId: string | null,
  excludeProductIds: Set<string>,
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const product of products) {
    if (excludeProductIds.has(product.id)) continue;
    if (excludeCategoryId !== null && product.categoryId === excludeCategoryId) continue;
    const score = popularity.get(product.id) ?? 0;
    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  }
  return best;
}
