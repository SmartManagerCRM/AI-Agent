import { describe, expect, it } from "vitest";

import { bookingMessage, dialCode, whatsappLink, whatsappNumber } from "@/lib/booking-whatsapp";

const base = {
  customerName: "Lina",
  businessName: "Qahwa House",
  serviceName: "Private dinner",
  date: "Friday 10 October",
  time: "19:00",
  endTime: "21:00",
  partySize: 4,
};

describe("booking WhatsApp message", () => {
  it("confirms the booking's details in the customer's language", () => {
    expect(bookingMessage({ ...base, kind: "confirmed", locale: "en" })).toBe(
      "Hello Lina, your booking at Qahwa House is confirmed ✅\n• Private dinner\n• Friday 10 October at 19:00 until 21:00\n• 4 people\nWe look forward to seeing you!",
    );
    const ar = bookingMessage({ ...base, kind: "confirmed", locale: "ar", date: "الجمعة 10 أكتوبر", partySize: 2 });
    expect(ar).toContain("تم تأكيد حجزك لدى Qahwa House");
    expect(ar).toContain("الساعة 19:00 حتى 21:00");
    expect(ar).toContain("شخصان");
    const fr = bookingMessage({ ...base, kind: "confirmed", locale: "fr", endTime: null, partySize: 1 });
    expect(fr).toContain("votre réservation chez Qahwa House est confirmée");
    expect(fr).toContain("• Friday 10 October à 19:00\n• 1 personne");
  });

  it("apologises politely when the request is declined", () => {
    expect(bookingMessage({ ...base, kind: "declined", locale: "en" })).toBe(
      "Hello Lina, thank you for your booking request at Qahwa House. We're so sorry — our schedule is full on Friday 10 October at 19:00. Please choose another time; we'd love to welcome you.",
    );
    expect(bookingMessage({ ...base, kind: "declined", locale: "ar", customerName: null })).toMatch(/^مرحباً، شكراً لطلب الحجز/);
  });
});

describe("WhatsApp number", () => {
  it("keeps international numbers", () => {
    expect(whatsappNumber("+974 5512 3456", null)).toBe("97455123456");
    expect(whatsappNumber("00971 50 123 4567", "Qatar")).toBe("971501234567");
  });
  it("adds the business's country code to a local number", () => {
    expect(dialCode("UAE")).toBe("971");
    expect(dialCode("Tunisie")).toBe("216");
    expect(whatsappNumber("050 123 4567", "UAE")).toBe("971501234567");
    expect(whatsappNumber("5512 3456", "qatar")).toBe("97455123456");
    expect(whatsappNumber("971501234567", "UAE")).toBe("971501234567");
  });
  it("gives up rather than guess", () => {
    expect(whatsappNumber("050 123 4567", null)).toBeNull();
    expect(whatsappNumber("12", "UAE")).toBeNull();
    expect(whatsappNumber(null, "UAE")).toBeNull();
  });
  it("builds a wa.me link with the message ready", () => {
    expect(whatsappLink("97455123456", "Hi & bye ✅")).toBe("https://wa.me/97455123456?text=Hi%20%26%20bye%20%E2%9C%85");
  });
});
