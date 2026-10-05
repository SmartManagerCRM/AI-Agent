import "server-only";

import { escapeHtml, type EmailLang, type RenderedEmail } from "@/server/email/subscription-templates";

/**
 * The "confirm your email" message sent when someone signs up on the website,
 * from support@smartmanager.me like the other account emails (Supabase's own
 * mailer is not used for it — see src/server/site/signup-actions.ts).
 */

type Strings = {
  subject: string;
  hello: string;
  helloNamed: string;
  intro: string;
  button: string;
  fallback: string;
  expiry: string;
  ignore: string;
  footer: string;
};

const STRINGS: Record<EmailLang, Strings> = {
  en: {
    subject: "Confirm your email — SmartManager AI Agent",
    hello: "Hello,",
    helloNamed: "Hello {name},",
    intro:
      "Thanks for signing up for SmartManager AI Agent. Confirm your email address to finish setting up {business} and start your free trial.",
    button: "Confirm my email",
    fallback: "If the button doesn’t work, copy this link into your browser:",
    expiry: "This link can be used only once and expires after a short time.",
    ignore: "Didn’t sign up? You can ignore this email — no account will be activated.",
    footer: "SmartManager AI Agent · Questions? Reply to this email or write to support@smartmanager.me.",
  },
  ar: {
    subject: "أكّد بريدك الإلكتروني — SmartManager AI Agent",
    hello: "مرحبًا،",
    helloNamed: "مرحبًا {name}،",
    intro:
      "شكرًا لتسجيلك في SmartManager AI Agent. أكّد عنوان بريدك الإلكتروني لإكمال إعداد {business} وبدء تجربتك المجانية.",
    button: "تأكيد بريدي الإلكتروني",
    fallback: "إذا لم يعمل الزر، انسخ هذا الرابط في متصفحك:",
    expiry: "يمكن استخدام هذا الرابط مرة واحدة فقط، وتنتهي صلاحيته بعد مدة قصيرة.",
    ignore: "لم تقم بالتسجيل؟ يمكنك تجاهل هذه الرسالة — لن يُفعَّل أي حساب.",
    footer: "SmartManager AI Agent · لديك سؤال؟ ردّ على هذه الرسالة أو راسلنا على support@smartmanager.me.",
  },
  fr: {
    subject: "Confirmez votre e-mail — SmartManager AI Agent",
    hello: "Bonjour,",
    helloNamed: "Bonjour {name},",
    intro:
      "Merci de votre inscription à SmartManager AI Agent. Confirmez votre adresse e-mail pour terminer la création de {business} et démarrer votre essai gratuit.",
    button: "Confirmer mon e-mail",
    fallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
    expiry: "Ce lien ne peut être utilisé qu’une seule fois et expire au bout d’un certain temps.",
    ignore: "Vous ne vous êtes pas inscrit ? Ignorez cet e-mail — aucun compte ne sera activé.",
    footer: "SmartManager AI Agent · Une question ? Répondez à cet e-mail ou écrivez à support@smartmanager.me.",
  },
};

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

export function renderSignupConfirmationEmail(input: {
  lang: EmailLang;
  name: string;
  businessName: string;
  link: string;
}): RenderedEmail {
  const s = STRINGS[input.lang];
  const name = input.name.trim();
  const greeting = name ? fill(s.helloNamed, { name }) : s.hello;
  const intro = fill(s.intro, { business: input.businessName.trim() || "SmartManager" });

  const text = [greeting, "", intro, "", `${s.button}: ${input.link}`, "", s.expiry, s.ignore, "", "—", s.footer].join(
    "\n",
  );

  const dir = input.lang === "ar" ? "rtl" : "ltr";
  const align = input.lang === "ar" ? "right" : "left";
  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="${input.lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(s.subject)}</title></head>
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
<p style="margin:0 0 6px;font-size:13px;color:#64748b">${e(s.expiry)}</p>
<p style="margin:0;font-size:13px;color:#64748b">${e(s.ignore)}</p>
</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;line-height:1.5;color:#64748b">${e(s.footer)}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  return { subject: s.subject, html, text };
}
