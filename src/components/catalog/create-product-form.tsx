"use client";

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
  const [error, formAction, pending] = useActionState(createProductAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="currencyExponent" value={currencyExponent} />
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input name="name" required maxLength={160} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Category
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
        Price
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
        Status
        <select name="status" className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="draft">Draft</option>
          <option value="active">Active</option>
        </select>
      </label>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending}>
        Add product
      </Button>
    </form>
  );
}
