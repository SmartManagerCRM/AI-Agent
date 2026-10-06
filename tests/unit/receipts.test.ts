import { describe, expect, it } from "vitest";

import { parseReceipt, PRINTABLE_ORDER_STATUSES, receiptQrText, receiptView, type ReceiptQrLabels } from "@/lib/receipts";

const raw = (overrides: { items?: unknown[]; customer?: Record<string, string | null>; branch?: unknown } = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  order_id: "22222222-2222-2222-2222-222222222222",
  order_status: "confirmed",
  receipt_number: "R-000042",
  token: "abc123def456",
  issued_at: "2026-10-06T10:00:00Z",
  details: {
    business: {
      name: { en: "Khayal Cafe", ar: "مقهى خيال" },
      legal_name: "Khayal Trading LLC",
      vat_number: "300123456700003",
      address: "1 Main St, Riyadh",
      phone: "+966500000000",
      email: "hello@example.com",
    },
    branch:
      overrides.branch === undefined
        ? { name: { en: "Olaya", ar: "العليا" }, address: { en: "Olaya St 5" }, phone: "+966511111111" }
        : overrides.branch,
    order: {
      number: 42,
      placed_at: "2026-10-06T10:00:00Z",
      fulfillment_type: "pickup",
      currency: "SAR",
      exponent: 2,
      subtotal_minor: 3000,
      discount_minor: 500,
      delivery_fee_minor: 0,
      tax_minor: 375,
      total_minor: 2875,
      payment_method: "cash",
      table: null,
      notes: null,
    },
    customer: overrides.customer ?? { name: "Sara", phone: "+966522222222", email: null, address: null },
    items: overrides.items ?? [
      { name: { en: "Latte", ar: "لاتيه" }, quantity: 2, unit_price_minor: 1000, total_minor: 2000 },
      { name: { en: "Croissant" }, quantity: 1, unit_price_minor: 1000, total_minor: 1000 },
    ],
  },
});

const options = {
  locale: "en",
  timeZone: "Asia/Riyadh",
  fulfillmentLabel: (t: string) => `F:${t}`,
  paymentLabel: (p: string) => `P:${p}`,
};

const labels: ReceiptQrLabels = {
  receipt: "Receipt",
  vatNumber: "VAT No.",
  date: "Date",
  order: "Order",
  table: "Table",
  customer: "Customer",
  subtotal: "Subtotal",
  discount: "Discount",
  delivery: "Delivery",
  tax: "Tax",
  total: "Total",
  payment: "Payment",
  reference: "Ref",
  moreItems: (n) => `+${n} more items`,
};

describe("parseReceipt", () => {
  it("reads a receipt from order_receipt()", () => {
    const r = parseReceipt(raw());
    expect(r?.receiptNumber).toBe("R-000042");
    expect(r?.orderStatus).toBe("confirmed");
    expect(r?.details.items).toHaveLength(2);
  });
  it("rejects anything that isn't one", () => {
    expect(parseReceipt(null)).toBeNull();
    expect(parseReceipt([])).toBeNull();
    expect(parseReceipt({ id: "x" })).toBeNull();
  });
});

describe("receiptView", () => {
  it("shows the business's legal details, the branch's address and phone, and the totals", () => {
    const v = receiptView(parseReceipt(raw())!, options);
    expect(v.business).toMatchObject({
      name: "Khayal Cafe",
      legalName: "Khayal Trading LLC",
      vatNumber: "300123456700003",
      address: "Olaya St 5",
      phone: "+966511111111",
    });
    expect(v.branch?.name).toBe("Olaya");
    expect(v.fulfillment).toBe("F:pickup");
    expect(v.payment).toBe("P:cash");
    expect(v.totals.discount?.startsWith("−")).toBe(true);
    expect(v.totals.delivery).toBeNull();
    expect(v.lines.map((l) => l.name)).toEqual(["Latte", "Croissant"]);
    expect(v.dir).toBe("ltr");
  });
  it("falls back to the business's address and phone, in Arabic right to left", () => {
    const v = receiptView(parseReceipt(raw({ branch: null }))!, { ...options, locale: "ar" });
    expect(v.business.address).toBe("1 Main St, Riyadh");
    expect(v.business.phone).toBe("+966500000000");
    expect(v.business.name).toBe("مقهى خيال");
    expect(v.dir).toBe("rtl");
  });
  it("has no customer block when nothing is known about the customer", () => {
    const v = receiptView(parseReceipt(raw({ customer: { name: null, phone: null, email: null, address: null } }))!, options);
    expect(v.customer).toBeNull();
  });
});

describe("receiptQrText", () => {
  it("carries the receipt, the business's legal details, the customer, the lines and the reference", () => {
    const text = receiptQrText(receiptView(parseReceipt(raw())!, options), labels);
    for (const part of ["Receipt R-000042", "Khayal Trading LLC", "VAT No.: 300123456700003", "Olaya", "Customer: Sara", "2 × Latte", "Ref: abc123def456"]) {
      expect(text).toContain(part);
    }
  });
  it("stays within the QR code's size, keeping the totals and the reference", () => {
    const items = Array.from({ length: 120 }, (_, i) => ({
      name: { en: `A rather long product name number ${i}` },
      quantity: 1,
      unit_price_minor: 1000,
      total_minor: 1000,
    }));
    const text = receiptQrText(receiptView(parseReceipt(raw({ items }))!, options), labels);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(2200);
    expect(text).toMatch(/\+\d+ more items/);
    expect(text).toContain("Total:");
    expect(text).toContain("Ref: abc123def456");
  });
});

describe("PRINTABLE_ORDER_STATUSES", () => {
  it("prints from confirmed on, never before", () => {
    expect(PRINTABLE_ORDER_STATUSES.has("confirmed")).toBe(true);
    expect(PRINTABLE_ORDER_STATUSES.has("pending")).toBe(false);
    expect(PRINTABLE_ORDER_STATUSES.has("cancelled")).toBe(false);
  });
});
