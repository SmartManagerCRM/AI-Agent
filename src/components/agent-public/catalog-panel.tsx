"use client";

import { useState, useTransition } from "react";

import {
  addProductToCartAction,
  placeStructuredOrderAction,
  setCouponCodeAction,
  setCustomerDetailsAction,
  setFulfillmentTypeAction,
  setPaymentMethodAction,
  updateCartItemQuantityAction,
  type PlaceStructuredOrderResult,
} from "@/server/agent-public/catalog-actions";
import type { CartView, PaymentMethod } from "@/server/commerce/cart";
import { AgentAvatar } from "./agent-avatar";

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
  businessName: string;
  categories: Category[];
  products: Product[];
  /** Product ids ordered by real recent order volume, most popular first — empty if this business has no order history yet. */
  popularProductIds: string[];
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

const TILE_COLORS = [
  "bg-emerald-50 text-emerald-700",
  "bg-blue-50 text-blue-700",
  "bg-amber-50 text-amber-700",
  "bg-violet-50 text-violet-700",
  "bg-rose-50 text-rose-700",
];
function tileColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TILE_COLORS[hash % TILE_COLORS.length];
}

/**
 * Deterministic, structured-UI commerce browser — no LLM call anywhere in
 * this component. Category selection is pure client-side state (the full
 * catalog is fetched once, server-side, by the page); every cart/checkout
 * action calls a dedicated Server Action
 * (`src/server/agent-public/catalog-actions.ts`) that never touches
 * `runAgentGateway`. The free-text `ChatPanel` alongside this one is the
 * only door to the AI, for whatever genuinely needs it.
 *
 * Product cards have no photo — no real image field exists for products
 * yet, and this project doesn't fabricate stock photography — just a
 * deterministic colored monogram tile per product. "Popular" only ever
 * appears for a product with real recent order volume (spec §9/§20 "do
 * not invent badges").
 */
export function CatalogPanel({
  slug,
  locale,
  businessName,
  categories,
  products,
  popularProductIds,
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
  const [couponInput, setCouponInput] = useState("");
  const [crossSell, setCrossSell] = useState<Product | null>(null);
  const [pending, startTransition] = useTransition();

  if (!orderingEnabled) return null;

  const popularSet = new Set(popularProductIds);
  const visibleProducts = selectedCategoryId ? products.filter((p) => p.categoryId === selectedCategoryId) : products;
  const fulfillmentType = cart?.cart.fulfillmentType ?? null;
  const paymentMethod = cart?.cart.paymentMethod ?? null;

  function suggestCrossSell(justAdded: Product, cartAfter: CartView | null) {
    const inCart = new Set((cartAfter?.items ?? []).map((i) => i.productId));
    const suggestion = popularProductIds
      .map((id) => products.find((p) => p.id === id))
      .find((p): p is Product => !!p && p.categoryId !== justAdded.categoryId && !inCart.has(p.id));
    setCrossSell(suggestion ?? null);
  }

  function addToCart(product: Product) {
    setError(null);
    startTransition(async () => {
      const result = await addProductToCartAction(slug, { productId: product.id, quantity: 1 }, surface);
      if (!result.ok) return setError(result.error);
      setCart(result.cart);
      suggestCrossSell(product, result.cart);
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

  function applyCoupon() {
    setError(null);
    startTransition(async () => {
      const result = await setCouponCodeAction(slug, { code: couponInput }, surface);
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
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm">
        <p className="font-semibold text-emerald-900">
          Order #{orderResult.orderNumber} placed — total {formatMinor(orderResult.totalMinor, currencyExponent)}{" "}
          {orderResult.currency}
          {orderResult.discountMinor > 0 &&
            ` (saved ${formatMinor(orderResult.discountMinor, currencyExponent)} ${orderResult.currency})`}
          .
        </p>
        {orderResult.checkoutUrl ? (
          <a
            href={orderResult.checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block rounded-full bg-emerald-700 px-4 py-2 text-xs font-medium text-white"
          >
            Pay now
          </a>
        ) : (
          <p className="mt-2 text-emerald-800">Order confirmed — you&apos;ll pay in person, as chosen.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCategoryId(c.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedCategoryId === c.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
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
          const name = localized(product.name, locale);
          return (
            <div key={product.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 text-sm">
              <div
                className={`flex h-16 w-full items-center justify-center rounded-lg text-lg font-semibold ${tileColor(name)}`}
              >
                {name.charAt(0).toUpperCase() || "•"}
              </div>
              <div className="flex items-start justify-between gap-1">
                <p className="font-medium text-slate-900">{name}</p>
                {popularSet.has(product.id) && (
                  <span className="shrink-0 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                    Popular
                  </span>
                )}
              </div>
              <p className="text-slate-500">
                {formatMinor(product.priceMinor, currencyExponent)} {currency}
              </p>
              {item ? (
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => changeQuantity(product.id, item.quantity - 1)}
                    className="h-7 w-7 rounded-full border border-slate-300 text-sm"
                  >
                    −
                  </button>
                  <span className="font-medium">{item.quantity}</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => changeQuantity(product.id, item.quantity + 1)}
                    className="h-7 w-7 rounded-full border border-slate-300 text-sm"
                  >
                    +
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => addToCart(product)}
                  className="mt-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  Add
                </button>
              )}
            </div>
          );
        })}
        {visibleProducts.length === 0 && <p className="col-span-full text-sm text-slate-400">No items here yet.</p>}
      </div>

      {crossSell && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <AgentAvatar businessName={businessName} size={24} />
          <p className="flex-1 text-xs text-slate-600">
            Pairs well with your order:{" "}
            <span className="font-medium text-slate-900">{localized(crossSell.name, locale)}</span>
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const product = crossSell;
              setCrossSell(null);
              if (product) addToCart(product);
            }}
            className="shrink-0 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {cart && cart.items.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 text-sm">
          <p className="font-medium">
            Subtotal: {formatMinor(cart.subtotalMinor, currencyExponent)} {currency}
          </p>
          {cart.coupon?.valid && (
            <p className="text-emerald-700">
              Coupon applied: −{formatMinor(cart.coupon.discountMinor, currencyExponent)} {currency}
            </p>
          )}
          {cart.coupon && !cart.coupon.valid && <p className="text-red-600">{cart.coupon.message}</p>}

          {!checkingOut ? (
            <button
              type="button"
              onClick={() => setCheckingOut(true)}
              className="self-start rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white"
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
                        fulfillmentType === type
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 text-slate-600"
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
                        paymentMethod === method
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[method]}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  placeholder="Coupon code"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  className="rounded-full border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={pending || !couponInput.trim()}
                  onClick={applyCoupon}
                  className="rounded-full border border-slate-300 px-3 py-2 text-xs font-medium disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
              <input
                placeholder="Name"
                value={details.name}
                onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))}
                className="rounded-full border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Phone"
                value={details.phone}
                onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))}
                className="rounded-full border border-slate-300 px-3 py-2 text-sm"
              />
              {fulfillmentType === "delivery" && (
                <input
                  placeholder="Delivery address"
                  value={details.deliveryAddress}
                  onChange={(e) => setDetails((d) => ({ ...d, deliveryAddress: e.target.value }))}
                  className="rounded-full border border-slate-300 px-3 py-2 text-sm"
                />
              )}
              <button
                type="button"
                disabled={pending || !fulfillmentType || (paymentMethods.length > 0 && !paymentMethod)}
                onClick={placeOrder}
                className="self-start rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
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
