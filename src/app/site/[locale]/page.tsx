import { getTranslations } from "next-intl/server";

import { platformOrigin } from "@/lib/hosts";
import { serverEnv } from "@/server/env";

export default async function MarketingHome() {
  const t = await getTranslations("marketing");
  const env = serverEnv();
  const consoleHref = platformOrigin(env.CONSOLE_SUBDOMAIN, {
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
    scheme: env.PUBLIC_URL_SCHEME,
    port: env.PUBLIC_URL_PORT,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-xl text-neutral-600">{t("tagline")}</p>
      <p className="max-w-xl text-neutral-500">{t("description")}</p>
      <a
        href={consoleHref}
        className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
      >
        {t("cta")}
      </a>
    </main>
  );
}
