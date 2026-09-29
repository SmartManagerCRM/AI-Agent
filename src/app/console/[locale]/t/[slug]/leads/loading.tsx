import { CardSkeleton, KpiRowSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function LeadsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <TitleSkeleton width="w-24" />
      <KpiRowSkeleton count={4} />
      <CardSkeleton height="h-96" />
    </div>
  );
}
