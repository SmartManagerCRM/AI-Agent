import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderSignupConfirmationEmail } from "@/server/email/signup-confirmation";

const link = "https://ai-agent.smartmanager.me/en/welcome?token_hash=abc123&type=signup";

describe("sign-up confirmation email", () => {
  it("greets by name, names the business and carries the link (EN)", () => {
    const m = renderSignupConfirmationEmail({ lang: "en", name: "Amira", businessName: "Cafe Roma", link });
    expect(m.subject).toBe("Confirm your email — SmartManager AI Agent");
    expect(m.text).toContain("Hello Amira,");
    expect(m.text).toContain("Cafe Roma");
    expect(m.text).toContain(link);
    expect(m.html).toContain(`href="${link.replace(/&/g, "&amp;")}"`);
    expect(m.html).toContain('dir="ltr"');
  });

  it("Arabic is right-to-left; French is in French", () => {
    const ar = renderSignupConfirmationEmail({ lang: "ar", name: "", businessName: "مقهى", link });
    expect(ar.html).toContain('<html lang="ar" dir="rtl">');
    expect(ar.text.startsWith("مرحبًا،")).toBe(true);
    const fr = renderSignupConfirmationEmail({ lang: "fr", name: "Karim", businessName: "Salon", link });
    expect(fr.subject).toMatch(/^Confirmez votre e-mail/);
    expect(fr.text).toContain("Bonjour Karim,");
  });

  it("escapes what the visitor typed", () => {
    const m = renderSignupConfirmationEmail({ lang: "en", name: "<b>x</b>", businessName: '"><script>alert(1)</script>', link });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>x</b>");
    expect(m.html).toContain("&lt;script&gt;");
  });
});
