import type { BrainSnapshot } from "./deterministic/match";

/**
 * Builds the AI fallback path's system prompt from real Business Brain data
 * (spec §12, §19: compact business context, never the entire catalog, never
 * invented facts). Pure — no I/O — so it is unit-testable. Deterministic
 * matchers (spec §7) already answer the easy cases before this is ever
 * called; this prompt is what lets the model do product
 * discovery/recommendations (spec §98 Phase 4) *without* being able to
 * state a price or policy it wasn't actually given.
 */
const MAX_PRODUCTS_IN_PROMPT = 40;

export function buildSystemPrompt(snapshot: BrainSnapshot): string {
  const lines: string[] = [
    `You are ${snapshot.assistantName || "a helpful assistant"} for this business.`,
    "Answer only from the information given below and in this conversation.",
    "If you do not know something, say so honestly rather than guessing — never invent products, prices, availability, or policies.",
    "Never state that an order or payment succeeded — there is no ordering system connected to this conversation yet.",
    "Keep replies short and conversational.",
  ];

  if (snapshot.notes.about) lines.push(`About the business: ${snapshot.notes.about}`);

  if (snapshot.defaultBranch) {
    const branch = snapshot.defaultBranch;
    lines.push(`Main branch: ${branch.name}${branch.phone ? ` (phone: ${branch.phone})` : ""}.`);
  }

  if (snapshot.products.length > 0) {
    const list = snapshot.products
      .slice(0, MAX_PRODUCTS_IN_PROMPT)
      .map((p) => `${p.name} — ${(p.priceMinor / 10 ** snapshot.currencyExponent).toFixed(snapshot.currencyExponent)} ${snapshot.currency}`)
      .join("; ");
    lines.push(`Available products/services: ${list}.`);
    if (snapshot.products.length > MAX_PRODUCTS_IN_PROMPT) {
      lines.push(`(${snapshot.products.length - MAX_PRODUCTS_IN_PROMPT} more products exist — ask the customer to narrow their request if none of these fit.)`);
    }
  }

  if (snapshot.notes.delivery_info) lines.push(`Delivery: ${snapshot.notes.delivery_info}`);
  if (snapshot.notes.pickup_info) lines.push(`Pickup: ${snapshot.notes.pickup_info}`);
  if (snapshot.notes.payment_methods) lines.push(`Payment methods: ${snapshot.notes.payment_methods}`);
  if (snapshot.notes.policy) lines.push(`Policy: ${snapshot.notes.policy}`);

  return lines.join("\n");
}
