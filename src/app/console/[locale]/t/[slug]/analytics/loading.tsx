import { CardSkeleton, KpiRowSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <TitleSkeleton width="w-32" />
        <div className="h-9 w-48 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <KpiRowSkeleton count={4} />
      <CardSkeleton height="h-56" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardSkeleton height="h-44" />
        <CardSkeleton height="h-44" />
      </div>
      <CardSkeleton height="h-56" />
    </div>
  );
}
