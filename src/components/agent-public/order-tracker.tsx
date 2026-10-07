"use client";

import { useEffect, useState } from "react";

import { useAgentT } from "@/components/agent-public/agent-i18n";
import { formatMoney } from "@/lib/money";
import { trackingState } from "@/lib/order-tracking";
import { orderTrackingAction } from "@/server/agent-public/tracking";
import type { OrderTracking } from "@/server/agent-public/tracking-data";

const POLL_MS = 10_000;

/** The order's journey, step by step, kept up to date while the page is open. */
export function OrderTracker({ initial, locale }: { initial: OrderTracking; locale: string }) {
  const tr = useAgentT();
  const t = (key: string) => tr(`track.${key}`);
  const [order, setOrder] = useState(initial);

  useEffect(() => {
    const finished = (s: string) => s === "completed" || s === "cancelled" || s === "refunded";
    if (finished(order.status)) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const next = await orderTrackingAction(order.orderId);
      if (next) setOrder(next);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [order.orderId, order.status]);

  const state = trackingState({
    fulfillment: order.fulfillment,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paidAt: order.paidAt,
    history: order.history,
  });
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : null;
  const name = (n: Record<string, string> | null) => (n ? n[locale] ?? n.en ?? Object.values(n)[0] ?? "" : "");

  return (
    <div className="flex flex-col gap-5" data-testid="order-tracker" data-status={order.status}>
      {state.outcome === "cancelled" || state.outcome === "refunded" ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-100" data-testid="track-outcome">
          {t(state.outcome)}
        </p>
      ) : state.outcome === "completed" ? (
        <p className="rounded-2xl bg-agent-50 px-4 py-3 text-sm font-semibold text-agent-900 ring-1 ring-agent-100" data-testid="track-outcome">
          {t("completedNote")}
        </p>
      ) : state.outcome === "awaiting_payment" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 ring-1 ring-amber-100" data-testid="track-outcome">
          {t("awaitingPayment")}
        </p>
      ) : null}

      <ol className="relative flex flex-col" data-testid="track-steps">
        {state.steps.map((step, i) => {
          const last = i === state.steps.length - 1;
          return (
            <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0" data-step={step.key} data-done={step.done} data-current={step.current}>
              {!last && (
                <span aria-hidden className={`absolute start-[15px] top-8 h-[calc(100%-1.5rem)] w-0.5 ${step.done ? "bg-agent-500" : "bg-slate-200"}`} />
              )}
              <span
                aria-hidden
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  step.done
                    ? "bg-agent-600 text-white"
                    : step.current
                      ? "bg-white text-agent-700 ring-2 ring-agent-500"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {step.done ? "✓" : i + 1}
                {step.current && <span className="absolute inset-0 animate-ping rounded-full ring-2 ring-agent-400 motion-reduce:hidden" />}
              </span>
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3 pt-1">
                <span className={`text-[15px] ${step.done ? "font-semibold text-slate-900" : step.current ? "font-bold text-agent-800" : "text-slate-400"}`}>
                  {t(`step.${step.key}`)}
                  {step.current && <span className="ms-2 text-xs font-medium text-agent-700">{t("now")}</span>}
                </span>
                {step.done && time(step.at) && (
                  <span className="shrink-0 text-xs text-slate-500 tabular-nums" dir="ltr">
                    {time(step.at)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <section className="rounded-2xl bg-slate-50 p-4 text-sm ring-1 ring-slate-100">
        <dl className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{t("type")}</dt>
            <dd className="font-semibold text-slate-900">{t(`type_${order.fulfillment}`)}</dd>
          </div>
          {order.branchName && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{t("branch")}</dt>
              <dd className="font-semibold text-slate-900">{name(order.branchName)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{t("total")}</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">{formatMoney(order.totalMinor, order.currency, order.currencyExponent, locale)}</dd>
          </div>
        </dl>
        {order.items.length > 0 && (
          <ul className="mt-3 border-t border-slate-200 pt-3 text-slate-700">
            {order.items.map((item, i) => (
              <li key={i}>
                <span className="font-semibold tabular-nums">{item.quantity}×</span> {name(item.name)}
              </li>
            ))}
          </ul>
        )}
      </section>
      {state.outcome === "active" && <p className="text-center text-xs text-slate-400">{t("live")}</p>}
    </div>
  );
}
