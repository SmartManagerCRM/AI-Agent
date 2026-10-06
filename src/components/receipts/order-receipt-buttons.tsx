"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { announceOrderConfirmed, requestReceiptPrint } from "./receipt-print-host";

/** Prints the order's receipt (shown once the order is confirmed). */
export function PrintReceiptButton({ orderId }: { orderId: string }) {
  const t = useTranslations("console.receipt");
  return (
    <button
      type="button"
      onClick={() => requestReceiptPrint(orderId)}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      data-testid="print-receipt"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z" />
      </svg>
      {t("print")}
    </button>
  );
}

/**
 * "Mark as confirmed": changes the status, then — when the business prints
 * receipts automatically — prints this order's receipt.
 */
export function ConfirmOrderButton({
  action,
  orderId,
  slug,
  locale,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  orderId: string;
  slug: string;
  locale: string;
  label: string;
}) {
  const [pending, start] = useTransition();
  return (
    <form
      action={(formData) =>
        start(async () => {
          await action(formData);
          announceOrderConfirmed(orderId);
        })
      }
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="newStatus" value="confirmed" />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-emerald-600 underline-offset-2 hover:underline disabled:opacity-50"
        data-testid="confirm-order"
      >
        {label}
      </button>
    </form>
  );
}
