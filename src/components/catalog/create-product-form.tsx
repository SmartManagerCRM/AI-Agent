"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { createProductAction } from "@/server/catalog/actions";

type Category = { id: string; name: Record<string, string> };

type Props = {
  tenantId: string;
  slug: string;
  locale: string;
  categories: Category[];
  currencyExponent: number;
};

export function CreateProductForm({ tenantId, slug, locale, categories, currencyExponent }: Props) {
  const t = useTranslations("console.catalogForms");
  const [error, formAction, pending] = useActionState(createProductAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="currencyExponent" value={currencyExponent} />
      <label className="flex flex-col gap-1 text-sm">
        {t("name")}
        <input name="name" required maxLength={160} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("category")}
        <select name="categoryId" className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="">—</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name[locale] ?? Object.values(category.name)[0]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("price")}
        <input
          name="priceMajor"
          type="number"
          step={1 / 10 ** currencyExponent}
          min={0}
          required
          className="w-28 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("status")}
        <select name="status" className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="draft">{t("draft")}</option>
          <option value="active">{t("active")}</option>
        </select>
      </label>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending}>
        {t("addProduct")}
      </Button>
    </form>
  );
}
