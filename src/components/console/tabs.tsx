import Link from "next/link";

export type Tab = { key: string; label: string; count?: number; href: string; active: boolean };

export function Tabs({ tabs }: { tabs: Tab[] }) {
  return (
    <div className="flex gap-1 border-b border-slate-200">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          prefetch={false}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab.active
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs ${tab.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
            >
              {tab.count}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
