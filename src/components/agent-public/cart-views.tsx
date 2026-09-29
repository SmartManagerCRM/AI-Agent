"use client";

import { useState } from "react";
import { useAgentT } from "./agent-i18n";

import { formatMoney } from "@/lib/money";
import type { CartView, PaymentMethod } from "@/server/commerce/cart";

import type { AgentProduct, FulfillmentType } from "./agent-model";
import { focusRing, ProductVisual, QuantityStepper, useAgentUi } from "./agent-ui";
import { AgentAvatar } from "./agent-avatar";
import { ScreenHeader } from "./chrome";
import { BagIcon, CardIcon, CartIcon, CashIcon, CheckIcon, ChevronIcon, TableIcon, TagIcon, TruckIcon } from "./icons";

const FULFILLMENT_ICONS: Record<FulfillmentType, React.ReactNode> = {
  pickup: <BagIcon size={22} />,
  delivery: <TruckIcon size={22} />,
  dine_in: <TableIcon size={22} />,
};

const PAYMENT_ICONS: Record<PaymentMethod, React.ReactNode> = {
  moyasar: <CardIcon size={22} />,
  tap: <CardIcon size={22} />,
  cash_on_delivery: <CashIcon size={22} />,
  pay_on_table: <TableIcon size={22} />,
};

/** Localized catalog name for a cart line when the product is on the page, else the server's own line name. */
function useLineName() {
  const { products, text } = useAgentUi();
  return (productId: string, fallback: string) => {
    const product = products.find((p) => p.id === productId);
    return product ? text(product.name) : fallback;
  };
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-100">
      {message}
    </p>
  );
}

/** Subtotal and coupon exactly as the server's cart view reports them — no client-side total. */
function CartSummary({ cart }: { cart: CartView }) {
  const t = useAgentT();
  const { money } = useAgentUi();
  return (
    <dl className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between">
        <dt className="text-slate-600">{t("cart.subtotal")}</dt>
        <dd className="font-semibold text-slate-900 tabular-nums">{money(cart.subtotalMinor)}</dd>
      </div>
      {cart.coupon?.valid && (
        <div className="flex items-center justify-between text-agent-700">
          <dt>{t("cart.discount", { code: cart.cart.couponCode ?? "" })}</dt>
          <dd className="font-semibold tabular-nums">−{money(cart.coupon.discountMinor)}</dd>
        </div>
      )}
      <p className="text-xs leading-relaxed text-slate-500">{t("cart.finalNote")}</p>
    </dl>
  );
}

