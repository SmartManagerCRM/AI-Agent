import { CardSkeleton, KpiRowSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <TitleSkeleton width="w-64" />
      <KpiRowSkeleton count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardSkeleton height="h-64" />
        <CardSkeleton height="h-64" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardSkeleton height="h-48" />
        <CardSkeleton height="h-48" />
      </div>
    </div>
  );
}
