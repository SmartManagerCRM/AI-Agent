import { describe, expect, it } from "vitest";

import { mockPaymentProvider, signMockWebhookPayload } from "@/server/payments/mock";

const PAYLOAD = {
  providerIntentId: "mock_pi_abc123",
  eventId: "evt_1",
  status: "succeeded" as const,
  amountMinor: 1500,
  currency: "SAR",
};

describe("mockPaymentProvider.createIntent", () => {
  it("returns a fresh provider intent id and a checkout path scoped to the payment", async () => {
    const result = await mockPaymentProvider.createIntent({
      paymentId: "11111111-1111-1111-1111-111111111111",
      orderNumber: 1001,
      amountMinor: 1500,
      currency: "SAR",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provider).toBe("mock");
    expect(result.value.providerIntentId).toMatch(/^mock_pi_/);
    expect(result.value.checkoutUrl).toBe("/pay/11111111-1111-1111-1111-111111111111");
  });

  it("issues a different provider intent id on every call", async () => {
    const a = await mockPaymentProvider.createIntent({ paymentId: "p1", orderNumber: 1, amountMinor: 100, currency: "SAR" });
    const b = await mockPaymentProvider.createIntent({ paymentId: "p1", orderNumber: 1, amountMinor: 100, currency: "SAR" });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.value.providerIntentId).not.toBe(b.value.providerIntentId);
  });
});

describe("mockPaymentProvider.verifyWebhook", () => {
  it("accepts a correctly signed payload and extracts the verification", () => {
    const { body, signature } = signMockWebhookPayload(PAYLOAD);
    const verification = mockPaymentProvider.verifyWebhook(body, signature);
    expect(verification).toEqual({
      providerIntentId: PAYLOAD.providerIntentId,
      providerEventId: PAYLOAD.eventId,
      status: "succeeded",
      amountMinor: 1500,
      currency: "SAR",
      failureReason: undefined,
    });
  });

  it("rejects a tampered body even if a signature header is present", () => {
    const { body, signature } = signMockWebhookPayload(PAYLOAD);
    const tampered = body.replace('"amountMinor":1500', '"amountMinor":100');
    expect(mockPaymentProvider.verifyWebhook(tampered, signature)).toBeNull();
  });

  it("rejects a missing signature", () => {
    const { body } = signMockWebhookPayload(PAYLOAD);
    expect(mockPaymentProvider.verifyWebhook(body, null)).toBeNull();
  });

  it("rejects a well-formed but wrong signature", () => {
    const { body } = signMockWebhookPayload(PAYLOAD);
    const { signature: otherSignature } = signMockWebhookPayload({ ...PAYLOAD, eventId: "evt_2" });
    expect(mockPaymentProvider.verifyWebhook(body, otherSignature)).toBeNull();
  });

  it("rejects a signature of the wrong length instead of throwing", () => {
    const { body } = signMockWebhookPayload(PAYLOAD);
    expect(mockPaymentProvider.verifyWebhook(body, "ab")).toBeNull();
  });

  it("rejects malformed JSON", () => {
    const notJson = "not json";
    const signature = signMockWebhookPayload(PAYLOAD).signature;
    expect(mockPaymentProvider.verifyWebhook(notJson, signature)).toBeNull();
  });

  it("rejects an unknown status value", () => {
    const { body, signature } = signMockWebhookPayload({ ...PAYLOAD, status: "refunded" as unknown as "succeeded" });
    expect(mockPaymentProvider.verifyWebhook(body, signature)).toBeNull();
  });
});
