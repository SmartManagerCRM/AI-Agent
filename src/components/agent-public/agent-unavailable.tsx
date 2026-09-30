import Image from "next/image";
import { headers } from "next/headers";

import { isLocale, localeDirection, type Locale } from "@/i18n/locales";

type Reason = "not_live" | "paused" | "unavailable";

const TEXT: Record<Locale, Record<Reason, { title: string; body: string }>> = {
  en: {
    not_live: { title: "Agent not live yet", body: "This business's AI Agent hasn't been published yet. Please check back soon, or contact the business directly." },
    paused: { title: "Agent temporarily unavailable", body: "This business has paused its AI Agent for now. Please check back soon, or contact the business directly." },
    unavailable: { title: "Agent temporarily unavailable", body: "This AI Agent isn't available right now. Please check back soon, or contact the business directly." },
  },
  ar: {
    not_live: { title: "المساعد غير متاح بعد", body: "لم يتم نشر المساعد الذكي لهذا النشاط التجاري بعد. يرجى المحاولة لاحقاً أو التواصل مع النشاط التجاري مباشرة." },
    paused: { title: "المساعد غير متاح مؤقتاً", body: "أوقف هذا النشاط التجاري مساعده الذكي مؤقتاً. يرجى المحاولة لاحقاً أو التواصل مع النشاط التجاري مباشرة." },
    unavailable: { title: "المساعد غير متاح مؤقتاً", body: "هذا المساعد الذكي غير متاح حالياً. يرجى المحاولة لاحقاً أو التواصل مع النشاط التجاري مباشرة." },
  },
  fr: {
    not_live: { title: "Agent pas encore en ligne", body: "L'agent IA de cet établissement n'a pas encore été publié. Revenez bientôt ou contactez directement l'établissement." },
    paused: { title: "Agent temporairement indisponible", body: "Cet établissement a mis son agent IA en pause. Revenez bientôt ou contactez directement l'établissement." },
    unavailable: { title: "Agent temporairement indisponible", body: "Cet agent IA n'est pas disponible pour le moment. Revenez bientôt ou contactez directement l'établissement." },
  },
};

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
  const t = TEXT[locale][reason];
  return (
    <main
      lang={locale}
      dir={localeDirection(locale)}
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-agent-cream px-6 text-center"
    >
      <Image src="/brand/agent-avatar.png" alt="" width={96} height={96} className="h-20 w-20 rounded-full bg-agent-100 ring-1 ring-agent-200" />
      {name && <p className="text-sm font-semibold uppercase tracking-wide text-agent-700">{name}</p>}
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{t.title}</h1>
      <p className="max-w-sm text-sm text-slate-500">{t.body}</p>
    </main>
  );
}
