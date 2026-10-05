import { callProvider, parseJson, toMajorUnits, toMinorUnits } from "./amounts";
import type {
  CreateIntentInput,
  PaymentContext,
  PaymentCredentials,
  PaymentIntent,
  PaymentProvider,
  PaymentProviderResult,
  PaymentVerification,
} from "./provider";

/**
 * MyFatoorah — KNET, mada, cards, Apple Pay, Benefit, STC Pay and the other
 * methods enabled on the business's own MyFatoorah account (Kuwait, Saudi
 * Arabia, UAE, Qatar, Bahrain, Oman, Jordan, Egypt).
 *
 *   - `POST /v2/SendPayment` (`NotificationOption: LNK`) creates an invoice
 *     and returns MyFatoorah's hosted payment page (`InvoiceURL`); the
 *     amount is charged in the order's currency (`DisplayCurrencyIso`).
 *   - The outcome is always read from `POST /v2/GetPaymentStatus` with the
 *     business's own token (`KeyType: InvoiceId`) — when the customer comes
 *     back, and when MyFatoorah's webhook names the invoice (its body is
 *     only used to find our payment, never trusted for the outcome).
 *
 * Each country's account has its own API host; test accounts use
 * apitest.myfatoorah.com. A pending invoice stays payable after a failed
 * attempt (the customer can try again on the same page), so only Paid and
 * Canceled/Expired are final.
 */
const LIVE_BASE: Record<string, string> = {
  KWT: "https://api.myfatoorah.com",
  BHR: "https://api.myfatoorah.com",
  JOR: "https://api.myfatoorah.com",
  OMN: "https://api.myfatoorah.com",
  ARE: "https://api-ae.myfatoorah.com",
  SAU: "https://api-sa.myfatoorah.com",
  QAT: "https://api-qa.myfatoorah.com",
  EGY: "https://api-eg.myfatoorah.com",
};
const TEST_BASE = "https://apitest.myfatoorah.com";

/** Each account's base currency (GetPaymentStatus's InvoiceValue is in it). */
const COUNTRY_CURRENCY: Record<string, string> = {
  KWT: "KWD", BHR: "BHD", JOR: "JOD", OMN: "OMR", ARE: "AED", SAU: "SAR", QAT: "QAR", EGY: "EGP",
};

/** MyFatoorah sometimes writes currencies the local way (KD, SR, …). */
const CURRENCY_ALIASES: Record<string, string> = { KD: "KWD", SR: "SAR", BD: "BHD", QR: "QAR", RO: "OMR", OR: "OMR", JD: "JOD", LE: "EGP", DH: "AED" };
export const normalizeMyFatoorahCurrency = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const code = value.trim().toUpperCase();
  return CURRENCY_ALIASES[code] ?? code;
};

type Envelope<T> = { IsSuccess?: boolean; Message?: string; Data?: T | null };
type SendPaymentData = { InvoiceId?: number | string; InvoiceURL?: string };
type MyFatoorahTransaction = { TransactionStatus?: string; PaidCurrency?: string; PaidCurrencyValue?: string | number; PaymentId?: string | number; Error?: string };
type PaymentStatusData = {
  InvoiceId?: number | string;
  InvoiceStatus?: string;
  InvoiceValue?: number | string;
  CustomerReference?: string | null;
  UserDefinedField?: string | null;
  InvoiceTransactions?: MyFatoorahTransaction[];
};
type WebhookBody = { Data?: { InvoiceId?: number | string; Invoice?: { Id?: number | string } } };

const baseUrl = (credentials: PaymentCredentials) =>
  credentials.myfatoorahTestMode ? TEST_BASE : (LIVE_BASE[credentials.myfatoorahCountry ?? ""] ?? LIVE_BASE.KWT);

const headers = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" });

const isSuccessTransaction = (t: MyFatoorahTransaction) => ["SUCCESS", "SUCCSS"].includes((t.TransactionStatus ?? "").trim().toUpperCase());

/**
 * The invoice's outcome: Paid (with a successful transaction) → succeeded,
 * Canceled/Expired → failed, Pending → not final. The amount is the paid
 * transaction's when it was paid in the order's currency, else the invoice
 * value when the account's base currency is the order's; otherwise none —
 * the amount check then refuses it rather than guess.
 */
