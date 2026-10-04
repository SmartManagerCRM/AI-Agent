import { describe, expect, it } from "vitest";

import {
  emailLanguage,
  formatAmount,
  renderSubscriptionEmail,
  type SubscriptionEmailInput,
  type SubscriptionEmailKind,
} from "@/server/email/subscription-templates";

const plans = {
  starter: { name: { en: "Starter", ar: "المبتدئ", fr: "Démarrage" }, price_minor: 7900, currency: "USD", billing_interval: "month", exponent: 2 },
  growth: { name: { en: "Growth", ar: "النمو", fr: "Croissance" }, price_minor: 14900, currency: "USD", billing_interval: "month", exponent: 2 },
  growth_year: { name: { en: "Growth (annual)" }, price_minor: 149000, currency: "USD", billing_interval: "year", exponent: 2 },
};

const input = (kind: SubscriptionEmailKind, details: Record<string, unknown>, over: Partial<SubscriptionEmailInput> = {}): SubscriptionEmailInput => ({
  kind,
  details,
  lang: "en",
  timezone: "UTC",
  businessName: "Khayal Café",
  ownerName: "Mona",
  plans,
  subscription: {
    plan_key: "growth",
    status: "active",
    current_period_start: "2026-10-04T12:00:00Z",
    current_period_end: "2026-11-04T12:00:00Z",
    cancel_at: null,
  },
  billingUrl: "https://ai-agent.smartmanager.me/en/khayal/billing",
  ...over,
});

describe("subscription emails", () => {
  it("a payment: the amount, the plan, monthly, the period and the next renewal", () => {
    const email = renderSubscriptionEmail(input("payment_received", { plan_key: "growth", amount_minor: 14900, currency: "USD" }));
    expect(email.subject).toBe("Payment received: $149.00 — Khayal Café");
    expect(email.text).toContain("- Amount paid (excl. tax): $149.00");
    expect(email.text).toContain("- Plan: Growth");
    expect(email.text).toContain("- Billing cycle: Monthly");
    expect(email.text).toContain("- Price: $149.00 / month");
    expect(email.text).toContain("- Billing period: October 4, 2026 – November 4, 2026");
    expect(email.text).toContain("- Next renewal: November 4, 2026");
    expect(email.text).toContain("https://ai-agent.smartmanager.me/en/khayal/billing");
    expect(email.html).toContain('dir="ltr"');
  });

  it("every kind says monthly or annual", () => {
    const kinds: SubscriptionEmailKind[] = [
      "trial_started",
      "payment_received",
      "upgraded",
      "downgraded",
      "cancel_scheduled",
      "renewal_resumed",
      "canceled",
      "paused",
      "payment_failed",
    ];
    for (const kind of kinds) {
      const yearly = renderSubscriptionEmail(input(kind, { plan_key: "growth_year", from_plan: "growth", amount_minor: 149000, currency: "USD" }));
      expect(yearly.text, kind).toContain("- Billing cycle: Annual");
      expect(yearly.text, kind).toContain("$1,490.00 / year");
      const monthly = renderSubscriptionEmail(input(kind, { plan_key: "starter", from_plan: "growth" }));
      expect(monthly.text, kind).toContain("- Billing cycle: Monthly");
    }
  });

  it("a trial: its plan and end date", () => {
    const email = renderSubscriptionEmail(input("trial_started", { plan_key: "starter", trial_ends_at: "2026-10-18T00:00:00Z" }, { subscription: null }));
    expect(email.subject).toBe("Your free trial has started — Khayal Café");
    expect(email.text).toContain("on the Starter plan");
    expect(email.text).toContain("- Trial ends: October 18, 2026");
  });

  it("an upgrade and a downgrade name both plans", () => {
    const up = renderSubscriptionEmail(input("upgraded", { plan_key: "growth", from_plan: "starter" }));
    expect(up.subject).toBe("Your plan was upgraded to Growth — Khayal Café");
    expect(up.text).toContain("- Previous plan: Starter (Monthly)");
    const down = renderSubscriptionEmail(input("downgraded", { plan_key: "starter", from_plan: "growth_year" }));
    expect(down.text).toContain("from Growth (annual) to Starter");
    expect(down.text).toContain("- Previous plan: Growth (annual) (Annual)");
  });

  it("a scheduled cancellation gives the last day; dates follow the business's time zone", () => {
    const email = renderSubscriptionEmail(input("cancel_scheduled", { plan_key: "growth", cancel_at: "2026-11-04T02:00:00Z" }, { timezone: "America/New_York" }));
    expect(email.subject).toBe("Your subscription will end on November 3, 2026 — Khayal Café");
    expect(email.text).toContain("- Active until: November 3, 2026");
  });

  it("Arabic, right to left, with Arabic plan names; French", () => {
    const ar = renderSubscriptionEmail(input("payment_received", { plan_key: "growth", amount_minor: 14900, currency: "USD" }, { lang: "ar" }));
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.text).toContain("الباقة: النمو");
    expect(ar.text).toContain("دورة الفوترة: شهري");
    const fr = renderSubscriptionEmail(input("canceled", { plan_key: "growth_year", ended_at: "2026-11-04T12:00:00Z" }, { lang: "fr" }));
    expect(fr.subject).toBe("Votre abonnement a pris fin — Khayal Café");
    expect(fr.text).toContain("- Cycle de facturation: Annuel");
    expect(fr.text).toContain("Terminé le: 4 novembre 2026");
  });

  it("escapes what the business typed", () => {
    const email = renderSubscriptionEmail(input("paused", { plan_key: "growth" }, { businessName: '<script>alert("x")</script>', ownerName: "A & B" }));
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("A &amp; B");
  });

  it("the owner's language first, then the business's, else English", () => {
    expect(emailLanguage("ar", "fr")).toBe("ar");
    expect(emailLanguage(null, "fr-FR")).toBe("fr");
    expect(emailLanguage("de", null)).toBe("en");
  });

  it("amounts in a currency's own decimals", () => {
    expect(formatAmount(12500, "KWD", "en", 3)).toMatch(/^KWD\s12\.500$/u);
    expect(formatAmount(500, "JPY", "en")).toBe("¥500");
  });
});
