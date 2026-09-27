import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { tapProvider } from "@/server/payments/tap";

const SECRET = "sk_test_tap_secret_456";

function signedWebhook(overrides: Partial<{ status: string; amount: number; id: string }> = {}): { body: string; hashstring: string } {
  const payload = { id: overrides.id ?? "chg_abc", status: overrides.status ?? "CAPTURED", amount: overrides.amount ?? 15, currency: "SAR" };
  const body = JSON.stringify(payload);
  const hashstring = createHmac("sha256", SECRET).update(body).digest("hex");
  return { body, hashstring };
}

describe("tapProvider.extractProviderIntentId", () => {
  it("reads the charge id", () => {
    const { body } = signedWebhook();
    expect(tapProvider.extractProviderIntentId(body)).toBe("chg_abc");
  });

  it("returns null for malformed JSON", () => {
    expect(tapProvider.extractProviderIntentId("not json")).toBeNull();
  });
});

describe("tapProvider.verifyWebhook", () => {
  it("accepts a correctly-hashed CAPTURED charge and converts major to minor units", () => {
    const { body, hashstring } = signedWebhook({ amount: 15 });
    const verification = tapProvider.verifyWebhook(body, hashstring, { tapSecretKey: SECRET }, { currencyExponent: 2 });
    expect(verification).toEqual({
      providerIntentId: "chg_abc",
      providerEventId: "chg_abc",
      status: "succeeded",
      amountMinor: 1500,
      currency: "SAR",
    });
  });

  it("converts correctly for a 3-decimal currency (KWD-style)", () => {
    const { body, hashstring } = signedWebhook({ amount: 1.5 });
    const verification = tapProvider.verifyWebhook(body, hashstring, { tapSecretKey: SECRET }, { currencyExponent: 3 });
    expect(verification?.amountMinor).toBe(1500);
  });

  it("maps DECLINED to a failed verification", () => {
    const { body, hashstring } = signedWebhook({ status: "DECLINED" });
    const verification = tapProvider.verifyWebhook(body, hashstring, { tapSecretKey: SECRET }, { currencyExponent: 2 });
    expect(verification?.status).toBe("failed");
  });

  it("rejects a tampered body even with the original hashstring", () => {
    const { body, hashstring } = signedWebhook();
    const tampered = body.replace('"CAPTURED"', '"DECLINED"');
    expect(tapProvider.verifyWebhook(tampered, hashstring, { tapSecretKey: SECRET }, { currencyExponent: 2 })).toBeNull();
  });

  it("rejects a missing hashstring header", () => {
    const { body } = signedWebhook();
    expect(tapProvider.verifyWebhook(body, null, { tapSecretKey: SECRET }, { currencyExponent: 2 })).toBeNull();
  });

  it("rejects when no secret key is configured for this tenant", () => {
    const { body, hashstring } = signedWebhook();
    expect(tapProvider.verifyWebhook(body, hashstring, {}, { currencyExponent: 2 })).toBeNull();
  });

  it("returns null (not an error) for a validly-signed but non-terminal status", () => {
    const { body, hashstring } = signedWebhook({ status: "INITIATED" });
    expect(tapProvider.verifyWebhook(body, hashstring, { tapSecretKey: SECRET }, { currencyExponent: 2 })).toBeNull();
  });
});

describe("tapProvider.configured", () => {
  it("is true only when a secret key is present", () => {
    expect(tapProvider.configured({ tapSecretKey: SECRET })).toBe(true);
    expect(tapProvider.configured({})).toBe(false);
  });
});
