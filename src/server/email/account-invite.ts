import "server-only";

import { escapeHtml, type EmailLang, type RenderedEmail } from "@/server/email/subscription-templates";

/**
 * "Your account is ready" — sent from support@smartmanager.me to the owner of
 * a business the Super Admin created, with a one-time link to choose their
 * password (the set-password page).
 */

type Strings = { subject: string; hello: string; helloNamed: string; intro: string; button: string; fallback: string; once: string; footer: string };

const STRINGS: Record<EmailLang, Strings> = {
  en: {
    subject: "Your SmartManager AI Agent account is ready — {business}",
    hello: "Hello,",
    helloNamed: "Hello {name},",
    intro: "We have set up {business} on SmartManager AI Agent for you. Choose your password to sign in to your dashboard.",
    button: "Choose my password",
    fallback: "If the button doesn’t work, copy this link into your browser:",
    once: "This link can be used only once and expires after a short time. If it has expired, write to support@smartmanager.me and we will send a new one.",
    footer: "SmartManager AI Agent · Questions? Reply to this email or write to support@smartmanager.me.",
  },
  ar: {
    subject: "حسابك في SmartManager AI Agent جاهز — {business}",
    hello: "مرحبًا،",
    helloNamed: "مرحبًا {name}،",
    intro: "لقد أعددنا {business} على SmartManager AI Agent من أجلك. اختر كلمة المرور لتسجيل الدخول إلى لوحة التحكم.",
    button: "اختيار كلمة المرور",
    fallback: "إذا لم يعمل الزر، انسخ هذا الرابط في متصفحك:",
    once: "يمكن استخدام هذا الرابط مرة واحدة فقط، وتنتهي صلاحيته بعد مدة قصيرة. إذا انتهت صلاحيته، راسلنا على support@smartmanager.me وسنرسل لك رابطًا جديدًا.",
    footer: "SmartManager AI Agent · لديك سؤال؟ ردّ على هذه الرسالة أو راسلنا على support@smartmanager.me.",
  },
  fr: {
    subject: "Votre compte SmartManager AI Agent est prêt — {business}",
    hello: "Bonjour,",
    helloNamed: "Bonjour {name},",
    intro: "Nous avons créé {business} sur SmartManager AI Agent pour vous. Choisissez votre mot de passe pour accéder à votre tableau de bord.",
    button: "Choisir mon mot de passe",
    fallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
    once: "Ce lien ne peut être utilisé qu’une seule fois et expire au bout d’un certain temps. S’il a expiré, écrivez à support@smartmanager.me et nous vous en enverrons un nouveau.",
    footer: "SmartManager AI Agent · Une question ? Répondez à cet e-mail ou écrivez à support@smartmanager.me.",
  },
};

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

export function renderAccountInviteEmail(input: { lang: EmailLang; name: string; businessName: string; link: string }): RenderedEmail {
  const s = STRINGS[input.lang];
  const name = input.name.trim();
  const greeting = name ? fill(s.helloNamed, { name }) : s.hello;
  const subject = fill(s.subject, { business: input.businessName });
  const intro = fill(s.intro, { business: input.businessName });
  const text = [greeting, "", intro, "", `${s.button}: ${input.link}`, "", s.once, "", "—", s.footer].join("\n");

  const dir = input.lang === "ar" ? "rtl" : "ltr";
  const align = input.lang === "ar" ? "right" : "left";
  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="${input.lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;background:#ffffff;border-radius:12px;text-align:${align}">
<tr><td style="padding:24px 24px 8px;font-size:18px;font-weight:700;color:#0f172a">SmartManager AI Agent</td></tr>
<tr><td style="padding:8px 24px;font-size:15px;line-height:1.6;color:#0f172a">
<p style="margin:0 0 12px">${e(greeting)}</p>
<p style="margin:0 0 20px">${e(intro)}</p>
<p style="margin:0 0 20px"><a href="${e(input.link)}" style="display:inline-block;background:#0e8a5c;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">${e(s.button)}</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#64748b">${e(s.fallback)}</p>
<p style="margin:0 0 16px;font-size:12px;word-break:break-all" dir="ltr"><a href="${e(input.link)}" style="color:#0e8a5c">${e(input.link)}</a></p>
<p style="margin:0;font-size:13px;color:#64748b">${e(s.once)}</p>
</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;line-height:1.5;color:#64748b">${e(s.footer)}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  return { subject, html, text };
}
