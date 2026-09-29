import { CardSkeleton, KpiTileSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function BookingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <TitleSkeleton width="w-32" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTileSkeleton />
        <KpiTileSkeleton />
        <KpiTileSkeleton />
      </div>
      <CardSkeleton height="h-48" />
      <CardSkeleton height="h-96" />
    </div>
  );
}
