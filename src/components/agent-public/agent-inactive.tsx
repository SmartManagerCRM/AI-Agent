import Image from "next/image";

import { localeDirection, type Locale } from "@/i18n/locales";

/** Shown instead of the Agent while the business hasn't switched its Agent on yet. */
export function AgentInactive({ locale, businessName, text }: { locale: Locale; businessName: string; text: string }) {
  return (
    <main
      lang={locale}
      dir={localeDirection(locale)}
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-agent-cream px-6 text-center"
    >
      <Image src="/brand/agent-avatar.png" alt="" width={96} height={96} className="h-20 w-20 rounded-full bg-agent-100 ring-1 ring-agent-200" />
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{businessName}</h1>
      <p className="max-w-sm text-sm text-slate-500">{text}</p>
    </main>
  );
}
