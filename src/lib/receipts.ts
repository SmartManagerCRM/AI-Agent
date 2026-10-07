import { formatMoney } from "@/lib/money";
import { pickText } from "@/lib/site/pricing";

/**
 * Order receipts — the pure half (no I/O, unit-tested in tests/unit/receipts.test.ts).
 *
 * A receipt is created in the database with its order (`order_receipts`,
 * refreshed when the order's details change) and read for printing through
 * `order_receipt()`. Here it becomes what the printed sheet shows, and the
 * text its QR code carries: the order and its lines, the customer when
 * known, and the business's legal details (name, branch, address, phone,
 * VAT number) — plus the receipt's own reference, so every QR code is unique.
 */

type Localized = Record<string, string> | null | undefined;

export type ReceiptDetails = {
  business: {
    name: Localized;
    legal_name: string | null;
    vat_number: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    default_language?: string | null;
  };
  branch: { name: Localized; address: Localized; phone: string | null } | null;
  order: {
    number: number;
    placed_at: string;
    fulfillment_type: string;
    currency: string;
    exponent: number;
    subtotal_minor: number;
    discount_minor: number;
    delivery_fee_minor: number;
    tax_minor: number;
    total_minor: number;
    payment_method: string | null;
    table: string | null;
    notes: string | null;
  };
  customer: { name: string | null; phone: string | null; email: string | null; address: string | null };
  items: { name: Localized; quantity: number; unit_price_minor: number; total_minor: number }[];
};

export type ReceiptRecord = {
  id: string;
  orderId: string;
  orderStatus: string;
  receiptNumber: string;
  token: string;
  issuedAt: string;
  details: ReceiptDetails;
};

/** Order statuses whose receipt can be printed: from confirmed on. */
export const PRINTABLE_ORDER_STATUSES: ReadonlySet<string> = new Set(["confirmed", "preparing", "prepared", "ready", "collected", "served", "out_for_delivery", "delivered", "completed"]);

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export function parseReceipt(raw: unknown): ReceiptRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const details = r.details as ReceiptDetails | undefined;
  if (!str(r.id) || !str(r.order_id) || !details || typeof details !== "object" || !details.order) return null;
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    orderStatus: str(r.order_status) ?? "",
    receiptNumber: str(r.receipt_number) ?? "",
    token: str(r.token) ?? "",
    issuedAt: str(r.issued_at) ?? details.order.placed_at,
    details: { ...details, items: Array.isArray(details.items) ? details.items : [] },
  };
}

export type ReceiptLine = { name: string; quantity: number; unitPrice: string; total: string };

export type ReceiptView = {
  dir: "ltr" | "rtl";
  receiptNumber: string;
  reference: string;
  date: string;
  orderNumber: number;
  fulfillment: string;
  table: string | null;
  business: { name: string; legalName: string | null; vatNumber: string | null; address: string | null; phone: string | null };
  branch: { name: string; address: string | null } | null;
  customer: { name: string | null; phone: string | null; email: string | null; address: string | null } | null;
  lines: ReceiptLine[];
  totals: { subtotal: string; discount: string | null; delivery: string | null; tax: string | null; total: string };
  payment: string | null;
  notes: string | null;
};

/**
 * What the printed receipt shows, in the console's language. Labels for the
 * fulfillment type and payment method come from the caller's translations.
 */
