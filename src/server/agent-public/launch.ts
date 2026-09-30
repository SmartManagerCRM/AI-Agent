/**
 * Go live: explicit, minimum launch requirements — separate from Business
 * Brain readiness (a 70–85% Brain can go live; a 100% one can't if, say,
 * ordering is on with nothing to sell). The same rules are enforced again
 * in `publish_agent` on the database; this module explains them to the
 * owner. Pure.
 */
export type LaunchItem = { key: string; label: string; ok: boolean; detail: string; required: boolean };

export type LaunchInput = {
  businessName: string;
  businessTypeLabel: string | null;
  approvedKnowledge: number;
  activeProducts: number;
  pricedProducts: number;
  /** Readable, priced, same-currency approved Brain products that can be added to the catalog at publish. */
  importableProducts: number;
  orderingEnabled: boolean;
  bookingServices: number;
  subscription: "none" | "entitled" | "expired";
  optional: { policies: boolean; faq: boolean; description: boolean; hours: boolean };
};

export function launchChecklist(i: LaunchInput): { items: LaunchItem[]; canPublish: boolean } {
  const sellable = i.pricedProducts + i.importableProducts;
  const items: LaunchItem[] = [
    { key: "name", label: "Business name", required: true, ok: i.businessName.trim().length > 0, detail: i.businessName || "Missing" },
    { key: "type", label: "Business type", required: true, ok: Boolean(i.businessTypeLabel), detail: i.businessTypeLabel ?? "Missing" },
    {
      key: "identity",
      label: "Approved business information",
      required: true,
      ok: i.approvedKnowledge > 0 || i.activeProducts > 0,
      detail:
        i.approvedKnowledge > 0 || i.activeProducts > 0
          ? `${i.approvedKnowledge} approved fact(s), ${i.activeProducts} catalog product(s)`
          : "Approve at least one fact in Review, or add a product",
    },
    {
      key: "products",
      label: i.orderingEnabled ? "Products with prices (online ordering is on)" : "Products with prices",
      required: i.orderingEnabled,
      ok: sellable > 0,
      detail:
        sellable > 0
          ? `${i.pricedProducts} in the catalog${i.importableProducts ? ` + ${i.importableProducts} approved to add now` : ""}`
          : i.orderingEnabled
            ? "Add a product with a price, or turn ordering off"
            : "None yet — customers can still chat and ask questions",
    },
    {
      key: "interaction",
      label: "Something customers can do",
      required: true,
      ok: i.approvedKnowledge > 0 || sellable > 0 || i.bookingServices > 0,
      detail: [
        "Chat with your Agent",
        sellable > 0 ? "browse products" : null,
        i.orderingEnabled && sellable > 0 ? "order" : null,
        i.bookingServices > 0 ? "book" : null,
      ]
        .filter(Boolean)
        .join(", "),
    },
    {
      key: "plan",
      label: "Plan",
      required: true,
      ok: i.subscription !== "expired",
      detail:
        i.subscription === "entitled"
          ? "Active"
          : i.subscription === "none"
            ? "Your free trial starts when you publish"
            : "Your plan has ended — choose a plan in Billing",
    },
    { key: "hours", label: "Opening hours", required: false, ok: i.optional.hours, detail: i.optional.hours ? "Confirmed" : "Optional — add in Review or Branches" },
    { key: "description", label: "Description", required: false, ok: i.optional.description, detail: i.optional.description ? "Confirmed" : "Optional" },
    { key: "policies", label: "Policies", required: false, ok: i.optional.policies, detail: i.optional.policies ? "Confirmed" : "Optional" },
    { key: "faq", label: "FAQ", required: false, ok: i.optional.faq, detail: i.optional.faq ? "Confirmed" : "Optional" },
  ];
  return { items, canPublish: items.every((x) => !x.required || x.ok) };
}

// ── Approved Brain products → catalog ──────────────────────────────────────

export type OfferingEntry = { id: string; fact_key: string | null; entry_type: string; content: unknown };

export type ImportableOffering = {
  entryId: string;
  name: string;
  /** The same item's name in a second language, when the menu shows one (e.g. Arabic + English). */
  secondaryName: string | null;
  priceMajor: number;
  category: string | null;
  description: string | null;
};

export type OfferingTriage = {
  importable: ImportableOffering[];
  /** Approved "products" whose name is OCR noise — never offered to customers. */
  unreadable: number;
  /** Priced in another (or no stated) currency — can't be sold as-is. */
  otherCurrency: number;
  /** Approved but without a price. */
  unpriced: number;
  /** Already in the catalog under the same name. */
  alreadyInCatalog: number;
};

/** "20", "20.50", "1,250", "12,5" → a positive number, else null. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).replace(/\s/g, "").replace(/,(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n : null;
}

/**
 * Which approved Brain products can become real catalog products at Go
 * live: a readable name, a price, in the business's own currency, and not
 * already in the catalog. Everything else is counted, never guessed at.
 */
export function triageOfferings(
  entries: OfferingEntry[],
  tenantCurrency: string,
  catalogNames: Set<string>,
  normalize: (name: string) => string,
  isReadable: (name: string) => boolean,
): OfferingTriage {
  const out: OfferingTriage = { importable: [], unreadable: 0, otherCurrency: 0, unpriced: 0, alreadyInCatalog: 0 };
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.entry_type !== "product_candidate") continue;
    const c = (e.content ?? {}) as {
      normalized?: { name?: unknown; amount?: unknown; currency?: unknown };
      category?: unknown;
      description?: unknown;
      secondary_name?: unknown;
    };
    const name = typeof c.normalized?.name === "string" ? c.normalized.name.trim() : "";
    const key = e.fact_key ?? normalize(name);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isReadable(name)) {
      out.unreadable += 1;
      continue;
    }
    if (catalogNames.has(normalize(name))) {
      out.alreadyInCatalog += 1;
      continue;
    }
    const price = parseAmount(c.normalized?.amount);
    if (price === null) {
      out.unpriced += 1;
      continue;
    }
    const currency = typeof c.normalized?.currency === "string" ? c.normalized.currency.toUpperCase() : null;
    if (currency !== tenantCurrency.toUpperCase()) {
      out.otherCurrency += 1;
      continue;
    }
    const secondary = typeof c.secondary_name === "string" ? c.secondary_name.trim() : "";
    out.importable.push({
      entryId: e.id,
      name,
      secondaryName: secondary && secondary !== name && isReadable(secondary) ? secondary.slice(0, 160) : null,
      priceMajor: price,
      category: typeof c.category === "string" && c.category.trim() ? c.category.trim().slice(0, 120) : null,
      description: typeof c.description === "string" && c.description.trim() ? c.description.trim().slice(0, 2000) : null,
    });
  }
  return out;
}
