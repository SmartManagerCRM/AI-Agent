import { CardSkeleton, KpiRowSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function OrdersLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <TitleSkeleton width="w-32" />
        <div className="h-9 w-48 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <KpiRowSkeleton count={4} />
      <CardSkeleton height="h-96" />
    </div>
  );
}