export function receiptView(
  receipt: ReceiptRecord,
  options: {
    locale: string;
    timeZone?: string;
    fulfillmentLabel: (type: string) => string;
    paymentLabel: (provider: string) => string;
  },
): ReceiptView {
  const { locale } = options;
  const d = receipt.details;
  const money = (minor: number) => formatMoney(minor, d.order.currency, d.order.exponent, locale);
  let date: string;
  try {
    date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: options.timeZone }).format(
      new Date(d.order.placed_at),
    );
  } catch {
    date = new Date(d.order.placed_at).toISOString().slice(0, 16).replace("T", " ");
  }
  const branchAddress = pickText(d.branch?.address ?? null, locale) || null;
  const customer = d.customer ?? { name: null, phone: null, email: null, address: null };
  const hasCustomer = Boolean(customer.name || customer.phone || customer.email || customer.address);
  return {
    dir: locale === "ar" ? "rtl" : "ltr",
    receiptNumber: receipt.receiptNumber,
    reference: receipt.token,
    date,
    orderNumber: d.order.number,
    fulfillment: options.fulfillmentLabel(d.order.fulfillment_type),
    table: d.order.table ?? null,
    business: {
      name: pickText(d.business.name, locale) || d.business.legal_name || "",
      legalName: d.business.legal_name ?? null,
      vatNumber: d.business.vat_number ?? null,
      // The branch's address and phone when it has them, else the business's.
      address: branchAddress ?? d.business.address ?? null,
      phone: d.branch?.phone ?? d.business.phone ?? null,
    },
    branch: d.branch ? { name: pickText(d.branch.name, locale), address: branchAddress } : null,
    customer: hasCustomer
      ? { name: customer.name ?? null, phone: customer.phone ?? null, email: customer.email ?? null, address: customer.address ?? null }
      : null,
    lines: d.items.map((i) => ({
      name: pickText(i.name, locale),
      quantity: i.quantity,
      unitPrice: money(i.unit_price_minor),
      total: money(i.total_minor),
    })),
    totals: {
      subtotal: money(d.order.subtotal_minor),
      discount: d.order.discount_minor > 0 ? `−${money(d.order.discount_minor)}` : null,
      delivery: d.order.delivery_fee_minor > 0 ? money(d.order.delivery_fee_minor) : null,
      tax: d.order.tax_minor > 0 ? money(d.order.tax_minor) : null,
      total: money(d.order.total_minor),
    },
    payment: d.order.payment_method ? options.paymentLabel(d.order.payment_method) : null,
    notes: d.order.notes ?? null,
  };
}

export type ReceiptQrLabels = {
  receipt: string;
  vatNumber: string;
  date: string;
  order: string;
  table: string;
  customer: string;
  subtotal: string;
  discount: string;
  delivery: string;
  tax: string;
  total: string;
  payment: string;
  reference: string;
  /** "+{n} more items" */
  moreItems: (n: number) => string;
};

/** A QR code holds up to 2,331 bytes at error-correction level M; this keeps a margin. */
export const RECEIPT_QR_MAX_BYTES = 2200;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * The text a receipt's QR code carries: everything on the receipt, readable
 * by any phone camera. When a long order wouldn't fit in one QR code, its
 * lines are shortened (no unit prices), then the last ones are summarized
 * ("+3 more items") — the totals, the business and the reference always stay.
 */
export function receiptQrText(view: ReceiptView, labels: ReceiptQrLabels, maxBytes = RECEIPT_QR_MAX_BYTES): string {
  const join = (parts: (string | null | undefined)[], sep = " · ") => parts.filter(Boolean).join(sep);
  const head = [
    `${labels.receipt} ${view.receiptNumber}`,
    view.business.name,
    view.business.legalName && view.business.legalName !== view.business.name ? view.business.legalName : null,
    view.business.vatNumber ? `${labels.vatNumber}: ${view.business.vatNumber}` : null,
    join([view.branch?.name, view.business.address]) || null,
    view.business.phone,
    `${labels.date}: ${view.date}`,
    join([`${labels.order} #${view.orderNumber}`, view.fulfillment, view.table ? `${labels.table} ${view.table}` : null]),
    view.customer
      ? `${labels.customer}: ${join([view.customer.name, view.customer.phone, view.customer.email, view.customer.address])}`
      : null,
  ].filter((l): l is string => Boolean(l));
  const tail = [
    `${labels.subtotal}: ${view.totals.subtotal}`,
    view.totals.discount ? `${labels.discount}: ${view.totals.discount}` : null,
    view.totals.delivery ? `${labels.delivery}: ${view.totals.delivery}` : null,
    view.totals.tax ? `${labels.tax}: ${view.totals.tax}` : null,
    `${labels.total}: ${view.totals.total}`,
    view.payment ? `${labels.payment}: ${view.payment}` : null,
    `${labels.reference}: ${view.reference}`,
  ].filter((l): l is string => Boolean(l));

  const build = (lines: string[]) => [...head, "—", ...lines, "—", ...tail].join("\n");
  const full = view.lines.map((l) => `${l.quantity} × ${l.name} @ ${l.unitPrice} = ${l.total}`);
  let text = build(full);
  if (byteLength(text) <= maxBytes) return text;
  const short = view.lines.map((l) => `${l.quantity} × ${l.name} = ${l.total}`);
  text = build(short);
  if (byteLength(text) <= maxBytes) return text;
  for (let keep = short.length - 1; keep >= 0; keep--) {
    text = build([...short.slice(0, keep), labels.moreItems(short.length - keep)]);
    if (byteLength(text) <= maxBytes) return text;
  }
  return build([labels.moreItems(short.length)]);
}
