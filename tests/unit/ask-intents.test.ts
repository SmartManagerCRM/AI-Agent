import { describe, expect, it } from "vitest";

import { detectLang, parseQuestion, periodRange, zonedStart } from "@/lib/assistant/intents";

describe("Ask SmartManager: understanding questions without AI", () => {
  it.each([
    ["What are my sales today?", "sales", "today", "en"],
    ["How much did we make this month", "sales", "month", "en"],
    ["How many orders yesterday?", "orders", "yesterday", "en"],
    ["pending orders", "pendingOrders", null, "en"],
    ["average order value last 30 days", "aov", "last30", "en"],
    ["best selling products this week", "topProducts", "week", "en"],
    ["new customers this month", "newCustomers", "month", "en"],
    ["members expiring this week", "expiringMembers", "week", "en"],
    ["how many active members", "memberships", null, "en"],
    ["bookings today", "bookings", "today", "en"],
    ["open conversations", "conversations", null, "en"],
    ["is my agent live?", "agent", null, "en"],
    ["what are our opening hours", "hours", null, "en"],
    ["كم مبيعات اليوم؟", "sales", "today", "ar"],
    ["عدد الطلبات هذا الشهر", "orders", "month", "ar"],
    ["المنتجات الأكثر مبيعاً الشهر الماضي", "topProducts", "lastMonth", "ar"],
    ["كم عدد الأعضاء", "memberships", null, "ar"],
    ["حجوزات الأسبوع", "bookings", "week", "ar"],
    ["Quel est mon chiffre d'affaires aujourd'hui ?", "sales", "today", "fr"],
    ["Combien de commandes ce mois ?", "orders", "month", "fr"],
    ["Mes meilleures ventes de la semaine", "topProducts", "week", "fr"],
    ["réservations demain", "bookings", null, "fr"],
    ["help", "help", null, "en"],
    ["what's the weather", "unknown", null, "en"],
  ])("%s", (q, intent, period, lang) => {
    const parsed = parseQuestion(q);
    expect(parsed.intent).toBe(intent);
    expect(parsed.period).toBe(period);
    expect(parsed.lang).toBe(lang);
  });

  it("detects the language", () => {
    expect(detectLang("مرحبا")).toBe("ar");
    expect(detectLang("combien de clients")).toBe("fr");
    expect(detectLang("how many clients")).toBe("en");
  });

  it("computes calendar periods from the business's today", () => {
    expect(periodRange("today", "2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-06" });
    expect(periodRange("week", "2026-10-07")).toEqual({ from: "2026-10-05", to: "2026-10-08" }); // Wednesday → from Monday
    expect(periodRange("lastMonth", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2026-01-01" });
    expect(periodRange("month", "2026-10-05")).toEqual({ from: "2026-10-01", to: "2026-10-06" });
  });

  it("finds when a local day starts", () => {
    expect(zonedStart("2026-10-05", "Asia/Riyadh")).toBe("2026-10-04T21:00:00.000Z");
    expect(zonedStart("2026-10-05", "UTC")).toBe("2026-10-05T00:00:00.000Z");
    expect(zonedStart("2026-07-01", "Europe/Paris")).toBe("2026-06-30T22:00:00.000Z");
  });
});
