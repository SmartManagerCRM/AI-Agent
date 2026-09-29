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

import type { AgentProduct, FulfillmentType } from "./agent-model";

type Surface = "external_agent" | "website_widget";

export type CustomerDetails = { name: string; phone: string; deliveryAddress: string };

/**
 * The Customer Agent's structured commerce state — the same deterministic
 * Server Actions (`src/server/agent-public/catalog-actions.ts`) the
 * previous CatalogPanel called, in the same order, with the same inputs.
 * The server stays the only authority on cart contents and totals: every
 * `cart` here is exactly what an action returned. No AI call happens here.
 */
export function useAgentCommerce({
  slug,
  surface,
  products,
  popularProductIds,
  activeTableId,
}: {
  slug: string;
  surface: Surface;
  products: AgentProduct[];
  popularProductIds: string[];
  activeTableId: string | null;
}) {
  const [cart, setCart] = useState<CartView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<Extract<PlaceStructuredOrderResult, { ok: true }> | null>(null);
  const [lastAdded, setLastAdded] = useState<{ product: AgentProduct; crossSell: AgentProduct | null; at: number } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  /** Same rule as before: the most popular product outside the just-added one's category that isn't already in the cart — only ever from real order history. */
  function pickCrossSell(justAdded: AgentProduct, cartAfter: CartView | null): AgentProduct | null {
    const inCart = new Set((cartAfter?.items ?? []).map((i) => i.productId));
    return (
      popularProductIds
        .map((id) => products.find((p) => p.id === id))
        .find((p): p is AgentProduct => !!p && p.categoryId !== justAdded.categoryId && !inCart.has(p.id)) ?? null
    );
  }

  function addToCart(product: AgentProduct, quantity = 1) {
    setError(null);
    startTransition(async () => {
      const result = await addProductToCartAction(slug, { productId: product.id, quantity }, surface);
      if (!result.ok) return setError(result.error);
      setCart(result.cart);
      setLastAdded({ product, crossSell: pickCrossSell(product, result.cart), at: Date.now() });
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

  function chooseFulfillment(type: FulfillmentType) {
    setError(null);
    startTransition(async () => {
      const result = await setFulfillmentTypeAction(
        slug,
        { fulfillmentType: type, tableId: type === "dine_in" ? (activeTableId ?? undefined) : undefined },
        surface,
      );
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

  function applyCoupon(code: string) {
    setError(null);
    startTransition(async () => {
      const result = await setCouponCodeAction(slug, { code }, surface);
      if (!result.ok) return setError(result.error);
      setCart(result.cart);
    });
  }

  function placeOrder(details: CustomerDetails, onPlaced?: () => void) {
    setError(null);
    startTransition(async () => {
      // Only fields the customer actually filled in are sent: the details
      // schema validates each field it receives, so an untouched empty
      // field must be omitted rather than sent as "".
      const filled = Object.fromEntries(
        Object.entries(details)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value !== ""),
      ) as Partial<CustomerDetails>;
      const detailsResult = await setCustomerDetailsAction(slug, filled, surface);
      if (!detailsResult.ok) return setError(detailsResult.error);
      const result = await placeStructuredOrderAction(slug, surface);
      if (!result.ok) return setError(result.error);
      setOrderResult(result);
      setCart(null);
      onPlaced?.();
    });
  }

  return {
    cart,
    /** A cart the AI's own tools changed this turn (`sendAgentMessageAction`'s `cart`) — the real server cart, so both surfaces stay one cart. */
    syncCart: (next: CartView | null) => setCart(next),
    error,
    clearError: () => setError(null),
    pending,
    orderResult,
    clearOrderResult: () => setOrderResult(null),
    lastAdded,
    dismissLastAdded: () => setLastAdded(null),
    addToCart,
    changeQuantity,
    chooseFulfillment,
    choosePaymentMethod,
    applyCoupon,
    placeOrder,
  };
}

export type AgentCommerce = ReturnType<typeof useAgentCommerce>;
