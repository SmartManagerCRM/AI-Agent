export function formatMoney(amountMinor: number, currency: string, exponent: number, locale: string): string {
  const amount = amountMinor / 10 ** exponent;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(amount);
  } catch {
    return `${amount.toFixed(exponent)} ${currency}`;
  }
}
