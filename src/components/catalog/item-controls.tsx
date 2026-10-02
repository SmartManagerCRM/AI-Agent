"use client";

import type { ReactNode } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";

const TONE = {
  slate: "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
  amber: "text-amber-600 hover:bg-amber-50 hover:text-amber-700",
  emerald: "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700",
  red: "text-red-500 hover:bg-red-50 hover:text-red-700",
};

/** A small square icon button with an accessible name (shown as a tooltip too). */
export function IconButton({
  icon,
  label,
  tone = "slate",
  type = "button",
  onClick,
  disabled,
}: {
  icon: keyof typeof NAV_ICON_PATHS;
  label: string;
  tone?: keyof typeof TONE;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${TONE[tone]}`}
    >
      <Icon path={NAV_ICON_PATHS[icon]} size={16} />
    </button>
  );
}

/** A one-button form posting to a server action; `confirm` asks first (used for delete). */
export function ActionIconForm({
  action,
  fields,
  confirm: question,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  confirm?: string;
  children: ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (question && !window.confirm(question)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  );
}