export function CartScreen() {
  const t = useAgentT();
  const { commerce, money, go, openChat, aiName, activeTable, businessName } = useAgentUi();
  const lineName = useLineName();
  const [coupon, setCoupon] = useState("");
  const cart = commerce.cart;
  const items = cart?.items ?? [];

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-[calc(100dvh-3rem)]">
      <ScreenHeader title={t("cart.title")} subtitle={items.length > 0 ? t("cart.itemsCount", { count: items.reduce((n, i) => n + i.quantity, 0) }) : businessName} />
      {items.length === 0 || !cart ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-agent-50 text-agent-700 ring-1 ring-agent-100">
            <CartIcon size={34} />
          </span>
          <div>
            <p className="text-lg font-bold text-slate-900">{t("cart.emptyTitle")}</p>
            <p className="mt-1 text-sm text-slate-500">{t("cart.emptyBody", { name: aiName })}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => go("browse")} className={`${focusRing} h-11 rounded-full bg-agent-700 px-5 text-sm font-semibold text-white hover:bg-agent-800`}>
              {t("cart.startBrowsing")}
            </button>
            <button type="button" onClick={() => openChat()} className={`${focusRing} h-11 rounded-full bg-white px-5 text-sm font-semibold text-agent-800 ring-1 ring-agent-200 hover:bg-agent-50`}>
              {t("ask.short", { name: aiName })}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
            {activeTable && (
              <p className="rounded-2xl bg-agent-50 px-4 py-2.5 text-center text-sm font-semibold text-agent-800 ring-1 ring-agent-100">
                🍽️ {t("home.table", { label: activeTable.label })}
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {items.map((item) => {
                const name = lineName(item.productId, item.name);
                return (
                  <li key={item.productId} className="motion-safe:animate-agent-rise flex gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-900/5">
                    <LineVisual productId={item.productId} />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-slate-900">{name}</p>
                          <p className="text-xs text-slate-500 tabular-nums">{t("cart.each", { price: money(item.unitPriceMinor) })}</p>
                        </div>
                        <p className="shrink-0 text-[15px] font-bold text-slate-900 tabular-nums">{money(item.totalMinor)}</p>
                      </div>
                      <QuantityStepper
                        size="sm"
                        allowRemove
                        quantity={item.quantity}
                        label={name}
                        disabled={commerce.pending}
                        onChange={(q) => commerce.changeQuantity(item.productId, q)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (coupon.trim()) commerce.applyCoupon(coupon);
              }}
              className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
            >
              <label htmlFor="agent-coupon" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <TagIcon size={17} className="text-agent-700" /> {t("cart.couponLabel")}
              </label>
              <div className="flex gap-2">
                <input
                  id="agent-coupon"
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value)}
                  placeholder={t("cart.couponPlaceholder")}
                  autoComplete="off"
                  className="h-11 min-w-0 flex-1 rounded-full bg-slate-50 px-4 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-agent-400"
                />
                <button
                  type="submit"
                  disabled={commerce.pending || !coupon.trim()}
                  className={`${focusRing} h-11 shrink-0 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-50`}
                >
                  {t("cart.apply")}
                </button>
              </div>
              {cart.coupon && !cart.coupon.valid && cart.coupon.message && <p className="text-xs font-medium text-red-600">{cart.coupon.message}</p>}
              {cart.coupon?.valid && <p className="text-xs font-medium text-agent-700">✓ {t("cart.couponApplied")}</p>}
            </form>

            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
              <CartSummary cart={cart} />
            </div>
            <ErrorNote message={commerce.error} />
          </div>
          <StickyCta>
            <button
              type="button"
              onClick={() => go("checkout")}
              className={`${focusRing} flex h-13 w-full items-center justify-center gap-2 rounded-full bg-agent-700 text-base font-bold text-white shadow-lg shadow-agent-900/25 transition hover:bg-agent-800 active:scale-[0.99]`}
            >
              {t("cart.checkout")}
              <ChevronIcon size={18} className="rtl:-scale-x-100" />
            </button>
          </StickyCta>
        </>
      )}
    </div>
  );
}

function LineVisual({ productId }: { productId: string }) {
  const { products } = useAgentUi();
  const product = products.find((p) => p.id === productId);
  if (!product) return <span className="h-16 w-16 shrink-0 rounded-xl bg-slate-100" aria-hidden="true" />;
  return <ProductVisual product={product as AgentProduct} className="h-16 w-16 shrink-0 rounded-xl" iconClassName="text-3xl" />;
}

function StickyCta({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 border-t border-slate-900/5 bg-white/92 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:px-6 lg:rounded-b-[2rem]">
      {children}
    </div>
  );
}

