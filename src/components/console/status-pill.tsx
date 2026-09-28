import { orderStatusGroup } from "@/lib/order-status";

const GROUP_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  active: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

export function StatusPill({ status }: { status: string }) {
  const group = orderStatusGroup(status);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${GROUP_STYLE[group]}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
