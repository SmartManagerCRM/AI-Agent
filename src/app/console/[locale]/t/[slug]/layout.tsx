import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { requireTenantMember } from "@/server/tenant/context";
import { signOutAction } from "@/server/auth/actions";

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const t = await getTranslations("console");

  const nav = [
    { key: "dashboard", href: `/${locale}/t/${slug}` },
    { key: "orders", href: `/${locale}/t/${slug}/orders` },
    { key: "products", href: `/${locale}/t/${slug}/products` },
    { key: "branches", href: `/${locale}/t/${slug}/branches` },
    { key: "businessBrain", href: `/${locale}/t/${slug}/brain` },
    { key: "agent", href: `/${locale}/t/${slug}/agent` },
    { key: "conversations", href: `/${locale}/t/${slug}/conversations` },
    { key: "billing", href: `/${locale}/t/${slug}/billing` },
    { key: "settings", href: `/${locale}/t/${slug}/settings` },
  ] as const;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-e border-neutral-200 bg-white px-4 py-6">
        <p className="mb-6 truncate text-sm font-semibold">{tenant.business_name[locale] ?? tenant.slug}</p>
        <nav className="flex flex-col gap-1 text-sm">
          {nav.map((item) => (
            <a key={item.key} href={item.href} className="rounded-md px-3 py-2 text-neutral-700 hover:bg-neutral-100">
              {t(`nav.${item.key}`)}
            </a>
          ))}
        </nav>
        <form action={signOutAction} className="mt-8">
          <input type="hidden" name="locale" value={locale} />
          <button type="submit" className="text-sm text-neutral-500 underline">
            {t("signOut")}
          </button>
        </form>
      </aside>
      <div className="flex-1 px-8 py-6">{children}</div>
    </div>
  );
}
