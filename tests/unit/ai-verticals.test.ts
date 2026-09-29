import { describe, expect, it } from "vitest";

import { matchDeterministic, type BrainSnapshot } from "@/server/ai/deterministic/match";
import { buildSystemPrompt } from "@/server/ai/system-prompt";

/**
 * Spec principle: one shared Agent Engine serves every business type —
 * never a vertical-specific branch of the deterministic matcher or the
 * system prompt builder. These fixtures are realistic per vertical (a
 * salon/clinic/consulting firm genuinely has no product catalog and
 * relies on booking/leads instead — that's not a bug to work around, it's
 * the same engine correctly doing nothing with data that isn't there) and
 * every assertion below runs through the exact same `matchDeterministic`/
 * `buildSystemPrompt` functions the café/retail fixtures use.
 */
function allWeekHours(open: string, close: string): BrainSnapshot["defaultBranch"] {
  const day = [{ open, close }];
  return {
    name: "Main Branch",
    phone: "+966500000000",
    openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
  };
}

const VERTICALS: { label: string; snapshot: BrainSnapshot }[] = [
  {
    label: "café",
    snapshot: {
      locale: "en",
      assistantName: "Aria",
      greeting: null,
      currency: "SAR",
      currencyExponent: 2,
      products: [
        { name: "Spanish Latte", priceMinor: 1800 },
        { name: "Croissant", priceMinor: 1200 },
      ],
      defaultBranch: allWeekHours("07:00", "19:00"),
      notes: { delivery_info: "We deliver within 5km.", pickup_info: "Pickup at the counter." },
      faqs: [],
      returningCustomer: null,
    },
  },
  {
    label: "restaurant",
    snapshot: {
      locale: "en",
      assistantName: "Basil",
      greeting: null,
      currency: "SAR",
      currencyExponent: 2,
      products: [
        { name: "Grilled Chicken", priceMinor: 4500 },
        { name: "Caesar Salad", priceMinor: 2800 },
      ],
      defaultBranch: allWeekHours("12:00", "23:00"),
      notes: { policy: "Reservations held for 15 minutes past booking time." },
      faqs: [],
      returningCustomer: null,
    },
  },
  {
    label: "retail",
    snapshot: {
      locale: "en",
      assistantName: "Nova",
      greeting: null,
      currency: "SAR",
      currencyExponent: 2,
      products: [
        { name: "Running Shoes", priceMinor: 22000 },
        { name: "Cotton T-Shirt", priceMinor: 6000 },
      ],
      defaultBranch: allWeekHours("10:00", "22:00"),
      notes: { policy: "Returns accepted within 14 days with receipt.", delivery_info: "Nationwide shipping in 3-5 days." },
      faqs: [],
      returningCustomer: null,
    },
  },
  {
    label: "salon",
    snapshot: {
      locale: "en",
      assistantName: "Luna",
      greeting: null,
      currency: "SAR",
      currencyExponent: 2,
      products: [],
      defaultBranch: allWeekHours("09:00", "20:00"),
      notes: { about: "A hair and beauty salon offering cuts, color, and styling by appointment." },
      faqs: [],
      returningCustomer: null,
    },
  },
  {
    label: "clinic",
    snapshot: {
      locale: "en",
      assistantName: "Dr. Assist",
      greeting: null,
      currency: "SAR",
      currencyExponent: 2,
      products: [],
      defaultBranch: allWeekHours("08:00", "17:00"),
      notes: { policy: "24-hour notice required to cancel or reschedule an appointment." },
      faqs: [],
      returningCustomer: null,
    },
  },
  {
    label: "engineering consultancy",
    snapshot: {
      locale: "en",
      assistantName: "Atlas",
      greeting: null,
      currency: "SAR",
      currencyExponent: 2,
      products: [],
      defaultBranch: allWeekHours("08:30", "17:30"),
      notes: { about: "A structural engineering consultancy taking on project inquiries and site assessments." },
      faqs: [],
      returningCustomer: null,
    },
  },
];

describe("shared Agent Engine across verticals", () => {
  for (const { label, snapshot } of VERTICALS) {
    describe(label, () => {
      it("greets with the business's own real assistant name", () => {
        const result = matchDeterministic("hello", snapshot);
        expect(result?.rule).toBe("greeting");
        expect(result?.reply).toContain(snapshot.assistantName);
      });

      it("answers hours from this business's own real opening hours, not a shared default", () => {
        const result = matchDeterministic("what are your hours?", snapshot);
        expect(result?.rule).toBe("opening_hours");
        const branch = snapshot.defaultBranch;
        expect(result?.reply).toContain(branch?.openingHours.mon?.[0]?.open);
        expect(result?.reply).toContain(branch?.openingHours.mon?.[0]?.close);
      });

      it("builds a system prompt naming the assistant without ever crashing on a missing catalog", () => {
        const prompt = buildSystemPrompt(snapshot);
        expect(prompt).toContain(snapshot.assistantName as string);
        if (snapshot.products.length === 0) {
          expect(prompt).not.toContain("Available products");
        } else {
          for (const product of snapshot.products) {
            expect(prompt).toContain(product.name);
          }
        }
      });
    });
  }

  it("never answers a product's price for a vertical that has no catalog", () => {
    const salon = VERTICALS.find((v) => v.label === "salon")!.snapshot;
    expect(matchDeterministic("how much is the haircut", salon)?.rule).not.toBe("product_price");
  });

  it("matches a real product price for a vertical that does have a catalog", () => {
    const retail = VERTICALS.find((v) => v.label === "retail")!.snapshot;
    const result = matchDeterministic("how much are the running shoes", retail);
    expect(result?.rule).toBe("product_price");
    expect(result?.reply).toContain("220.00 SAR");
  });
});
