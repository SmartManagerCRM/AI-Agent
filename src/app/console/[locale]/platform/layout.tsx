import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { requireSuperAdmin } from "@/server/tenant/context";

export default async function PlatformLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const t = await getTranslations("platform");

  const nav = [
    { key: "overview", href: `/${locale}/platform` },
    { key: "settings", href: `/${locale}/platform/settings` },
    { key: "models", href: `/${locale}/platform/models` },
    { key: "admins", href: `/${locale}/platform/admins` },
  ] as const;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-e border-neutral-200 bg-white px-4 py-6">
        <p className="mb-6 truncate text-sm font-semibold">{t("title")}</p>
        <nav className="flex flex-col gap-1 text-sm">
          {nav.map((item) => (
            <a key={item.key} href={item.href} className="rounded-md px-3 py-2 text-neutral-700 hover:bg-neutral-100">
              {t(`nav.${item.key}`)}
            </a>
          ))}
        </nav>
      </aside>
      <div className="flex-1 px-8 py-6">{children}</div>
    </div>
  );
}
