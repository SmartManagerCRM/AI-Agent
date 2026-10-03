import { describe, expect, it } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { parseQuestion } from "@/lib/assistant/intents";

// The suggested questions on the Dashboard's Ask box must be understood — and answered in the same language — in every language.
const EXPECTED = [
  ["sales", "today"],
  ["orders", "week"],
  ["topProducts", "month"],
  ["pendingOrders", null],
  ["bookings", "today"],
  ["expiringMembers", null],
  ["agent", null],
] as const;

describe.each([
  ["en", en],
  ["ar", ar],
  ["fr", fr],
] as const)("Ask suggestions (%s)", (lang, messages) => {
  it.each(EXPECTED.map((e, i) => [i + 1, ...e] as const))("suggestion %i → %s", (n, intent, period) => {
    const q = (messages.console.ask as Record<string, string>)[`suggestion${n}`];
    const parsed = parseQuestion(q);
    expect(parsed.intent).toBe(intent);
    if (period) expect(parsed.period).toBe(period);
    expect(parsed.lang).toBe(lang);
  });
});
