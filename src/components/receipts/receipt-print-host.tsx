"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ReceiptView } from "@/lib/receipts";
import { prepareReceiptAction } from "@/server/receipts/actions";

/** Print an order's receipt now (the Print button). */
export const PRINT_RECEIPT_EVENT = "sm:print-receipt";
/** An order was just confirmed (or arrived confirmed): printed if the business chose automatic printing. */
export const ORDER_CONFIRMED_EVENT = "sm:order-confirmed";

export function requestReceiptPrint(orderId: string) {
  window.dispatchEvent(new CustomEvent(PRINT_RECEIPT_EVENT, { detail: { orderId } }));
}
export function announceOrderConfirmed(orderId: string) {
  window.dispatchEvent(new CustomEvent(ORDER_CONFIRMED_EVENT, { detail: { orderId } }));
}

type Job = { view: ReceiptView; qrSvg: string };

/**
 * Prints receipts from the console page itself: the receipt is drawn in a
 * sheet hidden on screen, and the print stylesheet shows only that sheet.
 * (No pop-up window or frame: the console can't be framed, and browsers
 * block pop-ups that a click didn't open — so automatic printing of an
 * order that arrives on its own still works.) One receipt at a time.
 */
export function ReceiptPrintHost({ slug, locale, autoPrint }: { slug: string; locale: string; autoPrint: boolean }) {
  const t = useTranslations("console.receipt");
  const [job, setJob] = useState<Job | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useRef<Job[]>([]);
  const busy = useRef(false);

  const next = useCallback(() => {
    const upcoming = queue.current.shift() ?? null;
    busy.current = upcoming !== null;
    setJob(upcoming);
  }, []);

  const enqueue = useCallback(
    (j: Job) => {
      queue.current.push(j);
      if (!busy.current) next();
    },
    [next],
  );

  const run = useCallback(
    async (orderId: string, auto: boolean) => {
      const result = await prepareReceiptAction({ orderId, slug, locale, auto }).catch(() => null);
      if (result?.ok) return enqueue({ view: result.view, qrSvg: result.qrSvg });
      // Automatic printing stays silent when another console already printed it, or printing is manual.
      if (auto && (result?.reason === "already_printed" || result?.reason === "manual_mode")) return;
      setNotice(result?.reason === "not_printable" ? t("notConfirmed") : t("failed"));
      window.setTimeout(() => setNotice(null), 5000);
    },
    [slug, locale, enqueue, t],
  );

  useEffect(() => {
    const onPrint = (e: Event) => {
      const id = (e as CustomEvent<{ orderId?: string }>).detail?.orderId;
      if (id) void run(id, false);
    };
    const onConfirmed = (e: Event) => {
      const id = (e as CustomEvent<{ orderId?: string }>).detail?.orderId;
      if (id && autoPrint) void run(id, true);
    };
    window.addEventListener(PRINT_RECEIPT_EVENT, onPrint);
    window.addEventListener(ORDER_CONFIRMED_EVENT, onConfirmed);
    return () => {
      window.removeEventListener(PRINT_RECEIPT_EVENT, onPrint);
      window.removeEventListener(ORDER_CONFIRMED_EVENT, onConfirmed);
    };
  }, [run, autoPrint]);

  // Once the sheet is on the page: print it, then the next one.
  useEffect(() => {
    if (!job) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.body.classList.remove("receipt-printing");
      window.removeEventListener("afterprint", finish);
      next();
    };
    const frame = window.requestAnimationFrame(() => {
      document.body.classList.add("receipt-printing");
      window.addEventListener("afterprint", finish);
      window.print();
      // `afterprint` ends the job; a minute later at the latest, so one stuck print never holds the queue.
      window.setTimeout(finish, 60_000);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [job, next]);

  return (
    <>
      {notice && (
        <p role="status" className="fixed bottom-4 end-4 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg print:hidden">
          {notice}
        </p>
      )}
      {job && createPortal(<ReceiptSheet view={job.view} qrSvg={job.qrSvg} />, document.body)}
    </>
  );
}

/** The printed receipt (80 mm wide, also fine on A4). */
function ReceiptSheet({ view, qrSvg }: Job) {
  const t = useTranslations("console.receipt");
  const row = (label: string, value: string | null, strong = false) =>
    value ? (
      <div className={`flex justify-between gap-3 ${strong ? "text-[13px] font-bold" : ""}`}>
        <span>{label}</span>
        <span dir="ltr">{value}</span>
      </div>
    ) : null;
  return (
    <div id="receipt-print-root" dir={view.dir} data-testid="receipt-sheet">
      <div className="receipt-sheet">
        <div className="text-center">
          <p className="text-[15px] font-bold">{view.business.name}</p>
          {view.business.legalName && view.business.legalName !== view.business.name && <p>{view.business.legalName}</p>}
          {view.branch?.name && <p>{view.branch.name}</p>}
          {view.business.address && <p>{view.business.address}</p>}
          {view.business.phone && <p dir="ltr">{view.business.phone}</p>}
          {view.business.vatNumber && (
            <p className="font-semibold">
              {t("vatNumber")}: <span dir="ltr">{view.business.vatNumber}</span>
            </p>
          )}
        </div>
        <hr />
        <p className="text-center text-[13px] font-bold">
          {t("title")} {view.receiptNumber}
        </p>
        {row(t("date"), view.date)}
        {row(t("order"), `#${view.orderNumber} · ${view.fulfillment}${view.table ? ` · ${t("table")} ${view.table}` : ""}`)}
        {view.customer && (
          <>
            <hr />
            <p className="font-semibold">{t("customer")}</p>
            {view.customer.name && <p>{view.customer.name}</p>}
            {view.customer.phone && <p dir="ltr">{view.customer.phone}</p>}
            {view.customer.email && <p dir="ltr">{view.customer.email}</p>}
            {view.customer.address && <p>{view.customer.address}</p>}
          </>
        )}
        <hr />
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-start font-semibold">{t("item")}</th>
              <th className="text-center font-semibold">{t("qty")}</th>
              <th className="text-end font-semibold">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((l, i) => (
              <tr key={i}>
                <td className="text-start align-top">
                  {l.name}
                  <span className="block text-[10px]" dir="ltr">
                    @ {l.unitPrice}
                  </span>
                </td>
                <td className="text-center align-top">{l.quantity}</td>
                <td className="text-end align-top" dir="ltr">
                  {l.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr />
        {row(t("subtotal"), view.totals.subtotal)}
        {row(t("discount"), view.totals.discount)}
        {row(t("delivery"), view.totals.delivery)}
        {row(t("tax"), view.totals.tax)}
        {row(t("total"), view.totals.total, true)}
        {row(t("payment"), view.payment)}
        {view.notes && (
          <p className="mt-1">
            {t("notes")}: {view.notes}
          </p>
        )}
        <div className="receipt-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <p className="text-center text-[10px]" dir="ltr">
          {t("reference")}: {view.reference}
        </p>
        <p className="mt-1 text-center">{t("thanks")}</p>
      </div>
    </div>
  );
}
