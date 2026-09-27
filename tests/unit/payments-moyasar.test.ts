import { describe, expect, it } from "vitest";

import { moyasarProvider } from "@/server/payments/moyasar";

const SECRET = "sk_test_moyasar_secret_123";

function webhookBody(overrides: Partial<{ type: string; secret_token: string; dataId: string; invoiceId: string }> = {}) {
  return JSON.stringify({
    id: "evt_1",
    type: overrides.type ?? "payment_paid",
    secret_token: overrides.secret_token ?? SECRET,
    data: {
      id: overrides.dataId ?? "pay_abc",
      invoice_id: overrides.invoiceId ?? "inv_xyz",
      status: "paid",
      amount: 1500,
      currency: "SAR",
    },
  });
}

describe("moyasarProvider.extractProviderIntentId", () => {
  it("prefers data.invoice_id (what createIntent recorded as provider_intent_id)", () => {
    expect(moyasarProvider.extractProviderIntentId(webhookBody())).toBe("inv_xyz");
  });

  it("falls back to data.id when invoice_id is absent", () => {
    const body = JSON.stringify({ id: "evt_1", type: "payment_paid", data: { id: "pay_abc" } });
    expect(moyasarProvider.extractProviderIntentId(body)).toBe("pay_abc");
  });

  it("returns null for malformed JSON", () => {
    expect(moyasarProvider.extractProviderIntentId("not json")).toBeNull();
  });
});

describe("moyasarProvider.verifyWebhook", () => {
  it("accepts a payment_paid event whose secret_token matches", () => {
    const verification = moyasarProvider.verifyWebhook(webhookBody(), null, { moyasarSecretKey: SECRET }, { currencyExponent: 2 });
    expect(verification).toEqual({
      providerIntentId: "inv_xyz",
      providerEventId: "evt_1",
      status: "succeeded",
      amountMinor: 1500,
      currency: "SAR",
    });
  });

  it("maps payment_failed to a failed verification", () => {
    const verification = moyasarProvider.verifyWebhook(
      webhookBody({ type: "payment_failed" }),
      null,
      { moyasarSecretKey: SECRET },
      { currencyExponent: 2 },
    );
    expect(verification?.status).toBe("failed");
  });

  it("rejects a wrong secret_token", () => {
    const verification = moyasarProvider.verifyWebhook(
      webhookBody({ secret_token: "wrong" }),
      null,
      { moyasarSecretKey: SECRET },
      { currencyExponent: 2 },
    );
    expect(verification).toBeNull();
  });

  it("rejects when no secret key is configured for this tenant", () => {
    expect(moyasarProvider.verifyWebhook(webhookBody(), null, {}, { currencyExponent: 2 })).toBeNull();
  });

  it("returns null (not an error) for a validly-signed but non-terminal event type", () => {
    const verification = moyasarProvider.verifyWebhook(
      webhookBody({ type: "payment_authorized" }),
      null,
      { moyasarSecretKey: SECRET },
      { currencyExponent: 2 },
    );
    expect(verification).toBeNull();
  });

  it("rejects malformed JSON", () => {
    expect(moyasarProvider.verifyWebhook("not json", null, { moyasarSecretKey: SECRET }, { currencyExponent: 2 })).toBeNull();
  });
});

describe("moyasarProvider.configured", () => {
  it("is true only when a secret key is present", () => {
    expect(moyasarProvider.configured({ moyasarSecretKey: SECRET })).toBe(true);
    expect(moyasarProvider.configured({})).toBe(false);
    expect(moyasarProvider.configured({ moyasarSecretKey: null })).toBe(false);
  });
});
