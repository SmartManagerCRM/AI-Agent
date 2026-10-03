import Link from "next/link";
import { EmptyState } from "@/components/console/empty-state";
import { searchPlatform } from "@/server/platform/search";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";

export default async function PlatformSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const t = await getTranslations("platform.search");

  const results = q ? await searchPlatform(supabase, q) : { businesses: [], subscribers: [], orders: [] };
  const total = results.businesses.length + results.subscribers.length + results.orders.length;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{q ? t("titleQuery", { q }) : t("title")}</h1>

      {!q ? (
        <p className="text-sm text-slate-500">{t("hint")}</p>
      ) : total === 0 ? (
        <EmptyState
          title={t("noResults")}
          description={t("noResultsDescription", { q })}
        />
      ) : (
        <>
          {results.businesses.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("businesses")}</h2>
              <ul className="flex flex-col gap-2">
                {results.businesses.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/${locale}${r.href}`}
                      prefetch={false}
                      className="flex flex-col rounded-lg px-3 py-2 hover:bg-slate-50"
                    >
                      <span className="text-sm font-medium text-slate-900">{r.title}</span>
                      <span className="text-xs text-slate-500">{r.subtitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.subscribers.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("subscribers")}</h2>
              <ul className="flex flex-col gap-2">
                {results.subscribers.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/${locale}${r.href}`}
                      prefetch={false}
                      className="flex flex-col rounded-lg px-3 py-2 hover:bg-slate-50"
                    >
                      <span className="text-sm font-medium text-slate-900">{r.title}</span>
                      <span className="text-xs text-slate-500">{r.subtitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.orders.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("orders")}</h2>
              <ul className="flex flex-col gap-2">
                {results.orders.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/${locale}${r.href}`}
                      prefetch={false}
                      className="flex flex-col rounded-lg px-3 py-2 hover:bg-slate-50"
                    >
                      <span className="text-sm font-medium text-slate-900">{r.orderNumber !== undefined ? t("order", { n: r.orderNumber }) : r.title}</span>
                      <span className="text-xs text-slate-500">{r.subtitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
