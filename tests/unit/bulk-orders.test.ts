import { describe, expect, it } from "vitest";

import { buildBulkOrders, bulkOrderTemplate, parseCsv } from "@/lib/orders/bulk-orders";

const LATTE = "11111111-1111-4111-8111-000000000001";
const CAKE = "11111111-1111-4111-8111-000000000002";
const catalog = [
  { id: LATTE, names: ["Spanish Latte", "سبانش لاتيه"] },
  { id: CAKE, names: ["Pistachio Cake"] },
];
const HEADER = "order_ref,customer_name,customer_phone,fulfillment,product,quantity,paid,delivery_address,notes";

describe("CSV reading", () => {
  it("handles quotes, embedded commas and newlines, CRLF, BOM and semicolons", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("bulk orders", () => {
  it("groups rows by order_ref and matches products by name in any language", () => {
    const csv = [
      HEADER,
      "A1,Sara,+966500000001,pickup,Spanish Latte,2,no,,",
      "A1,Sara,+966500000001,pickup,pistachio cake,1,no,,",
      'A2,Omar,,delivery,سبانش لاتيه,1,yes,"King Fahd Rd 12, Riyadh",Ring the bell',
      ",Walk-in,,dine in,Pistachio Cake,3,,,",
    ].join("\n");
    const { orders, errors } = buildBulkOrders(csv, catalog);
    expect(errors).toEqual([]);
    expect(orders).toHaveLength(3);
    expect(orders[0]).toMatchObject({
      ref: "A1",
      fulfillment_type: "pickup",
      paid: false,
      items: [
        { product_id: LATTE, quantity: 2 },
        { product_id: CAKE, quantity: 1 },
      ],
    });
    expect(orders[1]).toMatchObject({
      fulfillment_type: "delivery",
      paid: true,
      delivery_address: "King Fahd Rd 12, Riyadh",
      notes: "Ring the bell",
    });
    expect(orders[2]).toMatchObject({ fulfillment_type: "dine_in", items: [{ product_id: CAKE, quantity: 3 }] });
  });

  it("reports every bad row by its spreadsheet row number", () => {
    const csv = [
      HEADER,
      "A1,,,pickup,Unknown Thing,1,,,",
      "A2,,,pickup,Spanish Latte,0,,,",
      "A3,,,boat,Spanish Latte,1,,,",
      "A4,,,delivery,Spanish Latte,1,,,",
    ].join("\n");
    const { errors } = buildBulkOrders(csv, catalog);
    expect(errors).toEqual([
      'Row 2: "Unknown Thing" isn\'t in your catalog.',
      "Row 3: the quantity must be a whole number from 1 to 999.",
      "Row 4: fulfillment must be pickup, delivery or dine in.",
      "Order A4: a delivery order needs a delivery_address.",
    ]);
  });

  it("needs a header with product and quantity", () => {
    expect(buildBulkOrders("foo,bar\n1,2", catalog).errors[0]).toMatch(/needs at least "product" and "quantity"/);
    expect(buildBulkOrders(HEADER, catalog).errors[0]).toMatch(/no order rows/);
  });

  it("the downloadable template is itself a valid import", () => {
    const { orders, errors } = buildBulkOrders(bulkOrderTemplate(["Spanish Latte", "Pistachio Cake"]), catalog);
    expect(errors).toEqual([]);
    expect(orders.map((o) => o.ref)).toEqual(["A1", "A2"]);
  });
});
