import { allRows } from "@/server/supabase/fetch-all";
import { normalizeProductName } from "@/server/brain/discovery/facts";
import { isReadableName } from "@/server/brain/discovery/name-quality";
import { parseAmount } from "@/server/agent-public/launch";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

import { addCatalogItems, type CatalogTenant } from "./bulk";
import { attachProductImages, type ImageAttachResult, type ImageFetcher, type StorageWriter } from "./product-images";
import { parseDuration, type CatalogItem } from "./import-extract";

/**
 * Business Brain → catalog: every product and service the Brain found (and
 * the owner hasn't rejected) appears on the Products & Services and
 * Bookings pages — as a draft (products) or inactive (services), never
 * shown to customers until the owner approves it in the Brain (which
 * activates it, see the `sync_brain_catalog_draft` trigger) or switches it
 * on themselves. Already-approved findings are added active.
 *
 * Runs when an analysis finishes and whenever the owner approves a
 * finding, and on demand from the Products page ("Add from Business
 * Brain") — it is idempotent: each item is linked to its Brain fact, so it
 * is never added twice, and names already in the catalog (including ones
 * the owner deleted) are left alone.
 *
 * A price listed in another currency is never converted: the product is
 * added as a draft that needs the owner's own price. A finding without any
 * price is not guessed at (it stays in the Brain).
 */
export type BrainCatalogResult = {
  products: number;
  services: number;
  /** Of the products added, how many still need the owner's price (listed in another currency). */
  needsPrice: number;
  /** Photos found on the analysed pages, stored for Brain products that had none. */
  images: ImageAttachResult;
  failed: boolean;
};

type Finding = CatalogItem & { factKey: string; approved: boolean; kind: "product" | "service"; priceKey: string };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A menu page read without its spacing glues the section, name, description
 * and button together ("Drinks CappuccinoEspresso with steamed milk Add").
 * Such a finding is the same item as a cleaner one with the same price whose
 * name runs straight into a capital letter inside it — it is dropped.
 */
export function isGluedDuplicate(name: string, priceKey: string, others: { name: string; priceKey: string }[]): boolean {
  return others.some(
    (o) =>
      o.priceKey === priceKey &&
      o.name.length < name.length &&
      new RegExp(`${escapeRegExp(o.name)}(?=\\p{Lu})`, "u").test(name),
  );
}

