import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";

/** Plain GET form — works without client JS; the page reads `q` from searchParams. */
export function SearchInput({ placeholder, defaultValue }: { placeholder: string; defaultValue?: string }) {
  return (
    <form method="get" className="relative">
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
        <Icon path={NAV_ICON_PATHS.search} size={16} />
      </span>
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full max-w-xs rounded-lg border border-slate-300 py-2 ps-9 pe-3 text-sm outline-none focus:border-emerald-500"
      />
    </form>
  );
}
