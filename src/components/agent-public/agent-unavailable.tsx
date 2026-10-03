import Image from "next/image";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { isLocale, localeDirection, type Locale } from "@/i18n/locales";

type Reason = "not_live" | "paused" | "unavailable";

/** Public page for a business that exists but whose Agent isn't live (never published, paused, or plan inactive). */
export async function AgentUnavailable({
  reason,
  businessName,
  defaultLanguage,
}: {
  reason: Reason;
  businessName: Record<string, string>;
  defaultLanguage: string;
}) {
  const negotiated = (await headers()).get("x-next-intl-locale");
  const locale: Locale = isLocale(negotiated) ? negotiated : isLocale(defaultLanguage) ? defaultLanguage : "en";
  const name = businessName[locale] ?? businessName[defaultLanguage] ?? Object.values(businessName)[0] ?? "";
  const t = await getTranslations({ locale, namespace: "agent.unavailablePage" });
  return (
    <main
      lang={locale}
      dir={localeDirection(locale)}
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-agent-cream px-6 text-center"
    >
      <Image src="/brand/agent-avatar.png" alt="" width={96} height={96} className="h-20 w-20 rounded-full bg-agent-100 ring-1 ring-agent-200" />
      {name && <p className="text-sm font-semibold uppercase tracking-wide text-agent-700">{name}</p>}
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{t(`${reason}.title`)}</h1>
      <p className="max-w-sm text-sm text-slate-500">{t(`${reason}.body`)}</p>
    </main>
  );
}
