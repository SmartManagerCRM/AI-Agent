/**
 * Business Brain readiness — computed from what is actually in the Brain,
 * never a static value. Each area earns full credit when the owner has
 * confirmed it (approved), half credit when it was found but still awaits
 * review, and nothing when missing or under an open conflict.
 *
 * Pure (no I/O).
 */
export type ReadinessFact = {
  fact_key: string | null;
  entry_type: string;
  status: string;
  /** Discovery candidates carry `{ normalized: { amount } }` for offerings. */
  content?: unknown;
};

export type ReadinessArea = {
  key: "identity" | "business_type" | "contact" | "location" | "hours" | "offerings" | "prices" | "policies" | "faq" | "about";
  weight: number;
  state: "confirmed" | "found" | "conflict" | "missing";
  detail: string;
};

/** Products/services as they actually stand in the Brain (one per product, across sources). */
export type CatalogCounts = {
  found: number;
  pending: number;
  confirmed: number;
  conflicts: number;
  priced: number;
  missingPrice: number;
  catalogProducts: number;
};

export type Readiness = { score: number; areas: ReadinessArea[]; nextSteps: string[]; catalog: CatalogCounts };

const WEIGHTS: Record<ReadinessArea["key"], number> = {
  identity: 5,
  business_type: 5,
  contact: 15,
  location: 10,
  hours: 15,
  offerings: 20,
  prices: 10,
  policies: 10,
  faq: 5,
  about: 5,
};

const AREA_NAME: Record<ReadinessArea["key"], string> = {
  identity: "business name",
  business_type: "business type",
  contact: "contact details",
  location: "address",
  hours: "opening hours",
  offerings: "products and services",
  prices: "prices",
  policies: "policies",
  faq: "FAQs",
  about: "description",
};

const NEXT_STEP: Record<ReadinessArea["key"], string> = {
  identity: "Confirm your business name.",
  business_type: "Confirm your business type.",
  contact: "Add or confirm a phone number, WhatsApp or email.",
  location: "Add or confirm your address.",
  hours: "Add or confirm your opening hours.",
  offerings: "Add your products or services (or confirm the ones found).",
  prices: "Confirm prices for your products or services.",
  policies: "Add your refund, cancellation or delivery policy.",
  faq: "Add a few frequently asked questions.",
  about: "Add a short description of your business.",
};

export function computeReadiness(input: {
  facts: ReadinessFact[];
  openConflictKeys: string[];
  /** Real catalog/branch data count too — the Brain is not only discovered facts. */
  activeProducts: number;
  pricedProducts: number;
  branchesWithHours: number;
  branchesWithPhone: number;
}): Readiness {
  const live = input.facts.filter((f) => f.status === "approved" || f.status === "pending_review");
  const conflicts = new Set(input.openConflictKeys);

  const stateFor = (match: (f: ReadinessFact) => boolean, extraConfirmed = false): ReadinessArea["state"] => {
    const hits = live.filter(match);
    if (extraConfirmed || hits.some((f) => f.status === "approved")) return "confirmed";
    if (hits.length === 0) return "missing";
    // Only when every candidate is disputed does the whole area count as a conflict.
    return hits.every((f) => f.fact_key && conflicts.has(f.fact_key)) ? "conflict" : "found";
  };
  const key = (prefix: string) => (f: ReadinessFact) => Boolean(f.fact_key?.startsWith(prefix));
  const isOffering = (f: ReadinessFact) => f.entry_type === "product_candidate" || f.entry_type === "service_candidate";
  const hasPrice = (f: ReadinessFact) => {
    const n = (f.content as { normalized?: { amount?: unknown } } | undefined)?.normalized;
    return isOffering(f) && typeof n?.amount === "string";
  };

  const states: Record<ReadinessArea["key"], ReadinessArea["state"]> = {
    identity: stateFor(key("identity.name")),
    business_type: stateFor(key("business_type")),
    contact: stateFor((f) => key("contact.")(f), input.branchesWithPhone > 0),
    location: stateFor(key("location.address")),
    hours: stateFor((f) => key("hours.")(f), input.branchesWithHours > 0),
    offerings: stateFor(isOffering, input.activeProducts > 0),
    prices: stateFor(hasPrice, input.pricedProducts > 0),
    policies: stateFor((f) => f.entry_type === "policy" || f.entry_type === "delivery_info" || f.entry_type === "payment_methods"),
    faq: stateFor((f) => f.entry_type === "faq"),
    about: stateFor((f) => f.entry_type === "about"),
  };

  const credit = { confirmed: 1, found: 0.5, conflict: 0, missing: 0 } as const;
  const areas: ReadinessArea[] = (Object.keys(WEIGHTS) as ReadinessArea["key"][]).map((k) => ({
    key: k,
    weight: WEIGHTS[k],
    state: states[k],
    detail: states[k] === "confirmed" ? "Confirmed" : states[k] === "found" ? "Found — awaiting your review" : states[k] === "conflict" ? "Sources disagree — choose the right value" : "Missing",
  }));
  const score = Math.round(areas.reduce((sum, a) => sum + a.weight * credit[a.state], 0));

  const products = new Map<string, { approved: boolean; priced: boolean }>();
  for (const f of live.filter(isOffering)) {
    const key = f.fact_key ?? `${f.entry_type}:${products.size}`;
    const p = products.get(key) ?? { approved: false, priced: false };
    p.approved ||= f.status === "approved";
    p.priced ||= hasPrice(f);
    products.set(key, p);
  }
  const catalog: CatalogCounts = {
    found: products.size,
    confirmed: [...products.values()].filter((p) => p.approved).length,
    pending: [...products.values()].filter((p) => !p.approved).length,
    conflicts: [...products.keys()].filter((k) => conflicts.has(k)).length,
    priced: [...products.values()].filter((p) => p.priced).length,
    missingPrice: [...products.values()].filter((p) => !p.priced).length,
    catalogProducts: input.activeProducts,
  };
  const nextSteps = areas
    .filter((a) => a.state !== "confirmed")
    .sort((a, b) => (a.state === "conflict" ? -1 : 0) - (b.state === "conflict" ? -1 : 0) || b.weight - a.weight)
    .slice(0, 4)
    .map((a) => (a.state === "conflict" ? `Choose the correct ${AREA_NAME[a.key]} — your sources disagree.` : a.state === "found" ? `Review the ${AREA_NAME[a.key]} we found.` : NEXT_STEP[a.key]));
  return { score, areas, nextSteps, catalog };
}
