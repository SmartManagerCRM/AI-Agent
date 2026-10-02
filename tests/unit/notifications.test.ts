import { describe, expect, it } from "vitest";

import {
  AlertScheduler,
  BoundedSet,
  Deduper,
  acceptEvent,
  orderSummary,
  type NotificationEvent,
  type SoundName,
} from "@/lib/notifications/core";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function order(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: uuid(),
    kind: "new_order_received",
    audience: "tenant",
    tenant_id: TENANT,
    entity_id: uuid(),
    payload: { order_number: 1042, items: 3, total_minor: 8700, currency: "SAR", currency_exponent: 2 },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** A fake clock + timers, and a record of the sounds played. */
function harness(options: { reminderMs?: number | null; claim?: (id: string) => boolean; playable?: boolean } = {}) {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 0;
  const played: { at: number; sound: SoundName }[] = [];
  const scheduler = new AlertScheduler({
    play: (sound) => {
      played.push({ at: now, sound });
      return options.playable ?? true;
    },
    claim: options.claim,
    burstWindowMs: 4000,
    reminderMs: options.reminderMs === undefined ? 12000 : options.reminderMs,
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++nextId;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = end;
  };
  return { scheduler, played, advance };
}

describe("event validation", () => {
  it("accepts this business's new orders only", () => {
    const scope = { kind: "tenant" as const, tenantId: TENANT };
    expect(acceptEvent(scope, order())).not.toBeNull();
    expect(acceptEvent(scope, order({ tenant_id: OTHER }))).toBeNull();
    expect(acceptEvent(scope, order({ kind: "new_subscriber", audience: "platform" }))).toBeNull();
    expect(acceptEvent(scope, order({ audience: "platform" }))).toBeNull();
    expect(acceptEvent(scope, { ...order(), id: "not-a-uuid" })).toBeNull();
    expect(acceptEvent(scope, null)).toBeNull();
  });

  it('a business console also takes its own "analysis finished" event (never another business\'s)', () => {
    const scope = { kind: "tenant" as const, tenantId: TENANT };
    expect(acceptEvent(scope, order({ kind: "brain_analysis_finished" }))).not.toBeNull();
    expect(acceptEvent(scope, order({ kind: "brain_analysis_finished", tenant_id: OTHER }))).toBeNull();
    expect(acceptEvent({ kind: "platform" }, order({ kind: "brain_analysis_finished" }))).toBeNull();
  });

  it("the Super Admin console accepts platform events only", () => {
    const scope = { kind: "platform" as const };
    expect(acceptEvent(scope, order({ kind: "new_subscriber", audience: "platform" }))).not.toBeNull();
    expect(acceptEvent(scope, order({ kind: "subscription_upgraded", audience: "platform" }))).not.toBeNull();
    expect(acceptEvent(scope, order())).toBeNull();
  });

  it("summarises an order for the toast", () => {
    expect(orderSummary(order())).toMatchObject({
      orderNumber: 1042,
      items: 3,
      totalMinor: 8700,
      currency: "SAR",
      exponent: 2,
    });
  });
});

describe("deduplication", () => {
  it("handles each order once, even when delivered twice under different event ids", () => {
    const d = new Deduper();
    const first = order();
    expect(d.firstTime(first)).toBe(true);
    expect(d.firstTime(first)).toBe(false);
    expect(d.firstTime({ ...first, id: uuid() })).toBe(false);
    expect(d.firstTime(order())).toBe(true);
  });

  it("stays bounded however many events arrive", () => {
    const s = new BoundedSet(50);
    for (let i = 0; i < 1000; i++) s.add(`k${i}`);
    expect(s.size).toBe(50);
    expect(s.has("k999")).toBe(true);
    expect(s.has("k0")).toBe(false);
  });
});

describe("sound scheduling", () => {
  it("one order: chime at once, one softer reminder if unacknowledged, then silence", () => {
    const h = harness();
    h.scheduler.add(order());
    expect(h.played).toEqual([{ at: 0, sound: "new-order" }]);
    h.advance(12000);
    expect(h.played).toEqual([
      { at: 0, sound: "new-order" },
      { at: 12000, sound: "order-reminder" },
    ]);
    h.advance(10 * 60 * 1000);
    expect(h.played).toHaveLength(2);
  });

  it("acknowledged before the reminder → no reminder", () => {
    const h = harness();
    const e = order();
    h.scheduler.add(e);
    h.advance(5000);
    h.scheduler.acknowledge([e.id]);
    h.advance(60000);
    expect(h.played.map((p) => p.sound)).toEqual(["new-order"]);
  });

  it("five orders within seconds: one chime, one follow-up, one reminder — never five overlapping sounds", () => {
    const h = harness();
    h.scheduler.add(order());
    for (let i = 0; i < 4; i++) {
      h.advance(500);
      h.scheduler.add(order());
    }
    expect(h.played).toHaveLength(1);
    h.advance(2000);
    expect(h.played.map((p) => [p.at, p.sound])).toEqual([
      [0, "new-order"],
      [4000, "new-order"],
    ]);
    h.advance(60000);
    expect(h.played.filter((p) => p.sound === "order-reminder")).toHaveLength(1);
    expect(h.played.length).toBeLessThanOrEqual(4);
  });

  it("orders arriving together share one chime and one reminder", () => {
    const h = harness();
    for (let i = 0; i < 5; i++) h.scheduler.add(order());
    h.advance(60000);
    expect(h.played.map((p) => p.sound)).toEqual(["new-order", "order-reminder"]);
  });

  it("never more than two sounds per order", () => {
    const h = harness();
    for (let i = 0; i < 20; i++) {
      h.scheduler.add(order());
      h.advance(30000);
    }
    // 20 orders spaced out: each gets its chime and one reminder at most.
    expect(h.played.length).toBeLessThanOrEqual(40);
    expect(h.played.filter((p) => p.sound === "new-order")).toHaveLength(20);
  });

  it("an order another open tab already alerted for stays silent here", () => {
    const h = harness({ claim: () => false });
    h.scheduler.add(order());
    h.advance(60000);
    expect(h.played).toEqual([]);
  });

  it("platform events: their own sound, no reminders", () => {
    const h = harness({ reminderMs: null });
    h.scheduler.add(order({ kind: "new_subscriber", audience: "platform" }));
    h.advance(5000);
    h.scheduler.add(order({ kind: "subscription_upgraded", audience: "platform" }));
    h.advance(60000);
    expect(h.played.map((p) => p.sound)).toEqual(["new-subscriber", "subscription-upgrade"]);
  });

  it("disposing cancels pending sounds", () => {
    const h = harness();
    h.scheduler.add(order());
    h.scheduler.add(order());
    h.scheduler.dispose();
    h.advance(60000);
    expect(h.played).toHaveLength(1);
  });
});
