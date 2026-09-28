/** Structural loading placeholders — no numbers, no fabricated content, just shape while the real (server-fetched) data streams in. */

export function TitleSkeleton({ width = "w-40" }: { width?: string }) {
  return <div className={`h-8 ${width} animate-pulse rounded-md bg-slate-200`} />;
}

export function KpiTileSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="mt-3 h-6 w-20 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <KpiTileSkeleton key={i} />
      ))}
    </div>
  );
}

export function CardSkeleton({ height = "h-48" }: { height?: string }) {
  return <div className={`animate-pulse rounded-xl border border-slate-200 bg-slate-100 ${height}`} />;
}
