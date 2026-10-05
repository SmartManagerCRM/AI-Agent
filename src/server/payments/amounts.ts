import { timingSafeEqual } from "node:crypto";

/**
 * Amount and comparison helpers shared by the payment providers. Amounts are
 * kept in the currency's smallest unit everywhere in this app; providers that
 * speak decimal major units (Tap, PayPal, HyperPay, MyFatoorah) convert at
 * their edge with the currency's exponent (2 for SAR, 3 for KWD, 0 for JPY).
 */
export function toMajorUnits(amountMinor: number, exponent: number): string {
  return (amountMinor / 10 ** exponent).toFixed(exponent);
}

/** A decimal amount (number or string, e.g. "12.500") in the smallest unit; null when it isn't one. */
export function toMinorUnits(amountMajor: number | string | null | undefined, exponent: number): number | null {
  const value = typeof amountMajor === "string" ? Number(amountMajor.trim()) : amountMajor;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 10 ** exponent);
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function parseJson<T>(rawBody: string): T | null {
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    return null;
  }
}

/** Calls a provider's API: the JSON answer and HTTP status, or null when it couldn't be reached. Never logs bodies (they carry customer details). */
export async function callProvider(url: string, init: RequestInit): Promise<{ status: number; ok: boolean; json: unknown } | null> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    return null;
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json };
}
