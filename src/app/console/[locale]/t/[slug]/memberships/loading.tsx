import { CardSkeleton, KpiTileSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function MembershipsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <TitleSkeleton width="w-40" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTileSkeleton />
        <KpiTileSkeleton />
        <KpiTileSkeleton />
        <KpiTileSkeleton />
      </div>
      <CardSkeleton height="h-48" />
      <CardSkeleton height="h-96" />
    </div>
  );
}
