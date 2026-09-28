const GROUP_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  active: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

const STATUS_TO_GROUP: Record<string, string> = {
  draft: "pending",
  pending_payment: "pending",
  paid: "active",
  confirmed: "active",
  preparing: "active",
  ready: "active",
  completed: "completed",
  cancelled: "cancelled",
  refunded: "cancelled",
};

export function StatusPill({ status }: { status: string }) {
  const group = STATUS_TO_GROUP[status] ?? "pending";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${GROUP_STYLE[group]}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
