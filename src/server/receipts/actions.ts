"use server";

import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { fulfillmentLabel } from "@/lib/i18n-labels";
import {
  parseReceipt,
  PRINTABLE_ORDER_STATUSES,
  receiptQrText,
  receiptView,
  type ReceiptView,
} from "@/lib/receipts";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export type ReceiptPrintResult =
  | { ok: true; view: ReceiptView; qrSvg: string }
  | { ok: false; reason: "not_printable" | "already_printed" | "manual_mode" | "failed" };

const schema = z.object({
  orderId: z.uuid(),
  slug: z.string().min(1),
  locale: z.string(),
  auto: z.boolean(),
});

/**
 * An order's receipt, ready to print (orders.read, checked in the database).
 *
 * `auto`: printing as soon as the order is confirmed — only when the business
 * chose automatic printing (checked here, never taken from the browser), and
 * only once across every open console: the first one to claim the receipt
 * prints it. A click on Print always prints.
 */
export async function prepareReceiptAction(input: { orderId: string; slug: string; locale: string; auto: boolean }): Promise<ReceiptPrintResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "failed" };
  const { orderId, slug, locale, auto } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const { data, error } = await supabase.rpc("order_receipt", { p_order_id: orderId });
  const receipt = error ? null : parseReceipt(data);
  if (!receipt) return { ok: false, reason: "failed" };
  if (!PRINTABLE_ORDER_STATUSES.has(receipt.orderStatus)) return { ok: false, reason: "not_printable" };

  if (auto) {
    const { data: settings } = await supabase.from("tenant_settings").select("receipt_print_mode").eq("tenant_id", tenant.id).maybeSingle();
    if (settings?.receipt_print_mode !== "auto") return { ok: false, reason: "manual_mode" };
  }
  const { data: claimed, error: printError } = await supabase.rpc("record_receipt_print", { p_order_id: orderId, p_auto: auto });
  if (printError) return { ok: false, reason: "failed" };
  if (auto && claimed !== true) return { ok: false, reason: "already_printed" };

  const tAll = await getTranslations({ locale });
  const t = await getTranslations({ locale, namespace: "console.receipt" });
  const view = receiptView(receipt, {
    locale,
    timeZone: tenant.timezone,
    fulfillmentLabel: (type) => fulfillmentLabel(tAll, type),
    paymentLabel: (provider) => (tAll.has(`common.paymentProvider.${provider}`) ? tAll(`common.paymentProvider.${provider}`) : provider),
  });
  const text = receiptQrText(view, {
    receipt: t("title"),
    vatNumber: t("vatNumber"),
    date: t("date"),
    order: t("order"),
    table: t("table"),
    customer: t("customer"),
    subtotal: t("subtotal"),
    discount: t("discount"),
    delivery: t("delivery"),
    tax: t("tax"),
    total: t("total"),
    payment: t("payment"),
    reference: t("reference"),
    moreItems: (n) => t("moreItems", { n }),
  });
  let qrSvg: string;
  try {
    qrSvg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 0 });
  } catch {
    // Very long business or customer details: the QR code keeps what identifies the receipt.
    qrSvg = await QRCode.toString(
      [`${t("title")} ${view.receiptNumber}`, view.business.vatNumber ? `${t("vatNumber")}: ${view.business.vatNumber}` : "", `${t("total")}: ${view.totals.total}`, `${t("reference")}: ${view.reference}`]
        .filter(Boolean)
        .join("\n"),
      { type: "svg", errorCorrectionLevel: "M", margin: 0 },
    );
  }
  return { ok: true, view, qrSvg };
}
