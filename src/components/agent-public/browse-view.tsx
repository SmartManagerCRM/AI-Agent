"use client";

import { useAgentT } from "./agent-i18n";

import { categoryIcon } from "./agent-model";
import { focusRing, ProductCard, useAgentUi } from "./agent-ui";
import { ScreenHeader } from "./chrome";

/** Deterministic catalog browsing — plain client-side filtering of the catalog the page already loaded; no AI call. */
export function BrowseView({ categoryId, onCategory }: { categoryId: string | null; onCategory: (id: string | null) => void }) {
  const t = useAgentT();
  const { categories, products, text, businessName } = useAgentUi();
  const withProducts = categories.filter((c) => products.some((p) => p.categoryId === c.id));
  const visible = categoryId ? products.filter((p) => p.categoryId === categoryId) : products;
  const current = categories.find((c) => c.id === categoryId);

  const chip = (active: boolean) =>
    `${focusRing} flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
      active ? "bg-agent-800 text-white shadow-md" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className="flex flex-col pb-8">
      <ScreenHeader title={current ? text(current.name) : t("browse.title")} subtitle={businessName} />
      {withProducts.length > 0 && (
        <div className="sticky top-[65px] z-20 bg-agent-cream/90 backdrop-blur-md lg:top-[65px]">
          <div
            role="toolbar"
            aria-label={t("browse.categories")}
            className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
          >
            <button type="button" aria-pressed={!categoryId} onClick={() => onCategory(null)} className={chip(!categoryId)}>
              {t("browse.all")}
            </button>
            {withProducts.map((c) => (
              <button key={c.id} type="button" aria-pressed={categoryId === c.id} onClick={() => onCategory(c.id)} className={chip(categoryId === c.id)}>
                {categoryIcon(c.name) && <span aria-hidden="true">{categoryIcon(c.name)}</span>}
                {text(c.name)}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="px-4 pt-1 pb-3 text-xs font-medium text-slate-500 sm:px-6" aria-live="polite">
        {t("home.itemCount", { count: visible.length })}
      </p>
      {visible.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 sm:px-6 xl:grid-cols-4">
          {visible.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <p className="px-4 py-10 text-center text-sm text-slate-500">{t("browse.empty")}</p>
      )}
    </div>
  );
}
