import { describe, expect, it } from "vitest";

import { trackingState } from "@/lib/order-tracking";

const keys = (s: ReturnType<typeof trackingState>) => s.steps.map((x) => x.key);
const done = (s: ReturnType<typeof trackingState>) => s.steps.filter((x) => x.done).map((x) => x.key);
const current = (s: ReturnType<typeof trackingState>) => s.steps.find((x) => x.current)?.key ?? null;

describe("an order's tracking steps", () => {
  it("follow the order type", () => {
    const base = { status: "confirmed", paymentStatus: "pending", paidAt: null, history: [] };
    expect(keys(trackingState({ ...base, fulfillment: "pickup" }))).toEqual(["confirmed", "preparing", "prepared", "ready", "collected", "paid", "completed"]);
    expect(keys(trackingState({ ...base, fulfillment: "dine_in" }))).toEqual(["confirmed", "preparing", "prepared", "ready", "served", "paid", "completed"]);
    expect(keys(trackingState({ ...base, fulfillment: "delivery" }))).toEqual([
      "confirmed", "preparing", "prepared", "ready", "out_for_delivery", "delivered", "paid", "completed",
    ]);
  });

  it("mark what's done and where the order is now", () => {
    const s = trackingState({ fulfillment: "pickup", status: "preparing", paymentStatus: "pending", paidAt: null, history: [{ status: "preparing", at: "2026-10-07T10:05:00Z" }] });
    expect(done(s)).toEqual(["confirmed", "preparing"]);
    expect(current(s)).toBe("prepared");
    expect(s.steps.find((x) => x.key === "preparing")?.at).toBe("2026-10-07T10:05:00Z");
  });

  it("count a skipped step as done once a later one is", () => {
    const s = trackingState({ fulfillment: "delivery", status: "out_for_delivery", paymentStatus: "pending", paidAt: null, history: [] });
    expect(done(s)).toEqual(["confirmed", "preparing", "prepared", "ready", "out_for_delivery"]);
    expect(current(s)).toBe("delivered");
  });

  it("show paid from the payment itself — even an online payment made before confirmation", () => {
    const s = trackingState({ fulfillment: "pickup", status: "confirmed", paymentStatus: "succeeded", paidAt: "2026-10-07T10:00:00Z", history: [] });
    expect(s.steps.find((x) => x.key === "paid")).toMatchObject({ done: true, at: "2026-10-07T10:00:00Z" });
    expect(current(s)).toBe("preparing");
  });

  it("after collection, waits for payment, then completes", () => {
    const collected = trackingState({ fulfillment: "pickup", status: "collected", paymentStatus: "pending", paidAt: null, history: [] });
    expect(current(collected)).toBe("paid");
    const completed = trackingState({ fulfillment: "pickup", status: "completed", paymentStatus: "succeeded", paidAt: null, history: [] });
    expect(completed.outcome).toBe("completed");
    expect(completed.steps.every((x) => x.done)).toBe(true);
  });

  it("say when an order was cancelled, or is still waiting for its online payment", () => {
    expect(trackingState({ fulfillment: "pickup", status: "cancelled", paymentStatus: null, paidAt: null, history: [] }).outcome).toBe("cancelled");
    const waiting = trackingState({ fulfillment: "pickup", status: "pending_payment", paymentStatus: "pending", paidAt: null, history: [] });
    expect(waiting.outcome).toBe("awaiting_payment");
    expect(current(waiting)).toBe("confirmed");
  });
});
