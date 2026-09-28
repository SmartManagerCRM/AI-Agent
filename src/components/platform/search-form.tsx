import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";

/** Plain GET form — deterministic server-side search (spec §7), no client JS, no LLM call. */
export function PlatformSearchForm({ locale }: { locale: string }) {
  return (
    <form method="get" action={`/${locale}/super-admin/search`} className="relative w-full max-w-md">
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
        <Icon path={NAV_ICON_PATHS.search} size={16} />
      </span>
      <input
        type="search"
        name="q"
        placeholder="Search subscribers, businesses, orders…"
        className="w-full rounded-lg border border-slate-300 py-2 ps-9 pe-3 text-sm outline-none focus:border-emerald-500"
      />
    </form>
  );
}
