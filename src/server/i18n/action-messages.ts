import { getTranslations } from "next-intl/server";

import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";

/**
 * Server actions answer in the language the form was sent from (its hidden
 * `locale` field): messages live under `actions.*` in messages/{en,ar,fr}.json.
 */
export async function actionT(locale: unknown) {
  return getTranslations({ locale: typeof locale === "string" && isLocale(locale) ? locale : DEFAULT_LOCALE, namespace: "actions" });
}

type T = Awaited<ReturnType<typeof actionT>>;

/**
 * A validation error's message: schemas name their message as "@key"
 * (actions.<key>); anything else (zod's own wording) becomes `fallbackKey`.
 */
export function issueMessage(t: T, issues: { message: string }[] | undefined, fallbackKey: string): string {
  const message = issues?.[0]?.message;
  return message?.startsWith("@") && t.has(message.slice(1)) ? t(message.slice(1)) : t(fallbackKey);
}