export function myFatoorahOutcome(
  data: PaymentStatusData,
  context: PaymentContext & { accountCountry?: string | null },
): PaymentVerification | null {
  const invoiceId = data.InvoiceId != null ? String(data.InvoiceId) : "";
  if (!invoiceId) return null;
  // The invoice is ours: created with our payment id as its reference.
  const reference = data.CustomerReference || data.UserDefinedField;
  if (context.paymentId && reference && reference !== context.paymentId) return null;

  const status = (data.InvoiceStatus ?? "").trim().toUpperCase();
  const paid = (data.InvoiceTransactions ?? []).filter(isSuccessTransaction).pop();
  if (status === "PAID" && paid) {
    const orderCurrency = context.orderCurrency ?? "";
    const paidCurrency = normalizeMyFatoorahCurrency(paid.PaidCurrency);
    const baseCurrency = COUNTRY_CURRENCY[context.accountCountry ?? ""] ?? null;
    let amountMinor: number | null = null;
    let currency = paidCurrency ?? "";
    if (paidCurrency && paidCurrency === orderCurrency) {
      amountMinor = toMinorUnits(paid.PaidCurrencyValue, context.currencyExponent);
    } else if (baseCurrency && baseCurrency === orderCurrency) {
      amountMinor = toMinorUnits(data.InvoiceValue, context.currencyExponent);
      currency = baseCurrency;
    }
    return {
      providerIntentId: invoiceId,
      providerEventId: `myfatoorah:${invoiceId}:paid:${paid.PaymentId ?? ""}`,
      status: "succeeded",
      amountMinor: amountMinor ?? -1,
      currency,
    };
  }
  if (status === "CANCELED" || status === "CANCELLED" || status === "EXPIRED") {
    return {
      providerIntentId: invoiceId,
      providerEventId: `myfatoorah:${invoiceId}:${status.toLowerCase()}`,
      status: "failed",
      amountMinor: 0,
      currency: "",
      failureReason: `invoice ${status.toLowerCase()}`,
    };
  }
  return null;
}

async function syncInvoice(invoiceId: string, credentials: PaymentCredentials, context: PaymentContext): Promise<PaymentVerification | null> {
  const token = credentials.myfatoorahApiToken;
  if (!token || !/^\d{1,20}$/.test(invoiceId)) return null;
  const result = await callProvider(`${baseUrl(credentials)}/v2/GetPaymentStatus`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ Key: invoiceId, KeyType: "InvoiceId" }),
  });
  const envelope = result?.json as Envelope<PaymentStatusData> | null;
  if (!result?.ok || !envelope?.IsSuccess || !envelope.Data) return null;
  if (String(envelope.Data.InvoiceId ?? "") !== invoiceId) return null;
  return myFatoorahOutcome(envelope.Data, { ...context, accountCountry: credentials.myfatoorahCountry });
}

export const myfatoorahProvider: PaymentProvider = {
  name: "myfatoorah",
  webhookSignatureHeader: "myfatoorah-signature",

  configured(credentials: PaymentCredentials): boolean {
    return typeof credentials.myfatoorahApiToken === "string" && credentials.myfatoorahApiToken.length > 0;
  },

  async createIntent(input: CreateIntentInput, credentials: PaymentCredentials): Promise<PaymentProviderResult<PaymentIntent>> {
    const token = credentials.myfatoorahApiToken;
    if (!token) return { ok: false, error: "MyFatoorah isn't set up yet for this business." };
    const result = await callProvider(`${baseUrl(credentials)}/v2/SendPayment`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        NotificationOption: "LNK",
        CustomerName: "Customer",
        InvoiceValue: Number(toMajorUnits(input.amountMinor, input.currencyExponent)),
        DisplayCurrencyIso: input.currency,
        CallBackUrl: input.callbackUrl,
        ErrorUrl: input.callbackUrl,
        CustomerReference: input.paymentId,
        UserDefinedField: input.paymentId,
      }),
    });
    if (!result) return { ok: false, error: "Could not reach MyFatoorah." };
    const envelope = result.json as Envelope<SendPaymentData> | null;
    if (!result.ok || !envelope?.IsSuccess) return { ok: false, error: `MyFatoorah rejected the payment request (${result.status}).` };
    const invoiceId = envelope.Data?.InvoiceId;
    const url = envelope.Data?.InvoiceURL;
    if (invoiceId == null || !url) return { ok: false, error: "MyFatoorah returned an unexpected response." };
    return { ok: true, value: { provider: "myfatoorah", providerIntentId: String(invoiceId), checkoutUrl: url } };
  },

  extractProviderIntentId(rawBody: string): string | null {
    const body = parseJson<WebhookBody>(rawBody);
    const id = body?.Data?.InvoiceId ?? body?.Data?.Invoice?.Id;
    return id != null && /^\d{1,20}$/.test(String(id)) ? String(id) : null;
  },

  // The body only names the invoice; its outcome is read back from MyFatoorah itself.
  async verifyWebhook(rawBody, _signatureHeader, credentials, context) {
    const invoiceId = myfatoorahProvider.extractProviderIntentId(rawBody);
    return invoiceId ? syncInvoice(invoiceId, credentials, context) : null;
  },

  syncStatus(providerIntentId, credentials, context) {
    return syncInvoice(providerIntentId, credentials, context);
  },
};
