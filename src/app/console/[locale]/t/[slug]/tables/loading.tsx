import { CardSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function TablesLoading() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <TitleSkeleton width="w-28" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <CardSkeleton height="h-28" />
      <CardSkeleton height="h-64" />
    </div>
  );
}
