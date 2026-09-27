"use client";

import { useState, useTransition } from "react";

import {
  addProductToCartAction,
  placeStructuredOrderAction,
  setCustomerDetailsAction,
  setFulfillmentTypeAction,
  setPaymentMethodAction,
  updateCartItemQuantityAction,
  type PlaceStructuredOrderResult,
} from "@/server/agent-public/catalog-actions";
import type { CartView, PaymentMethod } from "@/server/commerce/cart";

type Category = { id: string; name: Record<string, string> };
type Product = { id: string; categoryId: string | null; name: Record<string, string>; priceMinor: number };

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  moyasar: "Card / Apple Pay (Moyasar)",
  tap: "Card / Apple Pay (Tap)",
  cash_on_delivery: "Cash on Delivery",
  pay_on_table: "Pay on Table",
};

type Props = {
  slug: string;
  locale: string;
  categories: Category[];
  products: Product[];
  currency: string;
  currencyExponent: number;
  orderingEnabled: boolean;
  fulfillmentTypes: ("pickup" | "delivery")[];
  paymentMethods: PaymentMethod[];
  initialCart: CartView | null;
  surface?: "external_agent" | "website_widget";
};

function formatMinor(minor: number, exponent: number): string {
  return (minor / 10 ** exponent).toFixed(exponent);
}

function localized(name: Record<string, string>, locale: string): string {
  return name[locale] ?? Object.values(name)[0] ?? "";
}

/**
 * Deterministic, structured-UI commerce browser — no LLM call anywhere in
 * this component. Category selection is pure client-side state (the full
 * catalog is fetched once, server-side, by the page); every cart/checkout
 * action calls a dedicated Server Action
 * (`src/server/agent-public/catalog-actions.ts`) that never touches
 * `runAgentGateway`. The free-text `ChatPanel` alongside this one is the
 * only door to the AI, for whatever genuinely needs it.
 */
export function CatalogPanel({
  slug,
  locale,
  categories,
  products,
  currency,
  currencyExponent,
  orderingEnabled,
  fulfillmentTypes,
  paymentMethods,
  initialCart,
  surface = "external_agent",
}: Props) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [cart, setCart] = useState<CartView | null>(initialCart);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [details, setDetails] = useState({ name: "", phone: "", email: "", deliveryAddress: "" });
  const [orderResult, setOrderResult] = useState<PlaceStructuredOrderResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (!orderingEnabled) return null;

  const visibleProducts = selectedCategoryId ? products.filter((p) => p.categoryId === selectedCategoryId) : products;
  const fulfillmentType = cart?.cart.fulfillmentType ?? null;
  const paymentMethod = cart?.cart.paymentMethod ?? null;

  function addToCart(productId: string) {
    setError(null);
    startTransition(async () => {
      const result = await addProductToCartAction(slug, { productId, quantity: 1 }, surface);
      if (!result.ok) return setError(result.error);
      setCart(result.cart);
    });
  }

  function changeQuantity(productId: string, quantity: number) {
    setError(null);
    startTransition(async () => {
      const result = await updateCartItemQuantityAction(slug, { productId, quantity }, surface);
      if (!result.ok) return setError(result.error);
      setCart(result.cart);
    });
  }

  function chooseFulfillment(type: "pickup" | "delivery") {
    setError(null);
    startTransition(async () => {
      const result = await setFulfillmentTypeAction(slug, { fulfillmentType: type }, surface);
      if (!result.ok) return setError(result.error);
      setCart(result.cart);
    });
  }

  function choosePaymentMethod(method: PaymentMethod) {
    setError(null);
    startTransition(async () => {
      const result = await setPaymentMethodAction(slug, { paymentMethod: method }, surface);
      if (!result.ok) return setError(result.error);
      setCart(result.cart);
    });
  }

  function placeOrder() {
    setError(null);
    startTransition(async () => {
      const detailsResult = await setCustomerDetailsAction(slug, details, surface);
      if (!detailsResult.ok) return setError(detailsResult.error);
      const result = await placeStructuredOrderAction(slug, surface);
      if (!result.ok) return setError(result.error);
      setOrderResult(result);
      setCart(null);
    });
  }

  if (orderResult?.ok) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <p className="font-medium">
          Order #{orderResult.orderNumber} placed — total {formatMinor(orderResult.totalMinor, currencyExponent)} {orderResult.currency}.
        </p>
        {orderResult.checkoutUrl ? (
          <a href={orderResult.checkoutUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline">
            Pay now
          </a>
        ) : (
          <p className="mt-2 text-neutral-500">Order confirmed — you&apos;ll pay in person, as chosen.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCategoryId(c.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                selectedCategoryId === c.id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600"
              }`}
            >
              {localized(c.name, locale)}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {visibleProducts.map((product) => {
          const item = cart?.items.find((i) => i.productId === product.id);
          return (
            <div key={product.id} className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 text-sm">
              <p className="font-medium">{localized(product.name, locale)}</p>
              <p className="text-neutral-500">
                {formatMinor(product.priceMinor, currencyExponent)} {currency}
              </p>
              {item ? (
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => changeQuantity(product.id, item.quantity - 1)}
                    className="h-6 w-6 rounded-full border border-neutral-300 text-xs"
                  >
                    −
                  </button>
                  <span>{item.quantity}</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => changeQuantity(product.id, item.quantity + 1)}
                    className="h-6 w-6 rounded-full border border-neutral-300 text-xs"
                  >
                    +
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => addToCart(product.id)}
                  className="mt-1 rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Add
                </button>
              )}
            </div>
          );
        })}
        {visibleProducts.length === 0 && <p className="col-span-full text-sm text-neutral-400">No items here yet.</p>}
      </div>

      {cart && cart.items.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-neutral-100 pt-3 text-sm">
          <p className="font-medium">
            Subtotal: {formatMinor(cart.subtotalMinor, currencyExponent)} {currency}
          </p>

          {!checkingOut ? (
            <button
              type="button"
              onClick={() => setCheckingOut(true)}
              className="self-start rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white"
            >
              Checkout
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              {fulfillmentTypes.length > 1 && (
                <div className="flex gap-2">
                  {fulfillmentTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => chooseFulfillment(type)}
                      className={`rounded-full border px-3 py-1 text-xs capitalize ${
                        fulfillmentType === type ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              )}

              {paymentMethods.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {paymentMethods.map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => choosePaymentMethod(method)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        paymentMethod === method ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600"
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[method]}
                    </button>
                  ))}
                </div>
              )}

              <input
                placeholder="Name"
                value={details.name}
                onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Phone"
                value={details.phone}
                onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              {fulfillmentType === "delivery" && (
                <input
                  placeholder="Delivery address"
                  value={details.deliveryAddress}
                  onChange={(e) => setDetails((d) => ({ ...d, deliveryAddress: e.target.value }))}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              )}
              <button
                type="button"
                disabled={pending || !fulfillmentType || (paymentMethods.length > 0 && !paymentMethod)}
                onClick={placeOrder}
                className="self-start rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                Place order
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
