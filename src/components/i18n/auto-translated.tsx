/** Small mark next to a text that was translated automatically (hover for what it means). */
export function AutoTranslatedChip({ label, hint }: { label: string; hint: string }) {
  return (
    <span
      title={hint}
      data-testid="auto-translated"
      className="ms-1.5 inline-block rounded bg-sky-50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-sky-700"
    >
      {label}
    </span>
  );
}
