/**
 * The pricing page's plans, from Super Admin → Subscriptions & Plans (the
 * `public_subscription_plans()` database function). Pure: unit-tested in
 * tests/unit/site-pricing.test.ts.
 *
 * A monthly plan and its annual version share a family; the page shows one
 * card per family and the Monthly / Annual switch picks the version.
 */
export type PublicPlan = {
  key: string;
  family: string;
  name: Record<string, string>;
  description: Record<string, string>;
  features: Record<string, string>;
  price_minor: number;
  currency: string;
  exponent: number;
  billing_interval: "month" | "year";
  trial_days: number;
  conversation_limit: number | null;
  /** Most active branches the plan allows (null: no limit). */
  max_branches: number | null;
  is_popular: boolean;
  sort_order: number;
};

export type PlanFamily = { family: string; monthly: PublicPlan | null; annual: PublicPlan | null; sortOrder: number };

export function planFamilies(plans: PublicPlan[]): PlanFamily[] {
  const byFamily = new Map<string, PlanFamily>();
  for (const plan of plans) {
    const entry = byFamily.get(plan.family) ?? { family: plan.family, monthly: null, annual: null, sortOrder: plan.sort_order };
    if (plan.billing_interval === "year") entry.annual ??= plan;
    else entry.monthly ??= plan;
    entry.sortOrder = Math.min(entry.sortOrder, plan.sort_order);
    byFamily.set(plan.family, entry);
  }
  return [...byFamily.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.family.localeCompare(b.family));
}

/** What an annual plan saves against 12 months of its monthly plan, in whole percent (null when it doesn't). */
export function annualSavingsPercent(monthly: PublicPlan | null, annual: PublicPlan | null): number | null {
  if (!monthly || !annual || monthly.currency !== annual.currency || monthly.price_minor <= 0) return null;
  const full = monthly.price_minor * 12;
  const saving = Math.round(((full - annual.price_minor) / full) * 100);
  return saving > 0 ? saving : null;
}

/** The largest saving any family offers on its annual plan (shown on the switch). */
export function bestAnnualSaving(families: PlanFamily[]): number | null {
  const savings = families.map((f) => annualSavingsPercent(f.monthly, f.annual)).filter((s): s is number => s !== null);
  return savings.length ? Math.max(...savings) : null;
}

/** A per-language text, in the visitor's language (else English, else any). */
export function pickText(value: Record<string, string> | null | undefined, locale: string): string {
  if (!value) return "";
  return value[locale]?.trim() || value.en?.trim() || Object.values(value).find((v) => v?.trim())?.trim() || "";
}

export const featureLines = (plan: PublicPlan, locale: string) =>
  pickText(plan.features, locale)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** The trial length the website announces: the most common trial among the plans (null when none has one). */
export function announcedTrialDays(plans: PublicPlan[]): number | null {
  const counts = new Map<number, number>();
  for (const p of plans) if (p.trial_days > 0) counts.set(p.trial_days, (counts.get(p.trial_days) ?? 0) + 1);
  let best: number | null = null;
  for (const [days, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = days;
  return best;
}
