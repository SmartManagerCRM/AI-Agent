import { CardSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function BranchesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <TitleSkeleton width="w-32" />
      <CardSkeleton height="h-64" />
    </div>
  );
}
