import { CardSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function ConversationsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <TitleSkeleton width="w-40" />
      <div className="grid grid-cols-3 gap-4">
        <CardSkeleton height="h-24" />
        <CardSkeleton height="h-24" />
        <CardSkeleton height="h-24" />
      </div>
      <CardSkeleton height="h-96" />
    </div>
  );
}
