import { BrainSyncButton } from "@/components/catalog/brain-sync-button";
import { CreateCategoryForm } from "@/components/catalog/create-category-form";
import { CreateProductForm } from "@/components/catalog/create-product-form";
import { FileImportForm } from "@/components/catalog/file-import-form";
import { ProductCard } from "@/components/catalog/product-card";
import { EmptyState } from "@/components/console/empty-state";
import { AutoTranslatedChip } from "@/components/i18n/auto-translated";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { SearchInput } from "@/components/console/search-input";
import { formatMoney } from "@/lib/money";
import { productImageUrl } from "@/lib/product-image";
import { setProductStatusAction } from "@/server/catalog/actions";
import { timed } from "@/server/perf";
import { createUserClient, type TypedSupabaseClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { autoTranslated } from "@/server/translate/marks";
import { Msg } from "@/components/i18n/msg";
import { getTranslations } from "next-intl/server";

/** 16 rows of the 3-column grid. */
const PAGE_SIZE = 48;
const PRODUCT_COLUMNS = "id, name, description, price_minor, status, source, source_price, category_id, image_path";

/**
 * One page of this tenant's products, newest first (deleted ones — status
 * `archived` — are not listed). A search keeps its
 * exact previous semantics — case-insensitive match on the localized name,
 * falling back to the first available translation — so it matches over
 * names only, then fetches full rows for just the requested page.
 */
async function loadProductsPage(
  supabase: TypedSupabaseClient,
  tenantId: string,
  locale: string,
  q: string | undefined,
  page: number,
) {
  const from = (page - 1) * PAGE_SIZE;
  if (!q) {
    const { data, count } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS, { count: "exact" })
      .eq("tenant_id", tenantId)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    return { products: data ?? [], matching: count ?? 0 };
  }
  const { data: names } = await supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .order("id");
  const needle = q.toLowerCase();
  const matchIds = (names ?? [])
    .filter((p) => (p.name[locale] ?? Object.values(p.name)[0] ?? "").toLowerCase().includes(needle))
    .map((p) => p.id);
  const pageIds = matchIds.slice(from, from + PAGE_SIZE);
  if (pageIds.length === 0) return { products: [], matching: matchIds.length };
  const { data } = await supabase.from("products").select(PRODUCT_COLUMNS).in("id", pageIds);
  const byId = new Map((data ?? []).map((p) => [p.id, p]));
  return {
    products: pageIds.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    }),
    matching: matchIds.length,
  };
}

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { locale, slug } = await params;
  const { q, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.products");

  const countProducts = () =>
    supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).neq("status", "archived");
  const [
    { data: categories },
    { count: totalCount },
    { count: activeCount },
    { count: draftCount },
    { count: readyDraftCount },
    { count: needsPriceCount },
    { data: currency },
    pageResult,
  ] = await timed(
    "products.queries",
    Promise.all([
      supabase.from("categories").select("id, name").eq("tenant_id", tenant.id).order("position"),
      countProducts(),
      countProducts().eq("status", "active"),
      countProducts().eq("status", "draft"),
      countProducts().eq("status", "draft").is("source_price", null),
      countProducts().not("source_price", "is", null),
      supabase.from("currencies").select("exponent").eq("code", tenant.currency).single(),
      loadProductsPage(supabase, tenant.id, locale, q, page),
    ]),
  );
  const exponent = currency?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);
  const products = pageResult.products;
  const label = (text: Record<string, string>) => text[locale] ?? Object.values(text)[0] ?? "";
  const categoryOptions = (categories ?? []).map((c) => ({ id: c.id, label: label(c.name) }));
  const productCount = totalCount ?? 0;
  // Names shown in this language that were translated automatically (marked so the owner can check them).
  const [autoProducts, autoCategories] = await Promise.all([
    autoTranslated(supabase, "products", "name", locale, products.map((p) => ({ key: p.id, value: p.name[locale] }))),
    autoTranslated(supabase, "categories", "name", locale, (categories ?? []).map((c) => ({ key: c.id, value: c.name[locale] }))),
  ]);
  const tCommon = await getTranslations("common");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900"><Msg id="console.products.productsServices" /></h1>
        <SearchInput placeholder={t("searchPlaceholder")} defaultValue={q} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="products" accent="emerald" label={t("totalProducts")} value={String(productCount)} trend={null} href={`/${locale}/${slug}/products#products`} />
        <KpiTile icon="orders" accent="blue" label={t("active")} value={String(activeCount ?? 0)} trend={null} href={`/${locale}/${slug}/products#products`} />
        <KpiTile icon="billing" accent="orange" label={t("draft")} value={String(draftCount ?? 0)} trend={null} href={`/${locale}/${slug}/products#products`} />
        <KpiTile
          icon="branches"
          accent="purple"
          label={t("categories")}
          value={String((categories ?? []).length)}
          trend={null}
          href={`/${locale}/${slug}/products#categories`}
        />
      </div>

      <section id="categories" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900"><Msg id="console.products.categories" /></h2>
        <CreateCategoryForm tenantId={tenant.id} slug={slug} locale={locale} />
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {(categories ?? []).map((category) => (
            <li key={category.id} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
              {label(category.name)}
              {autoCategories.has(category.id) && <AutoTranslatedChip label={tCommon("autoTranslated")} hint={tCommon("autoTranslatedHint")} />}
            </li>
          ))}
        </ul>
      </section>

      <section id="import" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900"><Msg id="console.products.addProductsFromAFile" /></h2>
        <FileImportForm slug={slug} locale={locale} defaultKind="product" />
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs text-slate-500">
            <Msg id="console.products.whatTheBusinessBrainFinds" />
          </p>
          <BrainSyncButton slug={slug} locale={locale} />
        </div>
      </section>

      <section id="products" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900"><Msg id="console.products.products" /></h2>
          {(draftCount ?? 0) > 0 && (
            <form action={setProductStatusAction} className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <input type="hidden" name="status" value="active" />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="locale" value={locale} />
              <span><Msg id="console.products.draftsAndSuspendedProductsAren" /></span>
              {(needsPriceCount ?? 0) > 0 && (
                <span className="text-amber-700">{t("needPrice", { count: needsPriceCount ?? 0 })}</span>
              )}
              {(readyDraftCount ?? 0) > 0 && (
                <button
                  type="submit"
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-100"
                >
                  {t("activateAll", { count: readyDraftCount ?? 0 })}
                </button>
              )}
            </form>
          )}
        </div>
        <CreateProductForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
          categories={categories ?? []}
          currencyExponent={exponent}
        />
        {products.length > 0 ? (
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={{
                  id: product.id,
                  name: label(product.name),
                  description: label(product.description ?? {}),
                  priceMinor: product.price_minor,
                  priceLabel: money(product.price_minor),
                  status: product.status,
                  source: product.source,
                  sourcePrice: product.source_price,
                  categoryId: product.category_id,
                  imageUrl: productImageUrl(product.image_path),
                  autoTranslated: autoProducts.has(product.id),
                }}
                categories={categoryOptions}
                exponent={exponent}
                locale={locale}
                slug={slug}
              />
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <EmptyState
              title={productCount === 0 ? t("emptyTitle") : t("noMatchTitle")}
              description={
                productCount === 0
                  ? t("emptyDescription")
                  : t("tryDifferentSearch")
              }
            />
          </div>
        )}
        {(pageResult.matching > PAGE_SIZE || page > 1) && (
          <div className="-mx-4 -mb-4 mt-4">
            <Pagination
              basePath={`/${locale}/${slug}/products`}
              params={{ q }}
              page={page}
              pageSize={PAGE_SIZE}
              total={pageResult.matching}
            />
          </div>
        )}
      </section>
    </div>
  );
}
