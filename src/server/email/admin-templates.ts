import "server-only";

import { escapeHtml, type EmailLang, type RenderedEmail } from "@/server/email/subscription-templates";

/**
 * The Super Admins' "new subscriber" email (subscription_emails kind
 * new_subscriber_admin), sent from support@smartmanager.me as soon as a
 * business signs up, in each Super Admin's own language.
 */

type Strings = {
  subject: string;
  intro: string;
  rows: {
    business: string;
    owner: string;
    email: string;
    plan: string;
    cycle: string;
    status: string;
    trialEnds: string;
    country: string;
    phone: string;
    type: string;
  };
  monthly: string;
  annual: string;
  trialing: string;
  active: string;
  button: string;
  footer: string;
};

const STRINGS: Record<EmailLang, Strings> = {
  en: {
    subject: "New subscriber: {business}",
    intro: "A new business has just signed up for SmartManager AI Agent.",
    rows: {
      business: "Business",
      owner: "Owner",
      email: "Email",
      plan: "Plan",
      cycle: "Billing cycle",
      status: "Status",
      trialEnds: "Trial ends",
      country: "Country",
      phone: "Phone",
      type: "Business type",
    },
    monthly: "Monthly",
    annual: "Annual",
    trialing: "Free trial",
    active: "Active",
    button: "Open in Super Admin",
    footer: "Sent to SmartManager AI Agent Super Admins.",
  },
  ar: {
    subject: "مشترك جديد: {business}",
    intro: "سجّل نشاط تجاري جديد للتو في SmartManager AI Agent.",
    rows: {
      business: "النشاط التجاري",
      owner: "المالك",
      email: "البريد الإلكتروني",
      plan: "الخطة",
      cycle: "دورة الفوترة",
      status: "الحالة",
      trialEnds: "نهاية التجربة",
      country: "الدولة",
      phone: "الهاتف",
      type: "نوع النشاط",
    },
    monthly: "شهري",
    annual: "سنوي",
    trialing: "تجربة مجانية",
    active: "نشط",
    button: "فتح في لوحة المشرف العام",
    footer: "أُرسلت إلى المشرفين العامين لـ SmartManager AI Agent.",
  },
  fr: {
    subject: "Nouvel abonné : {business}",
    intro: "Une nouvelle entreprise vient de s’inscrire à SmartManager AI Agent.",
    rows: {
      business: "Entreprise",
      owner: "Propriétaire",
      email: "E-mail",
      plan: "Formule",
      cycle: "Facturation",
      status: "Statut",
      trialEnds: "Fin de l’essai",
      country: "Pays",
      phone: "Téléphone",
      type: "Type d’activité",
    },
    monthly: "Mensuelle",
    annual: "Annuelle",
    trialing: "Essai gratuit",
    active: "Active",
    button: "Ouvrir dans le Super Admin",
    footer: "Envoyé aux Super Admins de SmartManager AI Agent.",
  },
};

export type NewSubscriberAdminInput = {
  lang: EmailLang;
  businessName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  planName: string;
  annual: boolean;
  status: string;
  trialEnds: string | null;
  country: string | null;
  phone: string | null;
  businessType: string | null;
  adminUrl: string;
};

export function renderNewSubscriberAdminEmail(input: NewSubscriberAdminInput): RenderedEmail {
  const s = STRINGS[input.lang];
  const subject = s.subject.replace("{business}", input.businessName);
  const rows: [string, string][] = [[s.rows.business, input.businessName]];
  if (input.ownerName) rows.push([s.rows.owner, input.ownerName]);
  if (input.ownerEmail) rows.push([s.rows.email, input.ownerEmail]);
  if (input.businessType) rows.push([s.rows.type, input.businessType]);
  rows.push([s.rows.plan, input.planName]);
  rows.push([s.rows.cycle, input.annual ? s.annual : s.monthly]);
  rows.push([
    s.rows.status,
    input.status === "trialing" ? s.trialing : input.status === "active" ? s.active : input.status,
  ]);
  if (input.trialEnds) rows.push([s.rows.trialEnds, input.trialEnds]);
  if (input.country) rows.push([s.rows.country, input.country]);
  if (input.phone) rows.push([s.rows.phone, input.phone]);

  const text = [
    s.intro,
    "",
    ...rows.map(([k, v]) => `- ${k}: ${v}`),
    "",
    `${s.button}: ${input.adminUrl}`,
    "",
    "—",
    s.footer,
  ].join("\n");

  const dir = input.lang === "ar" ? "rtl" : "ltr";
  const align = input.lang === "ar" ? "right" : "left";
  const e = escapeHtml;
  const rowHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;white-space:nowrap">${e(label)}</td>` +
        `<td style="padding:8px 12px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0">${e(value)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="${input.lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;background:#ffffff;border-radius:12px;text-align:${align}">
<tr><td style="padding:24px 24px 8px;font-size:18px;font-weight:700;color:#0f172a">SmartManager AI Agent</td></tr>
<tr><td style="padding:8px 24px;font-size:15px;line-height:1.6;color:#0f172a">
<p style="margin:0 0 16px">🔔 ${e(s.intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;font-size:14px;text-align:${align}">${rowHtml}</table>
<p style="margin:24px 0 8px"><a href="${e(input.adminUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${e(s.button)}</a></p>
</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;line-height:1.5;color:#64748b">${e(s.footer)}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  return { subject, html, text };
}
