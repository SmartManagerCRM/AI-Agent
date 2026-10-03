import { useTranslations } from "next-intl";

import { statusLabel } from "@/lib/i18n-labels";
import { orderStatusGroup } from "@/lib/order-status";

const GROUP_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  active: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

export function StatusPill({ status }: { status: string }) {
  const t = useTranslations();
  const group = orderStatusGroup(status);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${GROUP_STYLE[group]}`}>
      {statusLabel(t, status)}
    </span>
  );
}
