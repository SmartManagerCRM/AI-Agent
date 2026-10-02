"use client";

import { useActionState, useMemo, useState } from "react";

import { Button } from "@/components/console/button";
import { bulkOrderTemplate } from "@/lib/orders/bulk-orders";
import { formatMoney } from "@/lib/money";
import {
  bulkCreateOrdersAction,
  createManualOrderAction,
  type ManualOrderState,
} from "@/server/commerce/manual-order-actions";

type Product = { id: string; name: string; priceMinor: number; draft: boolean };

type Props = {
  slug: string;
  locale: string;
  currency: string;
  exponent: number;
  products: Product[];
};

const input = "rounded-md border border-neutral-300 px-3 py-2 text-sm";
const label = "flex flex-col gap-1 text-xs font-medium text-slate-600";

/** "Add order" / "Bulk add orders" on the Orders page. */
export function ManualOrders(props: Props) {
  const [open, setOpen] = useState<"single" | "bulk" | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => setOpen(open === "single" ? null : "single")}
          aria-expanded={open === "single"}
        >
          + Add order
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpen(open === "bulk" ? null : "bulk")}
          aria-expanded={open === "bulk"}
        >
          Bulk add orders
        </Button>
      </div>
      {open === "single" && <SingleOrderForm {...props} onDone={() => setOpen(null)} />}
      {open === "bulk" && <BulkOrderForm {...props} />}
    </div>
  );
}

function Result({ state }: { state: ManualOrderState }) {
  if (!state) return null;
  return (
    <div
      className={`rounded-md px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
      role="status"
    >
      <p>{state.message}</p>
      {state.errors && (
        <ul className="mt-1 list-disc ps-5 text-xs">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SingleOrderForm({ slug, locale, currency, exponent, products, onDone }: Props & { onDone: () => void }) {
  const [lines, setLines] = useState<{ productId: string; quantity: number }[]>([{ productId: "", quantity: 1 }]);
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery" | "dine_in">("pickup");
  const [state, formAction, pending] = useActionState(async (prev: ManualOrderState, formData: FormData) => {
    const next = await createManualOrderAction(prev, formData);
    if (next?.ok) {
      setLines([{ productId: "", quantity: 1 }]);
      setFulfillment("pickup");
    }
    return next;
  }, undefined);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const items = lines.filter((l) => l.productId).map((l) => ({ product_id: l.productId, quantity: l.quantity }));
  const subtotal = items.reduce((sum, i) => sum + (byId.get(i.product_id)?.priceMinor ?? 0) * i.quantity, 0);

  if (products.length === 0) {
    return <p className="text-sm text-slate-600">Add products first — orders are made from your catalog.</p>;
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
      data-testid="manual-order-form"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-slate-900">Products</p>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className={`${label} min-w-0 flex-1`}>
              Product
              <select
                aria-label={`Product ${i + 1}`}
                value={line.productId}
                onChange={(e) =>
                  setLines((ls) => ls.map((l, j) => (j === i ? { ...l, productId: e.target.value } : l)))
                }
                className={`${input} w-full`}
              >
                <option value="">Choose a product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatMoney(p.priceMinor, currency, exponent, locale)}
                    {p.draft ? " (draft)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Qty
              <input
                aria-label={`Quantity ${i + 1}`}
                type="number"
                min={1}
                max={999}
                value={line.quantity}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((l, j) =>
                      j === i ? { ...l, quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) } : l,
                    ),
                  )
                }
                className={`${input} w-20`}
              />
            </label>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                className="mb-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                aria-label={`Remove line ${i + 1}`}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { productId: "", quantity: 1 }])}
          className="self-start text-xs font-medium text-emerald-700 hover:underline"
        >
          + Add another product
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={label}>
          Fulfillment
          <select
            name="fulfillment_type"
            value={fulfillment}
            onChange={(e) => setFulfillment(e.target.value as typeof fulfillment)}
            className={input}
          >
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
            <option value="dine_in">Dine in</option>
          </select>
        </label>
        <label className={label}>
          Customer name
          <input name="customer_name" maxLength={120} className={input} />
        </label>
        <label className={label}>
          Phone
          <input name="customer_phone" maxLength={40} className={input} />
        </label>
        <label className={label}>
          Notes
          <input name="notes" maxLength={1000} className={input} />
        </label>
        {fulfillment === "delivery" && (
          <label className={`${label} sm:col-span-2`}>
            Delivery address
            <input name="delivery_address" required maxLength={500} className={input} />
          </label>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="paid" className="h-4 w-4" /> Payment already collected
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || items.length === 0}>
          {pending ? "Adding…" : "Add order"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Close
        </Button>
        <span className="text-sm text-slate-600">
          Subtotal {formatMoney(subtotal, currency, exponent, locale)}
          <span className="text-xs text-slate-400"> · delivery fee and tax are added as at checkout</span>
        </span>
      </div>
      <Result state={state} />
    </form>
  );
}

function BulkOrderForm({ slug, locale, products }: Props) {
  const [state, formAction, pending] = useActionState(bulkCreateOrdersAction, undefined);
  const template = bulkOrderTemplate(products.filter((p) => !p.draft).map((p) => p.name));
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
      data-testid="bulk-order-form"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <p className="text-sm text-slate-700">
        Upload a CSV (save from Excel or Google Sheets as <em>CSV</em>) or paste rows below — one row per order line;
        rows with the same <code>order_ref</code> become one order. Products are matched by name. Nothing is added if
        any row has a problem.
      </p>
      <a
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
        download="orders-template.csv"
        className="self-start text-xs font-medium text-emerald-700 hover:underline"
      >
        Download a template with your products
      </a>
      <label className={label}>
        CSV file
        <input type="file" name="file" accept=".csv,text/csv,text/plain" className="text-sm" />
      </label>
      <label className={label}>
        …or paste rows
        <textarea name="csv" rows={5} placeholder={template} className={`${input} font-mono text-xs`} />
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding orders…" : "Add orders"}
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}
