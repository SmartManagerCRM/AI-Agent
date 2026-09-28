import { CardSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function AgentLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <TitleSkeleton width="w-28" />
        <div className="h-6 w-20 animate-pulse rounded-full bg-slate-100" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <CardSkeleton height="h-24" />
        <CardSkeleton height="h-24" />
        <CardSkeleton height="h-24" />
      </div>
      <CardSkeleton height="h-32" />
      <CardSkeleton height="h-40" />
    </div>
  );
}
