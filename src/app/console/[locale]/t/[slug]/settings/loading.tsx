import { CardSkeleton, TitleSkeleton } from "@/components/console/skeleton";

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <TitleSkeleton width="w-32" />
      <CardSkeleton height="h-72" />
      <CardSkeleton height="h-64" />
      <CardSkeleton height="h-48" />
    </div>
  );
}
