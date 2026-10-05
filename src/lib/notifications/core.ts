/**
 * Console notifications — the browser-side rules, kept free of React and of
 * the browser so they can be unit-tested:
 *
 *   realtime row ──► acceptEvent (right kind, audience, business)
 *                ──► Deduper     (each event / order handled once, bounded)
 *                ──► AlertScheduler (one sound per burst, one reminder, max 2 per order)
 *
 * The database decides *what* is an event (`notification_events`, written
 * by triggers on the order and subscription state machines) and *who* may
 * see it (RLS, which Supabase Realtime applies to every change it sends).
 * These checks are a second line, never the authorisation itself.
 */

export type NotificationKind =
  "new_order_received" | "brain_analysis_finished" | "booking_requested" | "new_subscriber" | "subscription_upgraded";

/** Events the business must act on (an order, a booking request): they ring like an order and get one reminder. */
export function needsAction(kind: NotificationKind): boolean {
  return kind === "new_order_received" || kind === "booking_requested";
}

export type NotificationEvent = {
  id: string;
  kind: NotificationKind;
  audience: "tenant" | "platform";
  tenant_id: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type NotificationScope = { kind: "tenant"; tenantId: string } | { kind: "platform" };

export type SoundName = "new-order" | "order-reminder" | "new-subscriber" | "subscription-upgrade";

export const SOUND_URLS: Record<SoundName, string> = {
  "new-order": "/sounds/new-order.wav",
  "order-reminder": "/sounds/order-reminder.wav",
  "new-subscriber": "/sounds/new-subscriber.wav",
  "subscription-upgrade": "/sounds/subscription-upgrade.wav",
};

/** Sound for an event's first alert. */
/** A new order rings three times, so it's heard over a busy counter; so does a new subscriber (Super Admin). Other alerts play once. */
export function soundRepeats(sound: SoundName): number {
  return sound === "new-order" || sound === "new-subscriber" ? 3 : 1;
}

export function soundFor(kind: NotificationKind): SoundName {
  return needsAction(kind)
    ? "new-order"
    : kind === "new_subscriber"
      ? "new-subscriber"
      : "subscription-upgrade";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A well-formed event this console is meant to show; anything else is ignored. */
export function acceptEvent(scope: NotificationScope, row: unknown): NotificationEvent | null {
  if (!row || typeof row !== "object") return null;
  const e = row as Partial<NotificationEvent>;
  if (typeof e.id !== "string" || !UUID.test(e.id)) return null;
  if (typeof e.entity_id !== "string" || !UUID.test(e.entity_id)) return null;
  if (typeof e.created_at !== "string" || !e.payload || typeof e.payload !== "object") return null;
  if (scope.kind === "tenant") {
    if (e.kind !== "new_order_received" && e.kind !== "brain_analysis_finished" && e.kind !== "booking_requested") return null;
    if (e.audience !== "tenant" || e.tenant_id !== scope.tenantId) return null;
  } else if (e.audience !== "platform" || (e.kind !== "new_subscriber" && e.kind !== "subscription_upgraded")) {
    return null;
  }
  return e as NotificationEvent;
}

/** Remembers the most recent keys only — memory stays bounded however long the console is open. */
export class BoundedSet {
  private readonly keys = new Set<string>();
  constructor(private readonly max = 300) {}
  has(key: string) {
    return this.keys.has(key);
  }
  add(key: string) {
    this.keys.delete(key);
    this.keys.add(key);
    while (this.keys.size > this.max) this.keys.delete(this.keys.values().next().value as string);
  }
  get size() {
    return this.keys.size;
  }
}

/** True the first time an event (or, for orders, the order itself) is seen. */
export class Deduper {
  private readonly seen: BoundedSet;
  constructor(max = 300) {
    this.seen = new BoundedSet(max);
  }
  firstTime(event: NotificationEvent): boolean {
    const keys = [`event:${event.id}`, `${event.kind}:${event.entity_id}`];
    // Orders and booking requests dedupe by their id; platform events by event (a business may upgrade twice).
    const key = needsAction(event.kind) ? keys[1] : keys[0];
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

export type SchedulerOptions = {
  /** Plays a sound; false when it could not (sound off, audio locked, load failure). */
  play: (sound: SoundName) => boolean;
  /** This tab may alert for the event (another open tab of the console has not already). */
  claim?: (eventId: string) => boolean;
  /** New events closer together than this share one sound. */
  burstWindowMs?: number;
  /** One softer reminder after this long if still unacknowledged; null = no reminder. */
  reminderMs?: number | null;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Events this close to the last sound are announced by it (simultaneous orders). */
const COVERED_BY_LAST_SOUND_MS = 1500;

type Tracked = { event: NotificationEvent; sounds: number; firstSoundAt: number | null; acknowledged: boolean; addedAt: number };

/** A chime that couldn't play (audio suspended in the background) is still owed for this long. */
const MISSED_SOUND_WINDOW_MS = 10 * 60 * 1000;

/**
 * Turns a stream of events into a calm sequence of sounds:
 *   - the first event of a burst plays at once;
 *   - events arriving within `burstWindowMs` of a sound share one follow-up
 *     sound at the end of the window (five orders ≠ five overlapping chimes);
 *   - an event still unacknowledged after `reminderMs` gets one softer
 *     reminder — at most two sounds per event, never a loop.
 */
export class AlertScheduler {
  private readonly tracked = new Map<string, Tracked>();
  private lastSoundAt = Number.NEGATIVE_INFINITY;
  private followUp: unknown = null;
  private reminder: unknown = null;
  private readonly o: Required<SchedulerOptions>;

  constructor(options: SchedulerOptions) {
    this.o = {
      claim: () => true,
      burstWindowMs: 4000,
      reminderMs: 12000,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      // Options left undefined keep their defaults.
      ...(Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as SchedulerOptions),
    };
  }

  add(event: NotificationEvent) {
    if (!this.o.claim(event.id)) return;
    this.tracked.set(event.id, { event, sounds: 0, firstSoundAt: null, acknowledged: false, addedAt: this.o.now() });
    while (this.tracked.size > 100) this.tracked.delete(this.tracked.keys().next().value as string);
    const now = this.o.now();
    const sinceLast = now - this.lastSoundAt;
    if (sinceLast >= this.o.burstWindowMs) this.soundPending();
    else if (sinceLast < COVERED_BY_LAST_SOUND_MS) {
      // Arrived together with the event that just chimed: that chime covers it.
      const t = this.tracked.get(event.id)!;
      t.sounds = 1;
      t.firstSoundAt = now;
      this.scheduleReminder();
    } else if (this.followUp === null) {
      this.followUp = this.o.setTimer(() => {
        this.followUp = null;
        this.soundPending();
      }, this.o.burstWindowMs - sinceLast);
    }
  }

  acknowledge(eventIds?: string[]) {
    for (const [id, t] of this.tracked) if (!eventIds || eventIds.includes(id)) t.acknowledged = true;
  }

  /**
   * Audio became available again (the console came back to the foreground,
   * or the user tapped): events whose chime couldn't play get one now — if
   * still unacknowledged and recent.
   */
  flushMissed() {
    const now = this.o.now();
    for (const [id, t] of this.tracked) {
      if (t.sounds === 0 && now - t.addedAt > MISSED_SOUND_WINDOW_MS) this.tracked.delete(id);
    }
    this.soundPending();
  }

  dispose() {
    if (this.followUp !== null) this.o.clearTimer(this.followUp);
    if (this.reminder !== null) this.o.clearTimer(this.reminder);
    this.followUp = this.reminder = null;
  }

  private soundPending() {
    const pending = [...this.tracked.values()].filter((t) => t.sounds === 0 && !t.acknowledged);
    if (pending.length === 0) return;
    const now = this.o.now();
    // The most recent event decides the sound (platform: subscriber vs upgrade).
    // If it couldn't play (audio suspended while the console was in the
    // background), nothing counts as announced: flushMissed() retries.
    if (!this.o.play(soundFor(pending[pending.length - 1].event.kind))) return;
    this.lastSoundAt = now;
    for (const t of pending) {
      t.sounds = 1;
      t.firstSoundAt = now;
    }
    this.scheduleReminder();
  }

  private scheduleReminder() {
    const { reminderMs } = this.o;
    if (reminderMs === null || this.reminder !== null) return;
    const due = [...this.tracked.values()].filter((t) => t.sounds === 1 && !t.acknowledged && t.firstSoundAt !== null);
    if (due.length === 0) return;
    const earliest = Math.min(...due.map((t) => t.firstSoundAt as number));
    this.reminder = this.o.setTimer(
      () => {
        this.reminder = null;
        const now = this.o.now();
        // One reminder covers every waiting event that chimed a while ago, so a
        // burst of orders gets a single reminder rather than one per follow-up.
        const ready = [...this.tracked.values()].filter(
          (t) => t.sounds === 1 && !t.acknowledged && t.firstSoundAt !== null && now - t.firstSoundAt >= reminderMs / 2,
        );
        if (ready.length > 0 && ready.some((t) => needsAction(t.event.kind))) {
          this.o.play("order-reminder");
          this.lastSoundAt = now;
        }
        for (const t of ready) t.sounds = 2;
        this.scheduleReminder();
      },
      Math.max(0, earliest + reminderMs - this.o.now()),
    );
  }
}

/** "Order #1042", "3 items · SAR 87.00" — the money is formatted by the caller. */
export function orderSummary(event: NotificationEvent) {
  const p = event.payload as {
    order_number?: number;
    items?: number;
    total_minor?: number;
    currency?: string;
    currency_exponent?: number;
  };
  return {
    orderId: event.entity_id,
    orderNumber: typeof p.order_number === "number" ? p.order_number : null,
    items: typeof p.items === "number" ? p.items : null,
    totalMinor: typeof p.total_minor === "number" ? p.total_minor : null,
    currency: typeof p.currency === "string" ? p.currency : null,
    exponent: typeof p.currency_exponent === "number" ? p.currency_exponent : 2,
  };
}
