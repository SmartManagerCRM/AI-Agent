import Image from "next/image";
import { headers } from "next/headers";

import { isLocale, localeDirection, type Locale } from "@/i18n/locales";

const TEXT: Record<Locale, { title: string; body: string }> = {
  en: {
    title: "We couldn't find this business",
    body: "The link may be mistyped, or the business may have moved. Please check the link you were given, or contact the business directly.",
  },
  ar: {
    title: "لم نتمكن من العثور على هذا النشاط التجاري",
    body: "قد يكون الرابط غير صحيح أو تم تغييره. يرجى التحقق من الرابط الذي وصلك، أو التواصل مع النشاط التجاري مباشرة.",
  },
  fr: {
    title: "Nous n'avons pas trouvé cet établissement",
    body: "Le lien est peut-être mal saisi ou l'établissement a changé d'adresse. Vérifiez le lien reçu ou contactez directement l'établissement.",
  },
};

/**
 * Customer-facing "business not found" page for the public Agent routes
 * (`/agent/<slug>`, `/agent/widget/<slug>`, `/agent/pay/<id>`): an unknown
 * slug is a normal 404 with a clear message in the customer's language —
 * never a server error, and nothing about other businesses.
 */
export default async function AgentNotFound() {
  const negotiated = (await headers()).get("x-next-intl-locale");
  const locale: Locale = isLocale(negotiated) ? negotiated : "en";
  const t = TEXT[locale];
  return (
    <main
      lang={locale}
      dir={localeDirection(locale)}
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-agent-cream px-6 text-center"
    >
      <Image src="/brand/agent-avatar.png" alt="" width={96} height={96} className="h-20 w-20 rounded-full bg-agent-100 ring-1 ring-agent-200" />
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{t.title}</h1>
      <p className="max-w-sm text-sm text-slate-500">{t.body}</p>
    </main>
  );
}
