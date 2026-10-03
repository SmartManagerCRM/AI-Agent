"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { markInboxSeenAction } from "@/server/inbox/actions";

/**
 * Header bell: conversations with new activity since this person last
 * opened Conversations. Opening them (from the bell or the sidebar) marks
 * them seen — the number disappears and stays gone until something new
 * arrives.
 */
export function InboxBell({ locale, slug, count }: { locale: string; slug: string; count: number }) {
  const href = `/${locale}/${slug}/conversations`;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("console.shell");
  const onInbox = pathname === href || (pathname?.startsWith(`${href}/`) ?? false);

  useEffect(() => {
    if (!onInbox) return;
    let cancelled = false;
    void markInboxSeenAction({ locale, slug }).then(() => {
      // Re-render the header with the new (zero) count, so it stays gone after leaving the page.
      if (!cancelled && count > 0) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [onInbox, locale, slug, count, router]);

  const shown = onInbox ? 0 : count;
  return (
    <Link
      href={href}
      prefetch={false}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
      aria-label={shown > 0 ? t("openConversationsNew", { count: shown }) : t("openConversations")}
      data-testid="inbox-bell"
    >
      <Icon path={NAV_ICON_PATHS.bell} size={18} />
      {shown > 0 && (
        <span
          data-testid="inbox-bell-count"
          className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold text-white"
        >
          {shown > 9 ? "9+" : shown}
        </span>
      )}
    </Link>
  );
}
