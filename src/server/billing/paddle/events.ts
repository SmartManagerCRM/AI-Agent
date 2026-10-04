import { EventName, type EventEntity } from "@paddle/paddle-node-sdk";

/**
 * What a verified Paddle event means for a subscriber — one database call
 * (src/server/billing/paddle/webhook.ts makes it). Pure: unit-tested in
 * tests/unit/paddle.test.ts.
 *
 *   transaction.completed      a payment: the first one (the subscriber's
 *                              checkout), a renewal, or a plan change
 *   subscription.*             the subscription's state: cancellation
 *                              scheduled, past due, active again, cancelled
 *   anything else              nothing to do
 */
export type PaddlePayment = {
  kind: "payment";
  eventId: string;
  transactionId: string;
  subscriptionId: string | null;
  customerId: string | null;
  planKey: string | null;
  amountMinor: number;
  currency: string;
  /** The subscriber's own checkout: the plan price charged must equal the one recorded when it started. */
  checkAmount: number | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type PaddleSubscriptionChange = {
  kind: "subscription";
  eventId: string;
  occurredAt: string;
  subscriptionId: string;
  /** Only on subscription.created: the checkout transaction that created it. */
  transactionId: string | null;
  customerId: string | null;
  status: string;
  /** When a scheduled cancellation takes effect. */
  cancelAt: string | null;
  planKey: string | null;
};

export type PaddleAction = PaddlePayment | PaddleSubscriptionChange | { kind: "ignore"; eventType: string };

const planKeyOf = (customData: Record<string, unknown> | null | undefined): string | null =>
  typeof customData?.plan_key === "string" ? customData.plan_key : null;

export function paddleAction(event: EventEntity): PaddleAction {
  switch (event.eventType) {
    case EventName.TransactionCompleted: {
      const txn = event.data;
      const item = txn.items[0];
      const unit = Number(item?.price?.unitPrice.amount ?? NaN) * (item?.quantity ?? 1);
      // A plan change is charged pro rata: what was actually charged (before tax).
      const charged = Number(txn.details?.totals?.subtotal ?? NaN);
      const amountMinor = txn.origin === "subscription_update" ? charged : unit;
      if (!Number.isFinite(amountMinor)) return { kind: "ignore", eventType: event.eventType };
      const firstPayment = txn.origin === "web" || txn.origin === "api";
      return {
        kind: "payment",
        eventId: event.eventId,
        transactionId: txn.id,
        subscriptionId: txn.subscriptionId,
        customerId: txn.customerId,
        planKey: planKeyOf(item?.price?.customData),
        amountMinor,
        currency: txn.currencyCode,
        checkAmount: firstPayment && Number.isFinite(unit) ? unit : null,
        periodStart: txn.billingPeriod?.startsAt ?? null,
        periodEnd: txn.billingPeriod?.endsAt ?? null,
      };
    }
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionActivated:
    case EventName.SubscriptionUpdated:
    case EventName.SubscriptionPastDue:
    case EventName.SubscriptionCanceled:
    case EventName.SubscriptionPaused:
    case EventName.SubscriptionResumed: {
      const sub = event.data;
      const scheduled = sub.scheduledChange;
      return {
        kind: "subscription",
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        subscriptionId: sub.id,
        transactionId: event.eventType === EventName.SubscriptionCreated ? event.data.transactionId : null,
        customerId: sub.customerId,
        status: sub.status,
        cancelAt: scheduled?.action === "cancel" ? scheduled.effectiveAt : null,
        planKey: planKeyOf(sub.items[0]?.price?.customData),
      };
    }
    default:
      return { kind: "ignore", eventType: event.eventType };
  }
}
