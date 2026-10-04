"use client";

import type { ReactNode } from "react";

/** A form that asks first (switching plans charges the difference; cancelling ends renewal). */
export function ConfirmForm({
  action,
  confirm: question,
  hidden,
  children,
  testId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  confirm: string;
  hidden: Record<string, string>;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <form
      action={action}
      data-testid={testId}
      onSubmit={(event) => {
        if (!window.confirm(question)) event.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  );
}
