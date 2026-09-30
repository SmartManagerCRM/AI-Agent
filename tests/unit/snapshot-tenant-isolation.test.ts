import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

/**
 * A minimal fake of the Supabase query builder with NO row-level security —
 * exactly like the service-role client the public Agent uses. It only
 * applies the filters the code asks for, so a missing `tenant_id` filter
 * leaks the other business's rows, just as it would in production.
 */
function fakeServiceClient(tables: Record<string, Row[]>) {
  const query = (rows: Row[]) => {
    let current = rows;
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        current = current.filter((r) => r[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        current = current.filter((r) => r[column] !== value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        current = current.filter((r) => values.includes(r[column]));
        return builder;
      },
      order: () => builder,
      maybeSingle: async () => ({ data: current[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: current, error: null }),
    };
    return builder;
  };
  return { from: (table: string) => query(tables[table] ?? []) };
}

const A = "tenant-a";
const B = "tenant-b";

const tables: Record<string, Row[]> = {
  tenant_settings: [
    { tenant_id: A, agent: { assistant_name: null, greeting: null } },
    { tenant_id: B, agent: { assistant_name: null, greeting: null } },
  ],
  currencies: [{ code: "SAR", exponent: 2 }],
  products: [
    { id: "p-a", tenant_id: A, category_id: "c-a", status: "active", name: { en: "Laptop" }, description: {}, price_minor: 399900 },
    { id: "p-b", tenant_id: B, category_id: "c-b", status: "active", name: { en: "Spanish Latte" }, description: {}, price_minor: 1800 },
  ],
  categories: [
    { id: "c-a", tenant_id: A, is_active: true, name: { en: "Computers" } },
    { id: "c-b", tenant_id: B, is_active: true, name: { en: "Coffee" } },
  ],
  branches: [],
  business_brain_entries: [
    { tenant_id: A, status: "approved", is_active: true, entry_type: "about", entry_key: "about", content: { en: "We sell laptops." } },
    { tenant_id: B, status: "approved", is_active: true, entry_type: "policy", entry_key: "policy", content: { en: "Café refund policy." } },
    { tenant_id: B, status: "approved", is_active: true, entry_type: "faq", entry_key: "faq-wifi", content: { en: "Café wifi password is 1234." } },
  ],
  orders: [
    { id: "order-a", tenant_id: A, conversation_id: "conv-a", status: "paid" },
    { id: "order-b", tenant_id: B, conversation_id: "conv-b", status: "paid" },
  ],
  order_items: [
    { tenant_id: A, order_id: "order-a", product_name: { en: "Laptop" }, quantity: 1 },
    { tenant_id: B, order_id: "order-b", product_name: { en: "Spanish Latte" }, quantity: 3 },
  ],
};

describe("buildBrainSnapshot tenant isolation", () => {
  it("only ever contains the requesting business's products and knowledge", async () => {
    const { buildBrainSnapshot } = await import("@/server/ai/deterministic/snapshot");
    const snapshot = await buildBrainSnapshot(
      fakeServiceClient(tables) as never,
      { id: A, currency: "SAR", slug: "technest" },
      "en",
      "conv-a",
    );

    expect(snapshot.products.map((p) => p.name)).toEqual(["Laptop"]);
    // The structured catalog the Agent answers menu/product questions from: this business only.
    expect(snapshot.catalog?.products.map((p) => p.id)).toEqual(["p-a"]);
    expect(snapshot.catalog?.categories.map((c) => c.id)).toEqual(["c-a"]);
    expect(snapshot.notes).toEqual({ about: "We sell laptops." });
    expect(snapshot.faqs).toEqual([]);
    expect(snapshot.returningCustomer?.topProducts).toEqual(["Laptop"]);
    expect(JSON.stringify(snapshot)).not.toMatch(/Latte|Café/);
  });
});