function StepCard({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5" aria-labelledby={`agent-step-${step}`}>
      <h2 id={`agent-step-${step}`} className="mb-3 flex items-center gap-2.5 text-[15px] font-bold text-slate-900">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-agent-800 text-xs font-bold text-white" aria-hidden="true">
          {step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  sub,
  disabled,
  name,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  sub?: string;
  disabled?: boolean;
  name: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-2xl p-3 ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-agent-400 ${
        selected ? "bg-agent-50 ring-agent-500" : "bg-white ring-slate-200 hover:bg-slate-50"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <input type="radio" name={name} checked={selected} onChange={onSelect} disabled={disabled} className="sr-only" />
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-agent-700 text-white" : "bg-slate-100 text-slate-600"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        {sub && <span className="block text-xs text-slate-500">{sub}</span>}
      </span>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-2 ${selected ? "bg-agent-600 text-white ring-agent-600" : "ring-slate-300"}`}
        aria-hidden="true"
      >
        {selected && <CheckIcon size={12} strokeWidth={3} />}
      </span>
    </label>
  );
}

export function CheckoutScreen() {
  const t = useAgentT();
  const { commerce, fulfillmentTypes, paymentMethods, activeTable, info, money } = useAgentUi();
  const lineName = useLineName();
  const [details, setDetails] = useState({ name: "", phone: "", deliveryAddress: "" });
  const cart = commerce.cart;
  const fulfillmentType = cart?.cart.fulfillmentType ?? null;
  const paymentMethod = cart?.cart.paymentMethod ?? null;
  const canPlace = !commerce.pending && !!fulfillmentType && (paymentMethods.length === 0 || !!paymentMethod);

  if (!cart || cart.items.length === 0) return <CartScreen />;

  const fulfillmentSub: Record<FulfillmentType, string> = {
    pickup: info.branchName ? t("checkout.pickupFrom", { branch: info.branchName }) : t("checkout.pickupSub"),
    delivery: t("checkout.deliverySub"),
    dine_in: activeTable ? t("home.table", { label: activeTable.label }) : t("checkout.dineInSub"),
  };
  // Dine-in is only accepted with a real table from a scanned QR link (the server re-validates it), so it's
  // offered only when this page was opened from one.
  const offeredFulfillment = fulfillmentTypes.filter((type) => type !== "dine_in" || !!activeTable);
  let step = 0;

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-[calc(100dvh-3rem)]">
      <ScreenHeader title={t("checkout.title")} />
      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (canPlace) commerce.placeOrder(details);
        }}
      >
        <div className="flex flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
          <StepCard step={++step} title={t("checkout.howTitle")}>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("checkout.howTitle")}>
              {offeredFulfillment.map((type) => (
                <OptionCard
                  key={type}
                  name="agent-fulfillment"
                  selected={fulfillmentType === type}
                  onSelect={() => commerce.chooseFulfillment(type)}
                  disabled={commerce.pending}
                  icon={FULFILLMENT_ICONS[type]}
                  title={t(`checkout.fulfillment.${type}`)}
                  sub={fulfillmentSub[type]}
                />
              ))}
            </div>
          </StepCard>

          <StepCard step={++step} title={t("checkout.detailsTitle")}>
            <div className="flex flex-col gap-3">
              <Field id="agent-name" label={t("checkout.name")} autoComplete="name" value={details.name} onChange={(v) => setDetails((d) => ({ ...d, name: v }))} />
              <Field id="agent-phone" label={t("checkout.phone")} type="tel" autoComplete="tel" dir="ltr" value={details.phone} onChange={(v) => setDetails((d) => ({ ...d, phone: v }))} />
              {fulfillmentType === "delivery" && (
                <Field
                  id="agent-address"
                  label={t("checkout.address")}
                  autoComplete="street-address"
                  multiline
                  value={details.deliveryAddress}
                  onChange={(v) => setDetails((d) => ({ ...d, deliveryAddress: v }))}
                />
              )}
            </div>
          </StepCard>

          {paymentMethods.length > 0 && (
            <StepCard step={++step} title={t("checkout.paymentTitle")}>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("checkout.paymentTitle")}>
                {paymentMethods.map((method) => (
                  <OptionCard
                    key={method}
                    name="agent-payment"
                    selected={paymentMethod === method}
                    onSelect={() => commerce.choosePaymentMethod(method)}
                    disabled={commerce.pending}
                    icon={PAYMENT_ICONS[method]}
                    title={t(`checkout.payment.${method}`)}
                    sub={t(`checkout.paymentSub.${method}`)}
                  />
                ))}
              </div>
            </StepCard>
          )}

          <StepCard step={++step} title={t("checkout.summaryTitle")}>
            <ul className="mb-3 flex flex-col gap-2 border-b border-slate-100 pb-3 text-sm">
              {cart.items.map((item) => (
                <li key={item.productId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-slate-700">
                    <span className="font-semibold text-slate-900 tabular-nums">{item.quantity}×</span> {lineName(item.productId, item.name)}
                  </span>
                  <span className="shrink-0 font-medium text-slate-900 tabular-nums">{money(item.totalMinor)}</span>
                </li>
              ))}
            </ul>
            <CartSummary cart={cart} />
          </StepCard>
          <ErrorNote message={commerce.error} />
        </div>
        <StickyCta>
          <button
            type="submit"
            disabled={!canPlace}
            className={`${focusRing} flex h-13 w-full items-center justify-center gap-2 rounded-full bg-agent-700 text-base font-bold text-white shadow-lg shadow-agent-900/25 transition hover:bg-agent-800 active:scale-[0.99] disabled:bg-slate-300 disabled:shadow-none`}
          >
            {commerce.pending ? t("checkout.placing") : t("checkout.placeOrder")}
          </button>
          {!fulfillmentType && <p className="mt-2 text-center text-xs text-slate-500">{t("checkout.chooseHow")}</p>}
          {fulfillmentType && paymentMethods.length > 0 && !paymentMethod && <p className="mt-2 text-center text-xs text-slate-500">{t("checkout.choosePayment")}</p>}
        </StickyCta>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  multiline,
  dir,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  multiline?: boolean;
  dir?: "ltr";
}) {
  const cls = "w-full rounded-2xl bg-slate-50 px-4 py-3 text-[15px] text-slate-900 ring-1 ring-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-agent-400";
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-slate-600">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} rows={2} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} className={cls} />
      ) : (
        <input id={id} type={type} dir={dir} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} className={`${cls} ${dir ? "text-start" : ""}`} />
      )}
    </div>
  );
}

export function ConfirmationScreen() {
  const t = useAgentT();
  const { commerce, businessName, aiName, go, openChat } = useAgentUi();
  const order = commerce.orderResult;
  if (!order) return null;

  return (
    <div className="flex min-h-dvh flex-col items-center gap-6 px-5 pt-12 pb-10 text-center sm:px-8 lg:min-h-[calc(100dvh-3rem)]">
      <div className="relative">
        <span className="motion-safe:animate-agent-pop flex h-24 w-24 items-center justify-center rounded-full bg-agent-500 text-white shadow-xl shadow-agent-500/40">
          <CheckIcon size={48} strokeWidth={2.6} />
        </span>
        <span className="absolute -inset-3 -z-10 rounded-full bg-agent-100 motion-safe:animate-ping [animation-iteration-count:1]" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{t("done.title")}</h1>
        <p className="mt-1.5 text-sm text-slate-500">{t("done.thanks", { name: businessName })}</p>
      </div>
      <OrderFacts />
      <div className="flex w-full max-w-sm flex-col gap-2.5">
        {order.checkoutUrl ? (
          <a
            href={order.checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${focusRing} flex h-13 items-center justify-center gap-2 rounded-full bg-agent-700 text-base font-bold text-white shadow-lg shadow-agent-900/25 hover:bg-agent-800`}
          >
            <CardIcon size={20} /> {t("done.payNow")}
          </a>
        ) : (
          <p className="rounded-2xl bg-agent-50 px-4 py-3 text-sm font-medium text-agent-800 ring-1 ring-agent-100">{t("done.payInPerson")}</p>
        )}
        <button
          type="button"
          onClick={() => openChat(t("prompts.trackOrder", { number: order.orderNumber }))}
          className={`${focusRing} flex h-12 items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-agent-800 ring-1 ring-agent-200 hover:bg-agent-50`}
        >
          <TruckIcon size={19} /> {t("done.track")}
        </button>
        <button
          type="button"
          onClick={() => {
            commerce.clearOrderResult();
            go("home");
          }}
          className={`${focusRing} h-12 rounded-full text-[15px] font-semibold text-slate-600 hover:bg-slate-100`}
        >
          {t("done.continue")}
        </button>
      </div>
      <div className="flex w-full max-w-sm items-center gap-3 rounded-3xl bg-white p-3 text-start shadow-sm ring-1 ring-slate-900/5">
        <AgentAvatar size={44} online />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{t("done.followUp")}</p>
          <p className="text-xs text-slate-500">{t("done.followUpSub", { name: aiName })}</p>
        </div>
        <button type="button" onClick={() => openChat()} className={`${focusRing} h-10 shrink-0 rounded-full bg-agent-700 px-4 text-xs font-semibold text-white hover:bg-agent-800`}>
          {t("done.chat")}
        </button>
      </div>
    </div>
  );
}

