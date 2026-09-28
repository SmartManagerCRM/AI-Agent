import { CardSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function AuditLoading() {
  return (
    <div className="flex flex-col gap-4">
      <TitleSkeleton width="w-36" />
      <CardSkeleton height="h-96" />
    </div>
  );
}
