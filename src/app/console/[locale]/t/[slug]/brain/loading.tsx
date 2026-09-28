import { CardSkeleton, KpiRowSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function BrainLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <TitleSkeleton width="w-48" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <KpiRowSkeleton count={4} />
      <CardSkeleton height="h-40" />
      <CardSkeleton height="h-40" />
      <CardSkeleton height="h-64" />
    </div>
  );
}
