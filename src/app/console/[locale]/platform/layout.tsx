import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { signOutAction } from "@/server/auth/actions";
import { requireSuperAdmin } from "@/server/tenant/context";

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const ICON_PATHS = {
  overview: "M3 12l9-9 9 9M5 10v10h14V10",
  models: "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6z",
  admins: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
} as const;

export default async function PlatformLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const t = await getTranslations("platform");

  const nav = [
    { key: "overview", href: `/${locale}/platform`, icon: ICON_PATHS.overview },
    { key: "models", href: `/${locale}/platform/models`, icon: ICON_PATHS.models },
    { key: "admins", href: `/${locale}/platform/admins`, icon: ICON_PATHS.admins },
    { key: "settings", href: `/${locale}/platform/settings`, icon: ICON_PATHS.settings },
  ] as const;

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside className="flex w-60 shrink-0 flex-col justify-between bg-neutral-900 px-4 py-6 text-neutral-100">
        <div>
          <p className="mb-1 truncate text-sm font-semibold text-white">SmartManager</p>
          <p className="mb-6 text-xs text-neutral-400">{t("title")}</p>
          <nav className="flex flex-col gap-1 text-sm">
            {nav.map((item) => (
              <a
                key={item.key}
                href={item.href}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-neutral-300 hover:bg-neutral-800 hover:text-white"
              >
                <Icon path={item.icon} />
                {t(`nav.${item.key}`)}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex flex-col gap-1 border-t border-neutral-800 pt-4 text-sm">
          <a href={`/${locale}/subscriber`} className="rounded-md px-3 py-2 text-neutral-300 hover:bg-neutral-800 hover:text-white">
            {t("backToConsole")}
          </a>
          <form action={signOutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="w-full rounded-md px-3 py-2 text-start text-neutral-400 hover:bg-neutral-800 hover:text-white">
              {t("signOut")}
            </button>
          </form>
        </div>
      </aside>
      <div className="flex-1 px-8 py-8">{children}</div>
    </div>
  );
}
