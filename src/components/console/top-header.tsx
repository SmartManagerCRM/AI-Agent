import { AccountMenu } from "@/components/console/account-menu";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { LocaleSwitcher } from "@/components/console/locale-switcher";
import { MobileMenuButton } from "@/components/console/mobile-sidebar";
import { WorkspaceSwitcher } from "@/components/console/workspace-switcher";
import type { Locale } from "@/i18n/locales";

type Props = {
  locale: Locale;
  workspace: { slug: string; name: string };
  otherWorkspaces: { slug: string; name: string }[];
  userName: string;
  roleLabel: string;
  isSuperAdmin: boolean;
  superAdminLabel: string;
  signOutLabel: string;
  openConversationCount: number;
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
  openConversationCount,
}: Props) {
  const initial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header className="flex h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <MobileMenuButton />
        <WorkspaceSwitcher locale={locale} current={workspace} others={otherWorkspaces} />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <LocaleSwitcher locale={locale} />
        <a
          href={`/${locale}/t/${workspace.slug}/conversations`}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          aria-label="Open conversations"
        >
          <Icon path={NAV_ICON_PATHS.bell} size={18} />
          {openConversationCount > 0 && (
            <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold text-white">
              {openConversationCount > 9 ? "9+" : openConversationCount}
            </span>
          )}
        </a>
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
