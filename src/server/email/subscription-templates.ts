/**
 * The emails a subscriber receives about their subscription (queued by the
 * database — supabase/migrations/20261010100000_subscription_emails.sql —
 * and sent by ./subscription-queue.ts). Pure: tested in
 * tests/unit/subscription-emails.test.ts.
 *
 * Every email names the business, the plan, whether it is billed monthly or
 * annually and its price; a payment email also gives the amount received.
 * In the owner's language (English, Arabic — right to left — or French).
 */

export type EmailLang = "en" | "ar" | "fr";
export const EMAIL_LANGS: readonly EmailLang[] = ["en", "ar", "fr"];

export type SubscriptionEmailKind =
  | "trial_started"
  | "payment_received"
  | "upgraded"
  | "downgraded"
  | "cancel_scheduled"
  | "renewal_resumed"
  | "canceled"
  | "paused"
  | "payment_failed";

export type EmailPlan = {
  name: Record<string, string> | null;
  price_minor: number;
  currency: string;
  billing_interval: string;
  exponent?: number | null;
};

export type EmailSubscription = {
  plan_key?: string | null;
  status?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at?: string | null;
} | null;

export type SubscriptionEmailInput = {
  kind: SubscriptionEmailKind;
  details: Record<string, unknown>;
  lang: EmailLang;
  timezone: string | null;
  businessName: string;
  ownerName: string | null;
  plans: Record<string, EmailPlan>;
  subscription: EmailSubscription;
  billingUrl: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

type Copy = { subject: string; intro: string; note?: string };
type Strings = {
  hello: string;
  helloNamed: string;
  heading: string;
  business: string;
  plan: string;
  previousPlan: string;
  cycle: string;
  monthly: string;
  annual: string;
  price: string;
  perMonth: string;
  perYear: string;
  amountPaid: string;
  period: string;
  nextRenewal: string;
  trialEnds: string;
  activeUntil: string;
  endedOn: string;
  button: string;
  footer: string;
  kinds: Record<SubscriptionEmailKind, Copy>;
};

const STRINGS: Record<EmailLang, Strings> = {
  en: {
    hello: "Hello,",
    helloNamed: "Hello {name},",
    heading: "Subscription details",
    business: "Business",
    plan: "Plan",
    previousPlan: "Previous plan",
    cycle: "Billing cycle",
    monthly: "Monthly",
    annual: "Annual",
    price: "Price",
    perMonth: "{price} / month",
    perYear: "{price} / year",
    amountPaid: "Amount paid (excl. tax)",
    period: "Billing period",
    nextRenewal: "Next renewal",
    trialEnds: "Trial ends",
    activeUntil: "Active until",
    endedOn: "Ended on",
    button: "View billing",
    footer:
      "You are receiving this email because you own {business} on SmartManager AI Agent. Questions? Reply to this email or write to support@smartmanager.me.",
    kinds: {
      trial_started: {
        subject: "Your free trial has started — {business}",
        intro: "Welcome to SmartManager AI Agent! The free trial for {business} has started on the {plan} plan.",
        note: "To continue after the trial, subscribe from the Billing page.",
      },
      payment_received: {
        subject: "Payment received: {amount} — {business}",
        intro: "Thank you! We received your payment of {amount} for {business}. Your subscription is active.",
        note: "Paddle, our payment provider, sends the receipt with the tax details separately.",
      },
      upgraded: {
        subject: "Your plan was upgraded to {plan} — {business}",
        intro: "The subscription for {business} has been upgraded from {from} to {plan}.",
      },
      downgraded: {
        subject: "Your plan was downgraded to {plan} — {business}",
        intro: "The subscription for {business} has been changed from {from} to {plan}.",
      },
      cancel_scheduled: {
        subject: "Your subscription will end on {date} — {business}",
        intro: "The subscription for {business} has been cancelled. It stays active until {date} and will not renew.",
        note: "Changed your mind? You can resume it from the Billing page before then.",
      },
      renewal_resumed: {
        subject: "Your subscription will renew — {business}",
        intro: "The cancellation of the subscription for {business} was withdrawn. It will renew automatically.",
      },
      canceled: {
        subject: "Your subscription has ended — {business}",
        intro: "The subscription for {business} has ended.",
        note: "You can subscribe again at any time from the Billing page.",
      },
      paused: {
        subject: "Your subscription is paused — {business}",
        intro: "The subscription for {business} has been paused.",
        note: "To resume it, reply to this email and we will help.",
      },
      payment_failed: {
        subject: "Action needed: renewal payment failed — {business}",
        intro: "We couldn't collect the renewal payment for the subscription of {business}.",
        note: "Please update your payment method from the Billing page to keep your subscription active.",
      },
    },
  },
  ar: {
    hello: "مرحبًا،",
    helloNamed: "مرحبًا {name}،",
    heading: "تفاصيل الاشتراك",
    business: "النشاط التجاري",
    plan: "الباقة",
    previousPlan: "الباقة السابقة",
    cycle: "دورة الفوترة",
    monthly: "شهري",
    annual: "سنوي",
    price: "السعر",
    perMonth: "{price} / شهريًا",
    perYear: "{price} / سنويًا",
    amountPaid: "المبلغ المدفوع (قبل الضريبة)",
    period: "فترة الفوترة",
    nextRenewal: "التجديد القادم",
    trialEnds: "تنتهي التجربة في",
    activeUntil: "فعّال حتى",
    endedOn: "انتهى في",
    button: "عرض الفوترة",
    footer:
      "تصلك هذه الرسالة لأنك مالك {business} على SmartManager AI Agent. لديك أسئلة؟ رُدّ على هذه الرسالة أو راسلنا على support@smartmanager.me.",
    kinds: {
      trial_started: {
        subject: "بدأت تجربتك المجانية — {business}",
        intro: "مرحبًا بك في SmartManager AI Agent! بدأت التجربة المجانية لـ {business} على باقة {plan}.",
        note: "للاستمرار بعد انتهاء التجربة، اشترك من صفحة الفوترة.",
      },
      payment_received: {
        subject: "تم استلام الدفعة: {amount} — {business}",
        intro: "شكرًا لك! استلمنا دفعتك بقيمة {amount} لـ {business}. اشتراكك فعّال.",
        note: "يرسل Paddle، مزوّد الدفع لدينا، الإيصال مع تفاصيل الضريبة بشكل منفصل.",
      },
      upgraded: {
        subject: "تمت ترقية باقتك إلى {plan} — {business}",
        intro: "تمت ترقية اشتراك {business} من باقة {from} إلى باقة {plan}.",
      },
      downgraded: {
        subject: "تم تخفيض باقتك إلى {plan} — {business}",
        intro: "تم تغيير اشتراك {business} من باقة {from} إلى باقة {plan}.",
      },
      cancel_scheduled: {
        subject: "سينتهي اشتراكك في {date} — {business}",
        intro: "تم إلغاء اشتراك {business}. يبقى فعّالًا حتى {date} ولن يتجدد.",
        note: "غيّرت رأيك؟ يمكنك استئنافه من صفحة الفوترة قبل ذلك التاريخ.",
      },
      renewal_resumed: {
        subject: "سيتجدد اشتراكك — {business}",
        intro: "تم التراجع عن إلغاء اشتراك {business}، وسيتجدد تلقائيًا.",
      },
      canceled: {
        subject: "انتهى اشتراكك — {business}",
        intro: "انتهى اشتراك {business}.",
        note: "يمكنك الاشتراك مجددًا في أي وقت من صفحة الفوترة.",
      },
      paused: {
        subject: "تم إيقاف اشتراكك مؤقتًا — {business}",
        intro: "تم إيقاف اشتراك {business} مؤقتًا.",
        note: "لاستئنافه، رُدّ على هذه الرسالة وسنساعدك.",
      },
      payment_failed: {
        subject: "إجراء مطلوب: تعذّر تحصيل دفعة التجديد — {business}",
        intro: "تعذّر علينا تحصيل دفعة تجديد اشتراك {business}.",
        note: "يُرجى تحديث وسيلة الدفع من صفحة الفوترة للحفاظ على اشتراكك فعّالًا.",
      },
    },
  },
  fr: {
    hello: "Bonjour,",
    helloNamed: "Bonjour {name},",
    heading: "Détails de l'abonnement",
    business: "Entreprise",
    plan: "Formule",
    previousPlan: "Formule précédente",
    cycle: "Cycle de facturation",
    monthly: "Mensuel",
    annual: "Annuel",
    price: "Prix",
    perMonth: "{price} / mois",
    perYear: "{price} / an",
    amountPaid: "Montant payé (hors taxes)",
    period: "Période de facturation",
    nextRenewal: "Prochain renouvellement",
    trialEnds: "Fin de l'essai",
    activeUntil: "Actif jusqu'au",
    endedOn: "Terminé le",
    button: "Voir la facturation",
    footer:
      "Vous recevez cet e-mail car vous êtes propriétaire de {business} sur SmartManager AI Agent. Des questions ? Répondez à cet e-mail ou écrivez à support@smartmanager.me.",
    kinds: {
      trial_started: {
        subject: "Votre essai gratuit a commencé — {business}",
        intro: "Bienvenue sur SmartManager AI Agent ! L'essai gratuit de {business} a commencé avec la formule {plan}.",
        note: "Pour continuer après l'essai, abonnez-vous depuis la page Facturation.",
      },
      payment_received: {
        subject: "Paiement reçu : {amount} — {business}",
        intro: "Merci ! Nous avons bien reçu votre paiement de {amount} pour {business}. Votre abonnement est actif.",
        note: "Paddle, notre prestataire de paiement, vous envoie séparément le reçu avec le détail des taxes.",
      },
      upgraded: {
        subject: "Formule améliorée : {plan} — {business}",
        intro: "L'abonnement de {business} est passé de la formule {from} à la formule {plan}.",
      },
      downgraded: {
        subject: "Formule réduite : {plan} — {business}",
        intro: "L'abonnement de {business} est passé de la formule {from} à la formule {plan}.",
      },
      cancel_scheduled: {
        subject: "Votre abonnement prendra fin le {date} — {business}",
        intro: "L'abonnement de {business} a été résilié. Il reste actif jusqu'au {date} et ne sera pas renouvelé.",
        note: "Vous avez changé d'avis ? Vous pouvez le réactiver depuis la page Facturation d'ici là.",
      },
      renewal_resumed: {
        subject: "Votre abonnement sera renouvelé — {business}",
        intro: "La résiliation de l'abonnement de {business} a été annulée. Il sera renouvelé automatiquement.",
      },
      canceled: {
        subject: "Votre abonnement a pris fin — {business}",
        intro: "L'abonnement de {business} a pris fin.",
        note: "Vous pouvez vous réabonner à tout moment depuis la page Facturation.",
      },
      paused: {
        subject: "Votre abonnement est en pause — {business}",
        intro: "L'abonnement de {business} a été mis en pause.",
        note: "Pour le reprendre, répondez à cet e-mail et nous vous aiderons.",
      },
      payment_failed: {
        subject: "Action requise : échec du paiement de renouvellement — {business}",
        intro: "Nous n'avons pas pu encaisser le paiement de renouvellement de l'abonnement de {business}.",
        note: "Mettez à jour votre moyen de paiement depuis la page Facturation pour garder votre abonnement actif.",
      },
    },
  },
};

/** The email's language: the owner's, else the business's, else English. */
export function emailLanguage(...candidates: (string | null | undefined)[]): EmailLang {
  for (const c of candidates) {
    const lang = c?.slice(0, 2).toLowerCase();
    if (lang && (EMAIL_LANGS as readonly string[]).includes(lang)) return lang as EmailLang;
  }
  return "en";
}

/** A name stored in several languages, in the email's language when there is one. */
export function localized(value: unknown, lang: EmailLang): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const names = value as Record<string, unknown>;
  for (const key of [lang, "en", ...Object.keys(names)]) {
    const v = names[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function fractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatAmount(amountMinor: number, currency: string, lang: EmailLang, exponent?: number | null): string {
  const digits = exponent ?? fractionDigits(currency);
  const amount = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat(lang === "ar" ? "ar-u-nu-latn" : lang, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

export function formatDate(value: unknown, lang: EmailLang, timezone: string | null): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const locale = lang === "ar" ? "ar-u-nu-latn" : lang;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: timezone || "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function renderSubscriptionEmail(input: SubscriptionEmailInput): RenderedEmail {
  const { kind, details, lang, timezone, plans, subscription } = input;
  const s = STRINGS[lang];
  const copy = s.kinds[kind];
  const date = (v: unknown) => formatDate(v, lang, timezone);

  const planKey = str(details.plan_key) ?? subscription?.plan_key ?? null;
  const plan = planKey ? plans[planKey] : undefined;
  const planName = (key: string | null, p: EmailPlan | undefined) => localized(p?.name, lang) || key || "—";
  const cycleOf = (p: EmailPlan | undefined) => (p?.billing_interval === "year" ? s.annual : s.monthly);
  const priceOf = (p: EmailPlan) =>
    fill(p.billing_interval === "year" ? s.perYear : s.perMonth, { price: formatAmount(p.price_minor, p.currency, lang, p.exponent) });

  const fromKey = str(details.from_plan);
  const fromPlan = fromKey ? plans[fromKey] : undefined;
  const amount =
    typeof details.amount_minor === "number" && str(details.currency)
      ? formatAmount(details.amount_minor, details.currency as string, lang, plan && plan.currency === details.currency ? plan.exponent : null)
      : null;

  const values: Record<string, string> = {
    business: input.businessName,
    plan: planName(planKey, plan),
    from: planName(fromKey, fromPlan),
    amount: amount ?? "",
    date: date(details.cancel_at) ?? "",
  };

  const rows: [string, string][] = [];
  if (kind === "payment_received" && amount) rows.push([s.amountPaid, amount]);
  rows.push([s.business, input.businessName]);
  if (fromKey && (kind === "upgraded" || kind === "downgraded")) rows.push([s.previousPlan, `${values.from} (${cycleOf(fromPlan)})`]);
  rows.push([s.plan, values.plan]);
  // Always: monthly or annual.
  rows.push([s.cycle, cycleOf(plan)]);
  if (plan) rows.push([s.price, priceOf(plan)]);

  const periodEnd = str(details.current_period_end) ?? subscription?.current_period_end ?? null;
  const renews = subscription?.status === "active" && !subscription.cancel_at;
  switch (kind) {
    case "trial_started": {
      const ends = date(details.trial_ends_at);
      if (ends) rows.push([s.trialEnds, ends]);
      break;
    }
    case "payment_received": {
      const start = date(subscription?.current_period_start);
      const end = date(subscription?.current_period_end);
      if (start && end) rows.push([s.period, `${start} – ${end}`]);
      if (renews && end) rows.push([s.nextRenewal, end]);
      break;
    }
    case "upgraded":
    case "downgraded":
    case "renewal_resumed": {
      const end = date(periodEnd);
      if (end && (renews || kind === "renewal_resumed")) rows.push([s.nextRenewal, end]);
      break;
    }
    case "cancel_scheduled":
      if (values.date) rows.push([s.activeUntil, values.date]);
      break;
    case "canceled": {
      const ended = date(details.ended_at);
      if (ended) rows.push([s.endedOn, ended]);
      break;
    }
    default:
      break;
  }

  const subject = fill(copy.subject, values);
  const greeting = input.ownerName?.trim() ? fill(s.helloNamed, { name: input.ownerName.trim() }) : s.hello;
  const intro = fill(copy.intro, values);
  const note = copy.note ? fill(copy.note, values) : null;
  const footer = fill(s.footer, values);

  const text = [
    greeting,
    "",
    intro,
    "",
    `${s.heading}:`,
    ...rows.map(([label, value]) => `- ${label}: ${value}`),
    ...(note ? ["", note] : []),
    "",
    `${s.button}: ${input.billingUrl}`,
    "",
    "—",
    footer,
  ].join("\n");

  const dir = lang === "ar" ? "rtl" : "ltr";
  const align = lang === "ar" ? "right" : "left";
  const e = escapeHtml;
  const rowHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;white-space:nowrap">${e(label)}</td>` +
        `<td style="padding:8px 12px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0">${e(value)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;background:#ffffff;border-radius:12px;text-align:${align}">
<tr><td style="padding:24px 24px 8px;font-size:18px;font-weight:700;color:#0f172a">SmartManager AI Agent</td></tr>
<tr><td style="padding:8px 24px;font-size:15px;line-height:1.6;color:#0f172a">
<p style="margin:0 0 12px">${e(greeting)}</p>
<p style="margin:0 0 16px">${e(intro)}</p>
<p style="margin:0 0 8px;font-weight:700">${e(s.heading)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;font-size:14px;text-align:${align}">${rowHtml}</table>
${note ? `<p style="margin:16px 0 0">${e(note)}</p>` : ""}
<p style="margin:24px 0 8px"><a href="${e(input.billingUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${e(s.button)}</a></p>
</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;line-height:1.5;color:#64748b">${e(footer)}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  return { subject, html, text };
}
