import { getTranslations } from "next-intl/server";

import { requireTenantMember } from "@/server/tenant/context";

export default async function AgentPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  await requireTenantMember(locale, slug);
  const t = await getTranslations("console");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Agent</h1>
      <p className="max-w-md rounded-md border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-500">
        {t("comingSoon")}
      </p>
    </div>
  );
}
