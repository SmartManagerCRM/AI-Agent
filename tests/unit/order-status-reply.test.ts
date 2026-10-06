import { describe, expect, it } from "vitest";

import { orderStatusQuestion, orderStatusReply } from "@/server/ai/deterministic/order-status";

describe("order status questions (no AI)", () => {
  it("finds the order number in the Agent's Track prompts and natural questions (EN/AR/FR)", () => {
    expect(orderStatusQuestion("What's the status of my order #1170?")).toBe(1170);
    expect(orderStatusQuestion("ما حالة طلبي رقم #1170؟")).toBe(1170);
    expect(orderStatusQuestion("Où en est ma commande n°1170 ?")).toBe(1170);
    expect(orderStatusQuestion("track order 42")).toBe(42);
    expect(orderStatusQuestion("Is my order #7 ready?")).toBe(7);
  });

  it("leaves other messages to the usual replies", () => {
    expect(orderStatusQuestion("I want to order 2 lattes")).toBeNull();
    expect(orderStatusQuestion("What's the status of the delivery zone?")).toBeNull();
    expect(orderStatusQuestion("Do you have order tracking?")).toBeNull();
  });

  it("answers in the customer's language, with the order's status and total", () => {
    const order = { status: "preparing", totalMinor: 3600, currency: "SAR", exponent: 2 };
    expect(orderStatusReply(1170, order, "en")).toBe("Order #1170 is being prepared. Total: 36.00 SAR.");
    expect(orderStatusReply(1170, order, "ar")).toBe("الطلب رقم #1170: قيد التحضير. الإجمالي: 36.00 SAR.");
    expect(orderStatusReply(1170, order, "fr")).toBe("La commande n°1170 est en préparation. Total : 36.00 SAR.");
    expect(orderStatusReply(99, null, "en")).toBe("I couldn't find order #99. Please check the number.");
  });
});
