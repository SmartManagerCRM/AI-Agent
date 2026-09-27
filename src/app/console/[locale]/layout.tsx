import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";

import { isLocale } from "@/i18n/locales";

export default async function ConsoleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (isLocale(locale)) setRequestLocale(locale);
  return children;
}
