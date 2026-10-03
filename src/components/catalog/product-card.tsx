"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { statusLabel } from "@/lib/i18n-labels";

import { ActionIconForm, IconButton } from "@/components/catalog/item-controls";
import { Button } from "@/components/console/button";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { AutoTranslatedChip } from "@/components/i18n/auto-translated";
import {
  deleteProductAction,
  setProductStatusAction,
  updateProductAction,
  type ProductEditState,
} from "@/server/catalog/actions";

export type ProductCardData = {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  priceLabel: string;
  status: "draft" | "active" | "suspended" | "archived";
  source: "manual" | "brain" | "file_import";
  sourcePrice: { amount: string | null; currency: string | null } | null;
  categoryId: string | null;
  /** Public URL of the stored photo, null when the product has none. */
  imageUrl: string | null;
  /** The name shown was translated automatically (not typed by anyone). */
  autoTranslated?: boolean;
};

const STATUS_STYLE: Record<ProductCardData["status"], string> = {
  active: "bg-emerald-50 text-emerald-700",
  draft: "bg-slate-100 text-slate-500",
  suspended: "bg-amber-50 text-amber-700",
  archived: "bg-slate-100 text-slate-400",
};

/** One product on Products & Services: details, and edit / suspend (or activate) / delete. */
export function ProductCard({
  product,
  categories,
  exponent,
  locale,
  slug,
}: {
  product: ProductCardData;
  categories: { id: string; label: string }[];
  exponent: number;
  locale: string;
  slug: string;
}) {
  const t = useTranslations("console.productCard");
  const tCommon = useTranslations("common");
  const tAll = useTranslations();
  const needsPrice = product.sourcePrice !== null;
  const [state, formAction, pending] = useActionState(updateProductAction, undefined);
  // Open with the result current at that moment; a newer successful save closes the form.
  const [opened, setOpened] = useState<{ at: ProductEditState } | null>(null);
  const editing = opened !== null && !(state?.ok && state !== opened.at);

  const fields = { productId: product.id, locale, slug };
  const onSale = product.status === "active";
  const found = product.sourcePrice
    ? [product.sourcePrice.currency, product.sourcePrice.amount].filter(Boolean).join(" ")
    : null;

  return (
    <li className="flex flex-col rounded-lg border border-slate-200 p-3" data-testid="product-card">
      <div className="mb-2 flex h-32 items-center justify-center overflow-hidden rounded-md bg-slate-50 text-slate-300">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- our own storage bucket; already resized to ≤ 1000 px WebP
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
            data-testid="product-photo"
          />
        ) : (
          <Icon path={NAV_ICON_PATHS.products} size={28} />
        )}
      </div>

      {editing ? (
        <form action={formAction} className="flex flex-col gap-2 text-sm" data-testid="product-edit-form">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slug" value={slug} />
          <label className="flex flex-col gap-1">
            {t("name")}
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={product.name}
              className="rounded-md border border-neutral-300 px-2 py-1.5"
            />
            {product.autoTranslated && <span className="text-xs text-sky-700">{tCommon("autoTranslatedHint")}</span>}
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              {t("price")}
              <input
                name="priceMajor"
                type="number"
                required
                min={0}
                step={1 / 10 ** exponent}
                defaultValue={needsPrice ? "" : (product.priceMinor / 10 ** exponent).toFixed(exponent)}
                placeholder={found ? t("found", { price: found }) : undefined}
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              {t("category")}
              <select
                name="categoryId"
                defaultValue={product.categoryId ?? ""}
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5"
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            {t("description")}
            <textarea
              name="description"
              rows={2}
              maxLength={2000}
              defaultValue={product.description}
              className="rounded-md border border-neutral-300 px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            {product.imageUrl ? t("replacePhoto") : t("photo")}
            <input
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="max-w-full text-xs"
            />
          </label>
          {product.imageUrl && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" name="removePhoto" /> {t("removePhoto")}
            </label>
          )}
          {state && !state.ok && <p className="text-xs text-red-600">{state.message}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} className="px-3 py-1.5">
              {pending ? tCommon("saving") : tCommon("save")}
            </Button>
            <Button type="button" variant="secondary" className="px-3 py-1.5" onClick={() => setOpened(null)}>
              {tCommon("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="font-medium text-slate-900">
            {product.name}
            {product.autoTranslated && <AutoTranslatedChip label={tCommon("autoTranslated")} hint={tCommon("autoTranslatedHint")} />}
          </p>
          {product.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{product.description}</p>}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
            {needsPrice ? (
              <span className="text-xs font-medium text-amber-700" data-testid="needs-price">
                {t("priceNeeded")}{found ? t("listedAs", { price: found }) : ""}
              </span>
            ) : (
              <span className="text-slate-500">{product.priceLabel}</span>
            )}
            <span className="flex items-center gap-1.5">
              {product.source !== "manual" && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                  {product.source === "brain" ? t("fromBrain") : t("imported")}
                </span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[product.status]}`}>
                {statusLabel(tAll, product.status)}
              </span>
            </span>
          </div>
        </>
      )}

      {!editing && (
        <div className="mt-auto flex items-center justify-end gap-1 border-t border-slate-100 pt-2" data-testid="product-actions">
          <IconButton
            icon="edit"
            label={needsPrice ? t("editSetPrice") : tCommon("edit")}
            tone={needsPrice ? "amber" : "slate"}
            onClick={() => setOpened({ at: state })}
          />
          {onSale ? (
            <ActionIconForm action={setProductStatusAction} fields={{ ...fields, status: "suspended" }}>
              <IconButton type="submit" icon="pause" label={t("suspend")} tone="amber" />
            </ActionIconForm>
          ) : (
            <ActionIconForm action={setProductStatusAction} fields={{ ...fields, status: "active" }}>
              <IconButton
                type="submit"
                icon="play"
                label={
                  needsPrice
                    ? t("setPriceFirst")
                    : product.status === "suspended"
                      ? t("resume")
                      : t("activate")
                }
                tone="emerald"
                disabled={needsPrice}
              />
            </ActionIconForm>
          )}
          <ActionIconForm
            action={deleteProductAction}
            fields={fields}
            confirm={t("deleteConfirm", { name: product.name })}
          >
            <IconButton type="submit" icon="trash" label={tCommon("delete")} tone="red" />
          </ActionIconForm>
        </div>
      )}
    </li>
  );
}
