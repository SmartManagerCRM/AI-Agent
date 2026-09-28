import { CardSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function MarketingLoading() {
  return (
    <div className="flex flex-col gap-6">
      <TitleSkeleton width="w-40" />
      <div className="grid grid-cols-3 gap-4">
        <CardSkeleton height="h-24" />
        <CardSkeleton height="h-24" />
        <CardSkeleton height="h-24" />
      </div>
      <CardSkeleton height="h-24" />
      <CardSkeleton height="h-64" />
    </div>
  );
}
