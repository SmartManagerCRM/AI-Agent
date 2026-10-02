/**
 * Bulk order entry — reading a CSV (exported from a spreadsheet, or pasted)
 * into orders. Pure: the database prices and saves them
 * (`create_manual_orders`, all-or-nothing).
 *
 * One row per order line. Rows sharing an `order_ref` are one order; a row
 * without a ref is an order of its own. Products are matched by name (any
 * of the product's languages, case-insensitive) or by product id.
 *
 *   order_ref,customer_name,customer_phone,fulfillment,product,quantity,paid,delivery_address,notes
 */

export const BULK_ORDER_COLUMNS = [
  "order_ref",
  "customer_name",
  "customer_phone",
  "fulfillment",
  "product",
  "quantity",
  "paid",
  "delivery_address",
  "notes",
] as const;

export const MAX_BULK_ROWS = 2000;
export const MAX_BULK_ORDERS = 200;

export type CatalogProduct = { id: string; names: string[] };

export type ManualOrderInput = {
  ref: string;
  items: { product_id: string; quantity: number }[];
  fulfillment_type: "pickup" | "delivery" | "dine_in";
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  notes: string | null;
  paid: boolean;
};

export type BulkParseResult = { orders: ManualOrderInput[]; errors: string[] };

/** RFC 4180-style CSV: quoted fields, escaped quotes, commas/newlines inside quotes; `;` or tab also accepted. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].reduce(
    (best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best),
    ",",
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const FULFILLMENT: Record<string, ManualOrderInput["fulfillment_type"]> = {
  "": "pickup",
  pickup: "pickup",
  "pick up": "pickup",
  takeaway: "pickup",
  "take away": "pickup",
  delivery: "delivery",
  deliver: "delivery",
  "dine in": "dine_in",
  "dine-in": "dine_in",
  dine_in: "dine_in",
  dinein: "dine_in",
};
const TRUE = new Set(["yes", "y", "true", "1", "paid", "نعم", "oui"]);

/** Rows → orders, with every problem reported by row number (nothing is created if any are found). */
export function buildBulkOrders(text: string, catalog: CatalogProduct[]): BulkParseResult {
  const errors: string[] = [];
  const rows = parseCsv(text);
  if (rows.length < 2)
    return { orders: [], errors: ["The file has no order rows — keep the header row and add one row per order line."] };
  const header = rows[0].map((h) => norm(h).replace(/\s+/g, "_"));
  const col = (name: (typeof BULK_ORDER_COLUMNS)[number]) => header.indexOf(name);
  if (col("product") < 0 || col("quantity") < 0) {
    return {
      orders: [],
      errors: [`The header row needs at least "product" and "quantity" columns (${BULK_ORDER_COLUMNS.join(", ")}).`],
    };
  }
  if (rows.length - 1 > MAX_BULK_ROWS) return { orders: [], errors: [`At most ${MAX_BULK_ROWS} rows at a time.`] };

  const byName = new Map<string, string>();
  const ids = new Set<string>();
  for (const p of catalog) {
    ids.add(p.id);
    for (const n of p.names) if (!byName.has(norm(n))) byName.set(norm(n), p.id);
  }

  const orders = new Map<string, ManualOrderInput>();
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2; // spreadsheet row number (header is row 1)
    const get = (name: (typeof BULK_ORDER_COLUMNS)[number]) => (col(name) >= 0 ? (cells[col(name)] ?? "").trim() : "");
    const productText = get("product");
    const productId = ids.has(productText) ? productText : byName.get(norm(productText));
    if (!productText) return void errors.push(`Row ${line}: the product is missing.`);
    if (!productId) return void errors.push(`Row ${line}: "${productText}" isn't in your catalog.`);
    const quantity = Number(get("quantity"));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      return void errors.push(`Row ${line}: the quantity must be a whole number from 1 to 999.`);
    }
    const fulfillment = FULFILLMENT[norm(get("fulfillment"))];
    if (!fulfillment) return void errors.push(`Row ${line}: fulfillment must be pickup, delivery or dine in.`);

    const ref = get("order_ref") || `row-${line}`;
    let order = orders.get(ref);
    if (!order) {
      order = {
        ref,
        items: [],
        fulfillment_type: fulfillment,
        customer_name: get("customer_name") || null,
        customer_phone: get("customer_phone") || null,
        delivery_address: get("delivery_address") || null,
        notes: get("notes") || null,
        paid: TRUE.has(norm(get("paid"))),
      };
      orders.set(ref, order);
    }
    order.items.push({ product_id: productId, quantity });
    if (order.items.length > 100) errors.push(`Order ${ref}: at most 100 lines per order.`);
  });

  for (const o of orders.values()) {
    if (o.fulfillment_type === "delivery" && !o.delivery_address) {
      errors.push(`Order ${o.ref}: a delivery order needs a delivery_address.`);
    }
  }
  if (orders.size > MAX_BULK_ORDERS)
    errors.push(`At most ${MAX_BULK_ORDERS} orders at a time (this file has ${orders.size}).`);
  return { orders: [...orders.values()], errors: [...new Set(errors)].slice(0, 50) };
}

/** A starter CSV using the business's own product names. */
export function bulkOrderTemplate(productNames: string[]): string {
  const [a = "Product name", b = a] = productNames;
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    BULK_ORDER_COLUMNS.join(","),
    ["A1", "Sara", "+966500000001", "pickup", q(a), "2", "no", "", ""].join(","),
    ["A1", "Sara", "+966500000001", "pickup", q(b), "1", "no", "", ""].join(","),
    [
      "A2",
      "Omar",
      "+966500000002",
      "delivery",
      q(a),
      "1",
      "yes",
      q("King Fahd Rd 12, Riyadh"),
      q("Ring the bell"),
    ].join(","),
  ].join("\n");
}
