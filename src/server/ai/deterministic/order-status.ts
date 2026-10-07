/**
 * "What's the status of my order #1170?" — answered from the order itself,
 * with no AI call (the Agent's "Track the order" button asks exactly this).
 * Pure helpers; `gateway.ts` looks the order up, within the business only.
 */
import { detectLang } from "./catalog";

type Lang = ReturnType<typeof detectLang>;

// An order number, after "#" or "n°"/"no"/"رقم" (or the order word itself).
const ORDER_NUMBER = /(?:#|n°|nº|no\.?|numéro|number|رقم)\s*(\d{1,9})\b|(?:order|commande|طلب|طلبي)\s+(\d{1,9})\b/iu;
const ASKS_STATUS =
  /\b(status|track|tracking|where(?:'s| is)|ready|state)\b|\b(état|suivi|suivre|où en est|prête?)\b|(حالة|تتبع|وين|أين|جاهز)/iu;
const ORDER_WORD = /\b(order|commande)\b|(طلب)/iu;

/** The order number a status question is about, or null when the message isn't one. */
export function orderStatusQuestion(message: string): number | null {
  if (!ASKS_STATUS.test(message) || !ORDER_WORD.test(message)) return null;
  const m = message.match(ORDER_NUMBER);
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const STATUS: Record<Lang, Record<string, string>> = {
  en: {
    draft: "not placed yet",
    pending_payment: "waiting for payment",
    paid: "paid — waiting for the business to confirm it",
    confirmed: "confirmed",
    preparing: "being prepared",
    prepared: "prepared",
    ready: "ready",
    collected: "collected",
    served: "served",
    out_for_delivery: "out for delivery",
    delivered: "delivered",
    completed: "completed",
    cancelled: "cancelled",
    refunded: "refunded",
  },
  ar: {
    draft: "لم يُرسل بعد",
    pending_payment: "بانتظار الدفع",
    paid: "مدفوع — بانتظار تأكيد المتجر",
    confirmed: "مؤكد",
    preparing: "قيد التحضير",
    prepared: "تم تحضيره",
    ready: "جاهز",
    collected: "تم استلامه",
    served: "تم تقديمه",
    out_for_delivery: "في الطريق إليك",
    delivered: "تم توصيله",
    completed: "مكتمل",
    cancelled: "ملغى",
    refunded: "مسترد",
  },
  fr: {
    draft: "pas encore passée",
    pending_payment: "en attente de paiement",
    paid: "payée — en attente de confirmation par le commerce",
    confirmed: "confirmée",
    preparing: "en préparation",
    prepared: "préparée",
    ready: "prête",
    collected: "retirée",
    served: "servie",
    out_for_delivery: "en cours de livraison",
    delivered: "livrée",
    completed: "terminée",
    cancelled: "annulée",
    refunded: "remboursée",
  },
};

/** The reply, in the customer's language; null order → not found. */
export function orderStatusReply(
  orderNumber: number,
  order: { status: string; totalMinor: number; currency: string; exponent: number } | null,
  lang: Lang,
): string {
  if (!order) {
    return {
      en: `I couldn't find order #${orderNumber}. Please check the number.`,
      ar: `لم أجد الطلب رقم #${orderNumber}. يرجى التحقق من الرقم.`,
      fr: `Je ne trouve pas la commande n°${orderNumber}. Merci de vérifier le numéro.`,
    }[lang];
  }
  const status = STATUS[lang][order.status] ?? order.status.replace(/_/g, " ");
  const total = `${(order.totalMinor / 10 ** order.exponent).toFixed(order.exponent)} ${order.currency.trim()}`;
  return {
    en: `Order #${orderNumber} is ${status}. Total: ${total}.`,
    ar: `الطلب رقم #${orderNumber}: ${status}. الإجمالي: ${total}.`,
    fr: `La commande n°${orderNumber} est ${status}. Total : ${total}.`,
  }[lang];
}
