"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";

import { groupCurrencies } from "@/lib/currencies";
import { signupAction, type SignupState } from "@/server/site/signup-actions";

import { SiteIcon } from "./icons";

type Option = { value: string; label: string };

const inputClass =
  "site-focus h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-[#0c1a33] shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 aria-[invalid=true]:border-rose-400";

function Field({ label, name, children, hint, invalid }: { label: string; name: string; children: React.ReactNode; hint?: string; invalid?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-[#0c1a33]" htmlFor={name} data-invalid={invalid || undefined}>
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

export function SignupForm({
  locale,
  plan,
  signedInEmail,
  businessTypes,
  countries,
  currencies,
  defaultCurrency,
}: {
  locale: string;
  plan: string;
  signedInEmail: string | null;
  businessTypes: Option[];
  countries: Option[];
  currencies: string[];
  defaultCurrency: string;
}) {
  const t = useTranslations("site.signup");
  const tHeader = useTranslations("site.header");
  const [state, action, pending] = useActionState<SignupState, FormData>(signupAction, undefined);
  const [showPassword, setShowPassword] = useState(false);
  const bad = (f: string) => state?.field === f;

  if (state?.pendingEmail) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center" role="status" data-testid="signup-check-email">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <SiteIcon name="mail" size={30} />
        </span>
        <h2 className="text-2xl font-extrabold text-[#0c1a33]">{t("checkEmail.title")}</h2>
        <p className="max-w-md text-[15px] leading-relaxed text-[#33415c]">{t("checkEmail.text", { email: state.pendingEmail })}</p>
        <Link href={`/${locale}/login?redirectTo=${encodeURIComponent(`/${locale}/welcome`)}`} className="site-btn-primary site-focus mt-2 h-12 rounded-2xl px-6">
          {t("checkEmail.signIn")}
        </Link>
      </div>
    );
  }

  return (
    <form
      action={action}
      // With JavaScript on, submit without React's automatic form reset, so a rejected attempt keeps what was typed.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-5"
      data-testid="signup-form"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="plan" value={plan} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("fullName")} name="fullName" invalid={bad("fullName")}>
          <input id="fullName" name="fullName" required minLength={2} maxLength={120} autoComplete="name" className={inputClass} aria-invalid={bad("fullName")} />
        </Field>
        <Field label={t("businessName")} name="businessName" invalid={bad("businessName")}>
          <input id="businessName" name="businessName" required minLength={2} maxLength={120} autoComplete="organization" className={inputClass} aria-invalid={bad("businessName")} />
        </Field>
        <Field label={t("businessType")} name="businessType">
          <select id="businessType" name="businessType" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              {t("choose")}
            </option>
            {businessTypes.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("country")} name="country">
          <select id="country" name="country" required defaultValue="" className={inputClass} autoComplete="country-name">
            <option value="" disabled>
              {t("choose")}
            </option>
            {countries.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("phone")} name="phone" hint={t("optional")} invalid={bad("phone")}>
          <input id="phone" name="phone" type="tel" maxLength={40} autoComplete="tel" dir="ltr" className={`${inputClass} text-start`} aria-invalid={bad("phone")} />
        </Field>
        <Field label={t("currency")} name="currency" hint={t("currencyHint")}>
          <select id="currency" name="currency" required defaultValue={defaultCurrency} className={inputClass}>
            {Object.entries(groupCurrencies(currencies))
              .filter(([, codes]) => codes.length)
              .map(([group, codes]) => (
                <optgroup key={group} label={tHeader(group as "mena" | "international")}>
                  {codes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </Field>
      </div>

      {signedInEmail ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{t("signedInAs", { email: signedInEmail })}</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t("email")} name="email" invalid={bad("email")}>
              <input id="email" name="email" type="email" required autoComplete="email" dir="ltr" className={`${inputClass} text-start`} aria-invalid={bad("email")} />
            </Field>
          </div>
          <Field label={t("password")} name="password" hint={t("passwordHint")} invalid={bad("password")}>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              className={inputClass}
              aria-invalid={bad("password")}
            />
          </Field>
          <Field label={t("confirmPassword")} name="confirmPassword" invalid={bad("confirmPassword")}>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              className={inputClass}
              aria-invalid={bad("confirmPassword")}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
            {t("showPassword")}
          </label>
        </div>
      )}

      <label className="flex items-start gap-3 text-sm text-[#33415c]">
        <input type="checkbox" name="terms" required className="mt-0.5 h-4 w-4 accent-emerald-600" aria-invalid={bad("terms")} />
        <span>
          {t.rich("terms", {
            terms: (chunks) => (
              <Link href={`/${locale}/terms`} target="_blank" className="font-semibold text-emerald-700 underline">
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href={`/${locale}/privacy-policy`} target="_blank" className="font-semibold text-emerald-700 underline">
                {chunks}
              </Link>
            ),
          })}
        </span>
      </label>

      {state?.error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert" data-testid="signup-error">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="site-btn-primary site-focus h-14 rounded-2xl text-base disabled:opacity-60" data-testid="signup-submit">
        {pending ? t("creating") : t("submit")}
        {!pending && <SiteIcon name="arrowRight" size={18} className="rtl:rotate-180" />}
      </button>
      <p className="text-center text-sm text-slate-500">
        {t("haveAccount")}{" "}
        <Link href={`/${locale}/login`} className="font-semibold text-emerald-700 underline">
          {t("signIn")}
        </Link>
      </p>
    </form>
  );
}
