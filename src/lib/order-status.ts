/** The real order lifecycle this app uses (a food/service-order flow, not generic e-commerce shipping) — grouped for display since 9 raw statuses is too many for a status pill or a donut legend. */
export const ORDER_STATUS_GROUPS: Record<string, "pending" | "active" | "completed" | "cancelled"> = {
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

export const ORDER_STATUS_GROUP_COLOR: Record<string, string> = {
  pending: "#f59e0b",
  active: "#3b82f6",
  completed: "#10b981",
  cancelled: "#ef4444",
};

export function orderStatusGroup(status: string): "pending" | "active" | "completed" | "cancelled" {
  return ORDER_STATUS_GROUPS[status] ?? "pending";
}
