import { CardSkeleton, KpiRowSkeleton, TitleSkeleton } from "@/components/console/skeleton";

/**
 * Shared Super Admin loading state — shown inside the (persistent) Super
 * Admin layout while any Super Admin page's server data streams in.
 */
export default function SuperAdminLoading() {
  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <TitleSkeleton width="w-56" />
      <KpiRowSkeleton count={4} />
      <CardSkeleton height="h-72" />
      <CardSkeleton height="h-48" />
    </div>
  );
}
