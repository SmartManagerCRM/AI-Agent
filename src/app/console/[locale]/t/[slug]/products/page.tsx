import { CreateCategoryForm } from "@/components/catalog/create-category-form";
import { CreateProductForm } from "@/components/catalog/create-product-form";
import { EmptyState } from "@/components/console/empty-state";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { KpiTile } from "@/components/console/kpi-tile";
import { SearchInput } from "@/components/console/search-input";
import { formatMoney } from "@/lib/money";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, slug } = await params;
  const { q } = await searchParams;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: categories }, { data: allProducts }, { data: currency }] = await Promise.all([
    supabase.from("categories").select("id, name").order("position"),
    supabase.from("products").select("*").order("created_at", { ascending: false }),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).single(),
  ]);
  const exponent = currency?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);

  const products = q
    ? (allProducts ?? []).filter((p) =>
        (p.name[locale] ?? Object.values(p.name)[0] ?? "").toLowerCase().includes(q.toLowerCase()),
      )
    : (allProducts ?? []);
  const activeCount = (allProducts ?? []).filter((p) => p.status === "active").length;
  const draftCount = (allProducts ?? []).filter((p) => p.status === "draft").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Products &amp; Services</h1>
        <SearchInput placeholder="Search products..." defaultValue={q} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon="products"
          accent="emerald"
          label="Total products"
          value={String((allProducts ?? []).length)}
          trend={null}
        />
        <KpiTile icon="orders" accent="blue" label="Active" value={String(activeCount)} trend={null} />
        <KpiTile icon="billing" accent="orange" label="Draft" value={String(draftCount)} trend={null} />
        <KpiTile
          icon="branches"
          accent="purple"
          label="Categories"
          value={String((categories ?? []).length)}
          trend={null}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
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
              title={(allProducts ?? []).length === 0 ? "No products yet" : "No products match your search"}
              description={
                (allProducts ?? []).length === 0
                  ? "Add your first product or service above so customers can order it through your AI Agent."
                  : "Try a different search term."
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}
