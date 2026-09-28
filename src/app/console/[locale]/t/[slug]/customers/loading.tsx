import { CardSkeleton, KpiRowSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function CustomersLoading() {
  return (
    <div className="flex flex-col gap-4">
      <TitleSkeleton width="w-36" />
      <KpiRowSkeleton count={4} />
      <CardSkeleton height="h-96" />
    </div>
  );
}
