import { CreateCategoryForm } from "@/components/catalog/create-category-form";
import { CreateProductForm } from "@/components/catalog/create-product-form";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export default async function ProductsPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: categories }, { data: products }, { data: currency }] = await Promise.all([
    supabase.from("categories").select("id, name").order("position"),
    supabase.from("products").select("*").order("created_at", { ascending: false }),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).single(),
  ]);
  const exponent = currency?.exponent ?? 2;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Products &amp; Services</h1>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-700">Categories</h2>
        <CreateCategoryForm tenantId={tenant.id} slug={slug} locale={locale} />
        <ul className="flex flex-wrap gap-2 text-sm">
          {(categories ?? []).map((category) => (
            <li key={category.id} className="rounded-full border border-neutral-200 px-3 py-1">
              {category.name[locale] ?? Object.values(category.name)[0]}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-700">Products</h2>
        <CreateProductForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
          categories={categories ?? []}
          currencyExponent={exponent}
        />
        <ul className="flex flex-col gap-2">
          {(products ?? []).map((product) => (
            <li key={product.id} className="flex items-center justify-between rounded-md border border-neutral-200 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{product.name[locale] ?? Object.values(product.name)[0]}</p>
                <p className="text-neutral-500">
                  {formatMinor(product.price_minor, exponent)} {tenant.currency} · {product.status}
                </p>
              </div>
            </li>
          ))}
          {(products ?? []).length === 0 && <p className="text-sm text-neutral-400">No products yet.</p>}
        </ul>
      </section>
    </div>
  );
}

function formatMinor(minor: number, exponent: number): string {
  return (minor / 10 ** exponent).toFixed(exponent);
}
