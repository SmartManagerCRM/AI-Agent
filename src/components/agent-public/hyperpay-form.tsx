"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    wpwlOptions?: Record<string, unknown>;
  }
}

/**
 * HyperPay's payment form (COPYandPAY): HyperPay's own script fills the
 * `paymentWidgets` form with its card fields — served by HyperPay, so card
 * details never pass through this app — and sends the customer back to
 * `resultUrl` (this payment page), where the outcome is read from HyperPay's
 * API on the server. Loaded from a client script (allowed by the page's
 * nonce + strict-dynamic CSP, like Paddle.js).
 */
export function HyperpayForm({ scriptBase, checkoutId, brands, resultUrl, locale }: { scriptBase: string; checkoutId: string; brands: string; resultUrl: string; locale: string }) {
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    window.wpwlOptions = { locale: locale === "ar" ? "ar" : locale === "fr" ? "fr" : "en", style: "card" };
    const script = document.createElement("script");
    script.src = `${scriptBase}/v1/paymentWidgets.js?checkoutId=${encodeURIComponent(checkoutId)}`;
    script.async = true;
    document.body.appendChild(script);
  }, [scriptBase, checkoutId, locale]);

  return <form action={resultUrl} className="paymentWidgets w-full" data-brands={brands} data-testid="hyperpay-form" />;
}
