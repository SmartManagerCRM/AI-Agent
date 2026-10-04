import type { ReactNode } from "react";

import { AccountMenu } from "@/components/console/account-menu";
import { InboxBell } from "@/components/console/inbox-bell";
import { LocaleSwitcher } from "@/components/console/locale-switcher";
import { MobileMenuButton } from "@/components/console/mobile-sidebar";
import { SoundToggle } from "@/components/notifications/notification-center";
import { WorkspaceSwitcher } from "@/components/console/workspace-switcher";
import type { Locale } from "@/i18n/locales";

type Props = {
  locale: Locale;
  workspace: { slug: string; name: string; logoUrl?: string | null };
  otherWorkspaces: { slug: string; name: string }[];
  userName: string;
  roleLabel: string;
  isSuperAdmin: boolean;
  superAdminLabel: string;
  signOutLabel: string;
  /** Conversations with new activity since this person last opened Conversations. */
  newConversationCount: number;
  /** The business-currency picker (subscriber consoles only). */
  currencyBar?: ReactNode;
};

export function TopHeader({
  locale,
  workspace,
  otherWorkspaces,
  userName,
  roleLabel,
  isSuperAdmin,
  superAdminLabel,
  signOutLabel,
  newConversationCount,
  currencyBar,
}: Props) {
  const initial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header className="flex h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <MobileMenuButton />
        <WorkspaceSwitcher locale={locale} current={workspace} others={otherWorkspaces} />
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <SoundToggle />
        {/* The currency bar sits next to the language bar. */}
        {currencyBar}
        <LocaleSwitcher locale={locale} />
        <InboxBell locale={locale} slug={workspace.slug} count={newConversationCount} />
        <AccountMenu
          locale={locale}
          name={userName}
          roleLabel={roleLabel}
          initial={initial}
          isSuperAdmin={isSuperAdmin}
          superAdminLabel={superAdminLabel}
          signOutLabel={signOutLabel}
        />
      </div>
    </header>
  );
}
