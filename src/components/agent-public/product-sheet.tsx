"use client";

import { useEffect, useRef, useState } from "react";
import { useAgentT } from "./agent-i18n";

import type { AgentProduct } from "./agent-model";
import { focusRing, PopularBadge, ProductCard, ProductVisual, QuantityStepper, useAgentUi } from "./agent-ui";
import { CartIcon, CloseIcon } from "./icons";

/**
 * Product detail as an accessible dialog (bottom sheet on mobile, centered
 * panel on desktop). Shows only fields the catalog really has; "Pairs well
 * with" uses the exact cross-sell rule the Agent already had (most popular
 * product from another category, from real order history), and "More
 * from" is simply the rest of the same category.
 */
export function ProductSheet({ product, onClose }: { product: AgentProduct; onClose: () => void }) {
  const t = useAgentT();
  const { text, money, commerce, categories, products, popularIds, orderingEnabled } = useAgentUi();
  const [quantity, setQuantity] = useState(1);
  const closeRef = useRef<HTMLButtonElement>(null);
  const name = text(product.name);
  const description = text(product.description);
  const category = categories.find((c) => c.id === product.categoryId) ?? null;
  const inCart = commerce.cart?.items.find((i) => i.productId === product.id);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const inCartIds = new Set((commerce.cart?.items ?? []).map((i) => i.productId));
  const pairsWell = orderingEnabled
    ? (popularIds
        .map((id) => products.find((p) => p.id === id))
        .find((p): p is AgentProduct => !!p && p.categoryId !== product.categoryId && !inCartIds.has(p.id) && p.id !== product.id) ?? null)
    : null;
  const moreFrom = products.filter((p) => p.categoryId === product.categoryId && p.id !== product.id).slice(0, 8);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <button type="button" aria-label={t("common.close")} tabIndex={-1} onClick={onClose} className="motion-safe:animate-agent-fade absolute inset-0 bg-agent-950/55 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-product-title"
        className="motion-safe:animate-agent-sheet relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]"
      >
        <div className="relative">
          <ProductVisual product={product} className="h-56 w-full sm:h-64" iconClassName="text-8xl" />
          <span className="absolute inset-x-0 top-2 mx-auto h-1.5 w-12 rounded-full bg-slate-900/15 sm:hidden" aria-hidden="true" />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className={`${focusRing} absolute end-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-md backdrop-blur hover:bg-white`}
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 pt-5 pb-4">
          <div className="flex flex-col gap-1.5">
            {category && <p className="text-xs font-semibold tracking-wide text-agent-700 uppercase">{text(category.name)}</p>}
            <h2 id="agent-product-title" className="text-2xl leading-tight font-extrabold tracking-tight text-slate-900">
              {name}
            </h2>
            {popularIds.includes(product.id) && (
              <div>
                <PopularBadge />
              </div>
            )}
            <p className="text-2xl font-bold text-agent-800 tabular-nums">{money(product.priceMinor)}</p>
          </div>
          {description && <p className="text-[15px] leading-relaxed text-slate-600">{description}</p>}

          {pairsWell && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-slate-900">{"✨\uFE0F"} {t("product.pairsWell")}</h3>
              <div className="flex gap-3">
                <ProductCard product={pairsWell} variant="chat" />
              </div>
            </section>
          )}
          {moreFrom.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold text-slate-900">{t("product.moreFrom", { category: category ? text(category.name) : t("browse.all") })}</h3>
              <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {moreFrom.map((p) => (
                  <ProductCard key={p.id} product={p} variant="chat" />
                ))}
              </div>
            </section>
          )}
        </div>

        {orderingEnabled && (
          <div className="flex items-center gap-3 border-t border-slate-100 bg-white px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {inCart ? (
              <>
                <div className="flex-1">
                  <p className="text-xs text-slate-500">{t("product.inCart")}</p>
                  <p className="text-sm font-semibold text-slate-900">{t("product.inCartCount", { count: inCart.quantity })}</p>
                </div>
                <QuantityStepper
                  allowRemove
                  quantity={inCart.quantity}
                  label={name}
                  disabled={commerce.pending}
                  onChange={(q) => commerce.changeQuantity(product.id, q)}
                />
              </>
            ) : (
              <>
                <QuantityStepper quantity={quantity} label={name} onChange={(q) => setQuantity(Math.max(1, Math.min(99, q)))} />
                <button
                  type="button"
                  disabled={commerce.pending}
                  onClick={() => {
                    commerce.addToCart(product, quantity);
                    onClose();
                  }}
                  className={`${focusRing} flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-agent-700 text-[15px] font-bold text-white shadow-lg shadow-agent-900/20 transition hover:bg-agent-800 active:scale-[0.98] disabled:opacity-60`}
                >
                  <CartIcon size={19} />
                  {t("product.addToCart")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
