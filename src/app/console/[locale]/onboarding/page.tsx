import { getTranslations } from "next-intl/server";

import { CreateBusinessForm } from "@/components/business/create-business-form";
import { requireUser } from "@/server/tenant/context";
import { createUserClient } from "@/server/supabase/clients";

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireUser(locale);
  const t = await getTranslations("onboarding");

  const supabase = await createUserClient();
  const [{ data: businessTypes }, { data: currencies }] = await Promise.all([
    supabase.from("business_types").select("key, name").eq("is_active", true).order("key"),
    supabase.from("currencies").select("code, name").order("code"),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-start justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CreateBusinessForm
        locale={locale}
        businessTypes={businessTypes ?? []}
        currencies={currencies ?? []}
        labels={{
          businessName: t("businessName"),
          businessType: t("businessType"),
          language: t("language"),
          currency: t("currency"),
          submit: t("submit"),
        }}
      />
    </main>
  );
}
