/**
 * An order's journey as its customer sees it on the tracking page. Pure:
 * unit-tested in tests/unit/order-tracking.test.ts.
 *
 *   pickup    confirmed → preparing → prepared → ready → collected → paid → completed
 *   dine-in   confirmed → preparing → prepared → ready → served → paid → completed
 *   delivery  confirmed → preparing → prepared → ready → out for delivery → delivered → paid → completed
 *
 * "Paid" comes from the payment itself (collected in cash, or paid online —
 * possibly before the order was even confirmed). A step the business skipped
 * (e.g. straight from preparing to ready) shows as done once a later one is.
 */

export type Fulfillment = "pickup" | "delivery" | "dine_in";
export type TrackingStepKey =
  | "confirmed"
  | "preparing"
  | "prepared"
  | "ready"
  | "collected"
  | "served"
  | "out_for_delivery"
  | "delivered"
  | "paid"
  | "completed";

export type TrackingStep = { key: TrackingStepKey; done: boolean; current: boolean; at: string | null };
export type TrackingState = { steps: TrackingStep[]; outcome: "active" | "completed" | "cancelled" | "refunded" | "awaiting_payment" };

const FLOWS: Record<Fulfillment, TrackingStepKey[]> = {
  pickup: ["confirmed", "preparing", "prepared", "ready", "collected", "paid", "completed"],
  dine_in: ["confirmed", "preparing", "prepared", "ready", "served", "paid", "completed"],
  delivery: ["confirmed", "preparing", "prepared", "ready", "out_for_delivery", "delivered", "paid", "completed"],
};

/** How far along each order status is (the payment step is not a status). */
const RANK: Record<string, number> = {
  confirmed: 1,
  preparing: 2,
  prepared: 3,
  ready: 4,
  collected: 5,
  served: 5,
  out_for_delivery: 5,
  delivered: 6,
  completed: 9,
};

export function trackingState(input: {
  fulfillment: Fulfillment;
  status: string;
  paymentStatus: string | null;
  paidAt: string | null;
  history: { status: string; at: string }[];
}): TrackingState {
  const { fulfillment, status, paymentStatus, paidAt, history } = input;
  const flow = FLOWS[fulfillment] ?? FLOWS.pickup;
  const reached = RANK[status] ?? 0;
  const paid = paymentStatus === "succeeded" || status === "completed";
  const when = (key: string) => [...history].reverse().find((h) => h.status === key)?.at ?? null;

  const steps: TrackingStep[] = flow.map((key) => {
    if (key === "paid") return { key, done: paid, current: false, at: paid ? paidAt : null };
    const rank = key === "completed" ? RANK.completed : key === "delivered" ? RANK.delivered : RANK[key];
    return { key, done: reached >= rank, current: false, at: when(key) };
  });
  const outcome: TrackingState["outcome"] =
    status === "cancelled" ? "cancelled" : status === "refunded" ? "refunded" : status === "completed" ? "completed" : reached === 0 ? "awaiting_payment" : "active";
  if (outcome === "active" || outcome === "awaiting_payment") {
    // The step the order is at now: the first one not done yet.
    const next = steps.find((s) => !s.done);
    if (next) next.current = true;
  }
  return { steps, outcome };
}
