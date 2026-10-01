import { CreateCategoryForm } from "@/components/catalog/create-category-form";
import { CreateProductForm } from "@/components/catalog/create-product-form";
import { EmptyState } from "@/components/console/empty-state";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { SearchInput } from "@/components/console/search-input";
import { formatMoney } from "@/lib/money";
import { timed } from "@/server/perf";
import { createUserClient, type TypedSupabaseClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

/** 16 rows of the 3-column grid. */
const PAGE_SIZE = 48;
const PRODUCT_COLUMNS = "id, name, price_minor, status";

/**
 * One page of this tenant's products, newest first. A search keeps its
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
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    return { products: data ?? [], matching: count ?? 0 };
  }
  const { data: names } = await supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", tenantId)
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

  const countProducts = () =>
    supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
  const [
    { data: categories },
    { count: totalCount },
    { count: activeCount },
    { count: draftCount },
    { data: currency },
    pageResult,
  ] = await timed(
    "products.queries",
    Promise.all([
      supabase.from("categories").select("id, name").eq("tenant_id", tenant.id).order("position"),
      countProducts(),
      countProducts().eq("status", "active"),
      countProducts().eq("status", "draft"),
      supabase.from("currencies").select("exponent").eq("code", tenant.currency).single(),
      loadProductsPage(supabase, tenant.id, locale, q, page),
    ]),
  );
  const exponent = currency?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);
  const products = pageResult.products;
  const productCount = totalCount ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Products &amp; Services</h1>
        <SearchInput placeholder="Search products..." defaultValue={q} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="products" accent="emerald" label="Total products" value={String(productCount)} trend={null} href={`/${locale}/${slug}/products#products`} />
        <KpiTile icon="orders" accent="blue" label="Active" value={String(activeCount ?? 0)} trend={null} href={`/${locale}/${slug}/products#products`} />
        <KpiTile icon="billing" accent="orange" label="Draft" value={String(draftCount ?? 0)} trend={null} href={`/${locale}/${slug}/products#products`} />
        <KpiTile
          icon="branches"
          accent="purple"
          label="Categories"
          value={String((categories ?? []).length)}
          trend={null}
          href={`/${locale}/${slug}/products#categories`}
        />
      </div>

      <section id="categories" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Categories</h2>
        <CreateCategoryForm tenantId={tenant.id} slug={slug} locale={locale} />
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {(categories ?? []).map((category) => (
            <li key={category.id} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
              {category.name[locale] ?? Object.values(category.name)[0]}
            </li>
          ))}
        </ul>
      </section>

      <section id="products" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Products</h2>
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
              <li key={product.id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex h-24 items-center justify-center rounded-md bg-slate-50 text-slate-300">
                  <Icon path={NAV_ICON_PATHS.products} size={28} />
                </div>
                <p className="font-medium text-slate-900">{product.name[locale] ?? Object.values(product.name)[0]}</p>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-slate-500">{money(product.price_minor)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                      product.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {product.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <EmptyState
              title={productCount === 0 ? "No products yet" : "No products match your search"}
              description={
                productCount === 0
                  ? "Add your first product or service above so customers can order it through your AI Agent."
                  : "Try a different search term."
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
