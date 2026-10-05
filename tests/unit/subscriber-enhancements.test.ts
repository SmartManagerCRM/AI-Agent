import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aiUsageBand } from "@/lib/platform/ai-usage-band";
import { renderAccountInviteEmail } from "@/server/email/account-invite";
import { renderNewSubscriberAdminEmail } from "@/server/email/admin-templates";
import { renderSubscriptionEmail } from "@/server/email/subscription-templates";

describe("Subscribers row color (AI cost vs own monthly cap)", () => {
  it("bands: ≤50 green, 51–70 yellow, 71–90 orange, above 90 red", () => {
    expect(aiUsageBand(0, 20)).toBe("green");
    expect(aiUsageBand(10, 20)).toBe("green");
    expect(aiUsageBand(10.2, 20)).toBe("yellow");
    expect(aiUsageBand(14, 20)).toBe("yellow");
    expect(aiUsageBand(14.2, 20)).toBe("orange");
    expect(aiUsageBand(18, 20)).toBe("orange");
    expect(aiUsageBand(18.2, 20)).toBe("red");
    expect(aiUsageBand(20, 20)).toBe("red");
    expect(aiUsageBand(25, 20)).toBe("red");
  });
  it("an individual cap is what counts; no cap, no color", () => {
    expect(aiUsageBand(15, 100)).toBe("green");
    expect(aiUsageBand(15, null)).toBeNull();
    expect(aiUsageBand(0, 0)).toBe("red");
  });
});

const plans = { starter: { name: { en: "Starter" }, price_minor: 7900, currency: "USD", billing_interval: "month" as const, exponent: 2 } };
const payment = (first: boolean, lang: "en" | "ar" | "fr" = "en") =>
  renderSubscriptionEmail({
    kind: "payment_received",
    details: { plan_key: "starter", amount_minor: 7900, currency: "USD", first_payment: first },
    lang,
    timezone: "UTC",
    businessName: "Cafe Roma",
    ownerName: "Amira",
    plans,
    subscription: null,
    billingUrl: "https://ai-agent.smartmanager.me/en/cafe-roma/billing",
  });

describe("first payment after the trial: onboarding help", () => {
  it("the first payment asks for the menu, website and Google Maps link, within 24 hours", () => {
    const m = payment(true);
    for (const s of ["full onboarding process", "PDF or CSV", "website", "Google Maps link", "within 24 hours"]) expect(m.text).toContain(s);
    expect(m.html).toContain("Google Maps link");
  });
  it("later payments don't repeat it", () => {
    expect(payment(false).text).not.toContain("onboarding");
  });
  it("in Arabic and French too", () => {
    expect(payment(true, "ar").text).toContain("24 ساعة");
    expect(payment(true, "fr").text).toContain("24 heures");
  });
});

describe("Super Admin and owner account emails", () => {
  it("new subscriber alert: business, owner, plan, monthly/annual, trial end", () => {
    const m = renderNewSubscriberAdminEmail({
      lang: "en",
      businessName: "Cafe Roma",
      ownerName: "Amira",
      ownerEmail: "amira@example.com",
      planName: "Growth",
      annual: true,
      status: "trialing",
      trialEnds: "12 October 2026",
      country: "Tunisia",
      phone: "+216 1",
      businessType: "Café",
      adminUrl: "https://ai-agent.smartmanager.me/en/super-admin/subscribers/cafe-roma",
    });
    expect(m.subject).toBe("New subscriber: Cafe Roma");
    for (const s of ["amira@example.com", "Growth", "Annual", "Free trial", "12 October 2026", "Tunisia", "/super-admin/subscribers/cafe-roma"]) expect(m.text).toContain(s);
  });
  it("account invite: escapes input and carries the link", () => {
    const m = renderAccountInviteEmail({ lang: "en", name: "<i>A</i>", businessName: "Cafe", link: "https://x.test/en/set-password?token_hash=a&type=invite" });
    expect(m.html).not.toContain("<i>A</i>");
    expect(m.text).toContain("https://x.test/en/set-password?token_hash=a&type=invite");
  });
});
