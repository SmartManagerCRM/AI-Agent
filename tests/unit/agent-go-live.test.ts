import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A fake service client: one row per table, keyed by what the resolver reads.
const db: {
  tenant: Record<string, unknown> | null;
  deployment: { status: string } | null;
  subscription: Record<string, unknown> | null;
} = { tenant: null, deployment: null, subscription: null };

vi.mock("@/server/supabase/clients", () => ({
  serviceClient: () => ({
    from: (table: string) => {
      const row = table === "tenants" ? db.tenant : table === "agent_deployments" ? db.deployment : db.subscription;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return chain;
    },
  }),
}));

import { normalizeProductName } from "@/server/brain/discovery/facts";
import { isReadableName } from "@/server/brain/discovery/name-quality";
import { launchChecklist, parseAmount, triageOfferings, type LaunchInput } from "@/server/agent-public/launch";
import { resolvePublicAgent, resolvePublicTenant, resolveWidgetAgent } from "@/server/agent-public/tenant";

describe("isReadableName", () => {
  it("keeps real product names in English, Arabic and French", () => {
    for (const name of ["Spanish Latte", "قهوة عربية", "Crème brûlée", "7UP", "Mandi (1/2)", "Mac & Cheese", "Fattoush", "Shakshuka شكشوكة", "Chef's Special"]) {
      expect(isReadableName(name), name).toBe(true);
    }
  });

  it("rejects OCR noise", () => {
    for (const noise of ["0. a . - ا EE A ; of", "1 00 sen 7 حا A | We Ÿ “2 de", "1 كبر for تم أل ايد", "0 cé PP. wet", ", PO", "PP", "a", "كبرfor"]) {
      expect(isReadableName(noise), noise).toBe(false);
    }
  });
});

const base: LaunchInput = {
  businessName: "Qahwa House",
  businessTypeLabel: "Café",
  approvedKnowledge: 5,
  activeProducts: 0,
  pricedProducts: 0,
  importableProducts: 0,
  orderingEnabled: false,
  bookingServices: 0,
  subscription: "none",
  optional: { policies: false, faq: false, description: false, hours: false },
};

describe("launchChecklist", () => {
  it("does not require a 100% Brain: name, type and approved knowledge are enough when ordering is off", () => {
    const r = launchChecklist(base);
    expect(r.canPublish).toBe(true);
    expect(r.items.filter((i) => !i.required).every((i) => !i.ok)).toBe(true);
  });

  it("requires a priced product when online ordering is on — approved importable ones count", () => {
    expect(launchChecklist({ ...base, orderingEnabled: true }).canPublish).toBe(false);
    expect(launchChecklist({ ...base, orderingEnabled: true, importableProducts: 1 }).canPublish).toBe(true);
    expect(launchChecklist({ ...base, orderingEnabled: true, pricedProducts: 3, activeProducts: 3 }).canPublish).toBe(true);
  });

  it("blocks a missing name, a missing type, no knowledge at all, or an expired plan", () => {
    expect(launchChecklist({ ...base, businessName: " " }).canPublish).toBe(false);
    expect(launchChecklist({ ...base, businessTypeLabel: null }).canPublish).toBe(false);
    expect(launchChecklist({ ...base, approvedKnowledge: 0 }).canPublish).toBe(false);
    expect(launchChecklist({ ...base, subscription: "expired" }).canPublish).toBe(false);
    // No subscription at all: publishing starts the free trial.
    expect(launchChecklist({ ...base, subscription: "none" }).canPublish).toBe(true);
  });
});

describe("triageOfferings", () => {
  const offering = (id: string, name: string, amount: string | null, currency: string | null, category: string | null = null) => ({
    id,
    fact_key: `offering:${id}`,
    entry_type: "product_candidate",
    content: { normalized: { name, amount, currency }, category },
  });

  it("imports only readable, priced, same-currency products not already in the catalog", () => {
    const r = triageOfferings(
      [
        offering("1", "Fattoush", "20", "USD", "Salads"),
        offering("2", "0. a . - ا EE A ; of", "12", "USD"),
        offering("3", "Hummus", "4.5", "GBP"),
        offering("4", "Falafel", null, null),
        offering("5", "Tabbouleh", "7", "USD"),
        offering("5", "Tabbouleh", "7", "USD"),
        { id: "6", fact_key: "contact.phone", entry_type: "contact", content: {} },
      ],
      "USD",
      new Set([normalizeProductName("tabbouleh")]),
      normalizeProductName,
      isReadableName,
    );
    expect(r.importable).toEqual([{ entryId: "1", name: "Fattoush", priceMajor: 20, category: "Salads", description: null }]);
    expect(r).toMatchObject({ unreadable: 1, otherCurrency: 1, unpriced: 1, alreadyInCatalog: 1 });
  });

  it("parses menu amounts", () => {
    expect(parseAmount("20")).toBe(20);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("1,250")).toBe(1250);
    expect(parseAmount("1,250.50")).toBe(1250.5);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("free")).toBeNull();
  });
});

describe("public Agent resolution (deployment state, not readiness)", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  beforeEach(() => {
    db.tenant = {
      id: "t1",
      slug: "qahwa-house",
      business_name: { en: "Qahwa House" },
      business_type_key: "cafe",
      currency: "USD",
      default_language: "en",
      enabled_languages: ["en"],
      deployment_mode: "external_agent",
      status: "active",
    };
    db.deployment = { status: "published" };
    db.subscription = { status: "trialing", trial_ends_at: future, current_period_end: null };
  });

  it("is live only when PUBLISHED", async () => {
    expect((await resolvePublicAgent("qahwa-house")).state).toBe("live");
    expect((await resolvePublicTenant("qahwa-house"))?.id).toBe("t1");
  });

  it("never-published → not live yet; paused → temporarily unavailable; unknown slug → not found", async () => {
    for (const status of ["draft", "review", "ready", "unpublished"]) {
      db.deployment = { status };
      expect((await resolvePublicAgent("qahwa-house")).state, status).toBe("not_live");
    }
    db.deployment = null;
    expect((await resolvePublicAgent("qahwa-house")).state).toBe("not_live");
    db.deployment = { status: "paused" };
    expect((await resolvePublicAgent("qahwa-house")).state).toBe("paused");
    expect(await resolvePublicTenant("qahwa-house")).toBeNull();
    // Created but still onboarding (never published): it exists, it's just not live.
    db.deployment = null;
    (db.tenant as Record<string, unknown>).status = "onboarding";
    expect((await resolvePublicAgent("qahwa-house")).state).toBe("not_live");
    db.tenant = null;
    expect((await resolvePublicAgent("nope")).state).toBe("not_found");
  });

  it("a suspended business is not advertised; a lapsed plan is unavailable; the widget respects deployment mode", async () => {
    db.subscription = { status: "trialing", trial_ends_at: new Date(Date.now() - 1000).toISOString(), current_period_end: null };
    expect((await resolvePublicAgent("qahwa-house")).state).toBe("unavailable");
    db.subscription = { status: "active", trial_ends_at: future, current_period_end: null };
    expect((await resolveWidgetAgent("qahwa-house")).state).toBe("not_live");
    (db.tenant as Record<string, unknown>).deployment_mode = "both";
    expect((await resolveWidgetAgent("qahwa-house")).state).toBe("live");
    (db.tenant as Record<string, unknown>).status = "suspended";
    expect((await resolvePublicAgent("qahwa-house")).state).toBe("not_found");
  });
});
