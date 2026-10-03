import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

type Values = Record<string, string | number | Date>;
type RichValues = Record<string, string | number | Date | ((chunks: ReactNode) => ReactNode)>;

/**
 * A translated string from the messages (messages/<locale>.json), by its full
 * key — for markup text in server and client components alike, so no page
 * keeps a hard-coded sentence.
 */
export function Msg({ id, values }: { id: string; values?: Values }) {
  const t = useTranslations();
  return <>{t(id, values)}</>;
}

/** The same, with markup inside the sentence: `{ strong: (c) => <strong>{c}</strong> }`. */
export function RichMsg({ id, values }: { id: string; values: RichValues }) {
  const t = useTranslations();
  return <>{t.rich(id, values)}</>;
}
