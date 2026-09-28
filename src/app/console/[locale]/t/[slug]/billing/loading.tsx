import { CardSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function BillingLoading() {
  return (
    <div className="flex flex-col gap-6">
      <TitleSkeleton width="w-28" />
      <CardSkeleton height="h-20" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CardSkeleton height="h-32" />
        <CardSkeleton height="h-32" />
      </div>
    </div>
  );
}
