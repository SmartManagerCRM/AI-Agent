import { KpiRowSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function ProductsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <TitleSkeleton width="w-56" />
        <div className="h-9 w-48 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <KpiRowSkeleton count={4} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