export async function draftBrainCatalog(
  supabase: TypedSupabaseClient,
  tenant: CatalogTenant,
  /** `storage`: where photos are written (the service-role bucket writer); without it no photos are fetched. */
  options: { storage?: StorageWriter; imageBudgetMs?: number; fetchImage?: ImageFetcher } = {},
): Promise<BrainCatalogResult> {
  const [{ data: entries }, { data: products }, { data: services }] = await Promise.all([
    allRows((from, to) =>
      supabase
        .from("business_brain_entries")
        .select("fact_key, entry_type, status, content")
        .eq("tenant_id", tenant.id)
        .in("entry_type", ["product_candidate", "service_candidate"])
        .in("status", ["pending_review", "approved"])
        .eq("is_active", true)
        .not("fact_key", "is", null)
        .order("status") // approved before pending_review: the owner's version wins a fact
        .order("id")
        .range(from, to),
    ),
    // Every product and service already there (however many), so none is added twice.
    allRows((from, to) => supabase.from("products").select("name, brain_fact_key").eq("tenant_id", tenant.id).order("id").range(from, to)),
    allRows((from, to) => supabase.from("bookable_services").select("name, brain_fact_key").eq("tenant_id", tenant.id).order("id").range(from, to)),
  ]);

  const known = (rows: { name: Record<string, string> | null; brain_fact_key: string | null }[] | null) => ({
    keys: new Set((rows ?? []).map((r) => r.brain_fact_key).filter(Boolean)),
    names: new Set(
      (rows ?? []).flatMap((r) => Object.values(r.name ?? {}).map((n) => normalizeProductName(String(n)))),
    ),
  });
  const existing = { product: known(products), service: known(services) };
  const tenantCurrency = tenant.currency.toUpperCase();

  // Every readable, priced finding (also those already in the catalog — they
  // still identify glued duplicates).
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const e of entries ?? []) {
    const kind = e.entry_type === "service_candidate" ? "service" : "product";
    const factKey = e.fact_key as string;
    if (seen.has(`${kind}:${factKey}`)) continue;
    seen.add(`${kind}:${factKey}`);
    const c = (e.content ?? {}) as {
      normalized?: { name?: unknown; amount?: unknown; currency?: unknown };
      category?: unknown;
      description?: unknown;
      duration_minutes?: unknown;
    };
    const name = typeof c.normalized?.name === "string" ? c.normalized.name.trim().slice(0, 160) : "";
    if (!name || !isReadableName(name)) continue;
    const currency = typeof c.normalized?.currency === "string" ? c.normalized.currency.toUpperCase() : null;
    const amount = c.normalized?.amount;
    const price = parseAmount(amount);
    if (kind === "product" && price === null) continue;
    const foreign = price !== null && currency !== tenantCurrency;
    const description =
      typeof c.description === "string" && c.description.trim() ? c.description.trim().slice(0, 2000) : null;
    findings.push({
      kind,
      factKey,
      approved: e.status === "approved",
      name,
      priceKey: `${price ?? ""} ${currency ?? ""}`,
      priceMajor: foreign ? null : price,
      ...(foreign && kind === "product"
        ? { sourcePrice: { amount: String(amount), currency } }
        : {}),
      category: typeof c.category === "string" && c.category.trim() ? c.category.trim().slice(0, 120) : null,
      description,
      durationMinutes:
        typeof c.duration_minutes === "number" && c.duration_minutes >= 5 && c.duration_minutes <= 480
          ? Math.round(c.duration_minutes)
          : parseDuration(`${name} ${description ?? ""}`),
    });
  }

  const picked = { product: [] as Finding[], service: [] as Finding[] };
  for (const f of findings) {
    const have = existing[f.kind];
    if (have.keys.has(f.factKey) || have.names.has(normalizeProductName(f.name))) continue;
    if (isGluedDuplicate(f.name, f.priceKey, findings.filter((o) => o.kind === f.kind))) continue;
    picked[f.kind].push(f);
    have.names.add(normalizeProductName(f.name));
  }

  const isApproved = (i: CatalogItem & { factKey?: string | null }) => (i as { approved?: boolean }).approved === true;
  const [p, s] = await Promise.all([
    addCatalogItems(supabase, tenant, picked.product, { kind: "product", source: "brain", active: isApproved }),
    addCatalogItems(supabase, tenant, picked.service, { kind: "service", source: "brain", active: isApproved }),
  ]);
  const images = await brainProductImages(supabase, tenant.id, options).catch(() => ({ attached: 0, failed: 0, skipped: 0 }));
  return {
    products: p.ok ? p.added : 0,
    services: s.ok ? s.added : 0,
    needsPrice: p.ok ? picked.product.filter((i) => i.sourcePrice).length : 0,
    images,
    failed: !p.ok || !s.ok,
  };
}

/**
 * Photos for Brain products: the pages the Brain read keep each item's
 * picture with it (`brain_source_documents.extraction` — offerings and item
 * cards). A Brain product without a photo gets the one found under its
 * name; products the owner gave a photo, or deleted, are left alone.
 */
async function brainProductImages(
  supabase: TypedSupabaseClient,
  tenantId: string,
  options: { storage?: StorageWriter; imageBudgetMs?: number; fetchImage?: ImageFetcher },
): Promise<ImageAttachResult> {
  const none = { attached: 0, failed: 0, skipped: 0 };
  if (!options.storage) return none;
  const { data: products } = await supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("source", "brain")
    .neq("status", "archived")
    .is("image_path", null)
    .limit(500);
  if (!products || products.length === 0) return none;

  const { data: docs } = await supabase
    .from("brain_source_documents")
    .select("extraction")
    .eq("tenant_id", tenantId)
    .not("extraction", "is", null)
    .order("last_processed_at", { ascending: false })
    .limit(200);
  const pictures = new Map<string, string>();
  for (const doc of docs ?? []) {
    const x = (doc.extraction ?? {}) as { offerings?: { name?: unknown; imageUrl?: unknown }[]; cards?: { name?: unknown; imageUrl?: unknown }[] };
    for (const item of [...(x.offerings ?? []), ...(x.cards ?? [])]) {
      if (typeof item?.name !== "string" || typeof item.imageUrl !== "string" || !item.imageUrl) continue;
      const key = normalizeProductName(item.name);
      if (key && !pictures.has(key)) pictures.set(key, item.imageUrl);
    }
  }
  const jobs = products.flatMap((p) => {
    const url = Object.values(p.name ?? {})
      .map((n) => pictures.get(normalizeProductName(String(n))))
      .find(Boolean);
    return url ? [{ productId: p.id, imageUrl: url }] : [];
  });
  if (jobs.length === 0) return none;
  return attachProductImages(supabase, options.storage, tenantId, jobs, {
    budgetMs: options.imageBudgetMs ?? 45_000,
    fetcher: options.fetchImage,
  });
}
