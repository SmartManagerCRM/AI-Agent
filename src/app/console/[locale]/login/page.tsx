import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { CredentialsForm } from "@/components/auth/credentials-form";
import { signInAction, signUpAction } from "@/server/auth/actions";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { locale } = await params;
  const { mode } = await searchParams;
  const t = await getTranslations("auth");
  const isSignUp = mode === "signup";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">{isSignUp ? t("signUp") : t("signIn")}</h1>
      <CredentialsForm
        action={isSignUp ? signUpAction : signInAction}
        locale={locale}
        emailLabel={t("email")}
        passwordLabel={t("password")}
        submitLabel={t("submit")}
      />
      <Link href={`/${locale}/login?mode=${isSignUp ? "signin" : "signup"}`} className="text-sm text-neutral-600 underline">
        {isSignUp ? t("switchToSignIn") : t("switchToSignUp")}
      </Link>
    </main>
  );
}
