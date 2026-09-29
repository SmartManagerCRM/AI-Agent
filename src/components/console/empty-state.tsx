import Link from "next/link";

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-slate-200 px-4 py-6">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="text-sm text-slate-500">{description}</p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          prefetch={false}
          className="mt-1 text-sm font-medium text-emerald-600 hover:text-emerald-700"
        >
          {actionLabel} →
        </Link>
      )}
    </div>
  );
}