function OrderFacts() {
  const t = useAgentT();
  const { commerce, currencyExponent, locale } = useAgentUi();
  const order = commerce.orderResult;
  if (!order) return null;
  // Amounts and currency exactly as the server returned them for this order.
  const show = (minor: number) => formatMoney(minor, order.currency.trim(), currencyExponent, locale);
  return (
    <dl className="grid w-full max-w-sm grid-cols-2 gap-px overflow-hidden rounded-2xl bg-slate-200/70 text-start ring-1 ring-slate-200/70">
      <div className="bg-white p-4">
        <dt className="text-xs text-slate-500">{t("done.orderNumber")}</dt>
        <dd className="mt-0.5 text-lg font-extrabold text-slate-900 tabular-nums">#{order.orderNumber}</dd>
      </div>
      <div className="bg-white p-4">
        <dt className="text-xs text-slate-500">{t("done.total")}</dt>
        <dd className="mt-0.5 text-lg font-extrabold text-slate-900 tabular-nums">{show(order.totalMinor)}</dd>
      </div>
      {order.discountMinor > 0 && (
        <div className="col-span-2 bg-white p-4">
          <dt className="text-xs text-slate-500">{t("done.saved")}</dt>
          <dd className="mt-0.5 text-sm font-bold text-agent-700 tabular-nums">{show(order.discountMinor)}</dd>
        </div>
      )}
    </dl>
  );
}
