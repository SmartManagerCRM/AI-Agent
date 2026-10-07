"use server";

import { z } from "zod";

import { parseQuestion, periodRange, zonedStart, type AskLang, type Intent, type Period } from "@/lib/assistant/intents";
import { EXPIRING_DAYS } from "@/lib/membership-state";
import { formatMoney } from "@/lib/money";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { businessToday, resolveTimeZone } from "@/lib/timezone";

/**
 * Ask SmartManager (console dashboard). STRICTLY no AI: the question is
 * matched to a known topic (src/lib/assistant/intents.ts) and answered from
 * the business's own data with the signed-in member's own permissions
 * (RLS). Nothing here calls a model, so an answer costs nothing.
 */
export type AskAnswer = { lang: AskLang; intent: Intent; lines: string[]; links: { label: string; href: string }[] };

const schema = z.object({ locale: z.string(), slug: z.string().min(1), question: z.string().trim().min(1).max(300) });

const PERIOD_NAME: Record<AskLang, Record<Period, string>> = {
  en: { today: "today", yesterday: "yesterday", week: "this week", last7: "in the last 7 days", month: "this month", lastMonth: "last month", last30: "in the last 30 days", year: "this year", all: "since you started" },
  ar: { today: "اليوم", yesterday: "أمس", week: "هذا الأسبوع", last7: "في آخر 7 أيام", month: "هذا الشهر", lastMonth: "الشهر الماضي", last30: "في آخر 30 يومًا", year: "هذا العام", all: "منذ البداية" },
  fr: { today: "aujourd'hui", yesterday: "hier", week: "cette semaine", last7: "ces 7 derniers jours", month: "ce mois-ci", lastMonth: "le mois dernier", last30: "ces 30 derniers jours", year: "cette année", all: "depuis le début" },
};

const T = {
  en: {
    sales: (p: string, v: string, n: number) => `Sales ${p}: ${v} from ${n} paid or confirmed order${n === 1 ? "" : "s"}.`,
    orders: (p: string, n: number) => `Orders ${p}: ${n}.`,
    byStatus: (s: string) => `By status — ${s}.`,
    aov: (p: string, v: string) => `Average order value ${p}: ${v}.`,
    noOrders: (p: string) => `No orders ${p}.`,
    top: (p: string) => `Best sellers ${p}:`,
    topLine: (i: number, name: string, q: number, v: string) => `${i}. ${name} — ${q} sold (${v})`,
    customers: (p: string, n: number, k: number) => `Customers ${p}: ${n} (${k} new).`,
    newCustomers: (p: string, n: number) => `New customers ${p}: ${n}.`,
    pending: (a: number, b: number, c: number, d: number) => `Open orders: ${a} awaiting payment, ${b} to prepare, ${c} being prepared, ${d} ready.`,
    bookings: (p: string, n: number) => `Bookings ${p}: ${n}.`,
    upcoming: "Next bookings:",
    noUpcoming: "No upcoming bookings.",
    members: (a: number, e: number, u: number, v: number) => `Current members: ${a}. Renewing within ${EXPIRING_DAYS} days: ${e}. Unpaid: ${u}. Check-ins today: ${v}.`,
    expiring: (n: number) => (n ? `Renewing within ${EXPIRING_DAYS} days (${n}):` : `No memberships renew within ${EXPIRING_DAYS} days.`),
    overdue: (n: number) => `Past their renewal date: ${n}.`,
    conversations: (p: string, n: number, o: number) => `Conversations ${p}: ${n}. Open now: ${o}.`,
    leads: (p: string, n: number, o: number) => `Leads ${p}: ${n}. Still new: ${o}.`,
    products: (a: number, s: number, d: number, sv: number) => `Products on sale: ${a}. Suspended: ${s}. Waiting for a price/approval: ${d}. Bookable services: ${sv}.`,
    agentLive: "Your Agent is LIVE — customers can open it now.",
    agentPaused: "Your Agent is PAUSED — customers can't reach it until you resume it.",
    agentNot: "Your Agent is not live yet — publish it from Business Brain → Go live.",
    hours: "Opening hours:",
    noHours: "No opening hours set — add them in Branches.",
    closed: "closed",
    help: "I answer from your own data, free (no AI). Try:",
    unknown: "I can only answer questions about your business data (no AI). Try:",
    examples: ["Sales today", "Orders this week", "Best sellers this month", "Pending orders", "Bookings today", "Members renewing soon", "Average order value last 30 days", "Is my Agent live?"],
    links: { analytics: "Open Analytics", orders: "Open Orders", bookings: "Open Bookings", memberships: "Open Memberships", conversations: "Open Conversations", leads: "Open Leads", products: "Open Products", agent: "Open Agent", branches: "Open Branches", customers: "Open Customers" },
    days: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
    status: { pending_payment: "awaiting payment", paid: "paid", confirmed: "confirmed", preparing: "preparing", prepared: "prepared", ready: "ready", collected: "collected", served: "served", out_for_delivery: "out for delivery", delivered: "delivered", completed: "completed", cancelled: "cancelled", refunded: "refunded" },
  },
  ar: {
    sales: (p: string, v: string, n: number) => `المبيعات ${p}: ${v} من ${n} طلب مدفوع أو مؤكد.`,
    orders: (p: string, n: number) => `الطلبات ${p}: ${n}.`,
    byStatus: (s: string) => `حسب الحالة — ${s}.`,
    aov: (p: string, v: string) => `متوسط قيمة الطلب ${p}: ${v}.`,
    noOrders: (p: string) => `لا توجد طلبات ${p}.`,
    top: (p: string) => `الأكثر مبيعًا ${p}:`,
    topLine: (i: number, name: string, q: number, v: string) => `${i}. ${name} — ${q} مبيعة (${v})`,
    customers: (p: string, n: number, k: number) => `العملاء ${p}: ${n} (${k} جدد).`,
    newCustomers: (p: string, n: number) => `العملاء الجدد ${p}: ${n}.`,
    pending: (a: number, b: number, c: number, d: number) => `الطلبات المفتوحة: ${a} بانتظار الدفع، ${b} للتحضير، ${c} قيد التحضير، ${d} جاهزة.`,
    bookings: (p: string, n: number) => `الحجوزات ${p}: ${n}.`,
    upcoming: "الحجوزات القادمة:",
    noUpcoming: "لا توجد حجوزات قادمة.",
    members: (a: number, e: number, u: number, v: number) => `الأعضاء الحاليون: ${a}. يتجدد خلال ${EXPIRING_DAYS} أيام: ${e}. غير مدفوع: ${u}. تسجيلات الحضور اليوم: ${v}.`,
    expiring: (n: number) => (n ? `يتجدد خلال ${EXPIRING_DAYS} أيام (${n}):` : `لا توجد عضويات تتجدد خلال ${EXPIRING_DAYS} أيام.`),
    overdue: (n: number) => `تجاوزت تاريخ التجديد: ${n}.`,
    conversations: (p: string, n: number, o: number) => `المحادثات ${p}: ${n}. المفتوحة الآن: ${o}.`,
    leads: (p: string, n: number, o: number) => `العملاء المحتملون ${p}: ${n}. ما زالوا جددًا: ${o}.`,
    products: (a: number, s: number, d: number, sv: number) => `المنتجات المعروضة: ${a}. الموقوفة: ${s}. بانتظار سعر/موافقة: ${d}. الخدمات القابلة للحجز: ${sv}.`,
    agentLive: "وكيلك مباشر الآن — يمكن للعملاء فتحه.",
    agentPaused: "وكيلك متوقف مؤقتًا — لا يمكن للعملاء الوصول إليه حتى تستأنفه.",
    agentNot: "وكيلك غير منشور بعد — انشره من عقل النشاط ← النشر.",
    hours: "ساعات العمل:",
    noHours: "لم يتم تحديد ساعات العمل — أضفها في الفروع.",
    closed: "مغلق",
    help: "أجيب من بياناتك مجانًا (بدون ذكاء اصطناعي). جرّب:",
    unknown: "أجيب فقط عن بيانات نشاطك (بدون ذكاء اصطناعي). جرّب:",
    examples: ["مبيعات اليوم", "طلبات هذا الأسبوع", "الأكثر مبيعًا هذا الشهر", "الطلبات المعلقة", "حجوزات اليوم", "العضويات التي تنتهي قريبًا", "هل الوكيل مباشر؟"],
    links: { analytics: "فتح التحليلات", orders: "فتح الطلبات", bookings: "فتح الحجوزات", memberships: "فتح العضويات", conversations: "فتح المحادثات", leads: "فتح العملاء المحتملين", products: "فتح المنتجات", agent: "فتح الوكيل", branches: "فتح الفروع", customers: "فتح العملاء" },
    days: { mon: "الإثنين", tue: "الثلاثاء", wed: "الأربعاء", thu: "الخميس", fri: "الجمعة", sat: "السبت", sun: "الأحد" },
    status: { pending_payment: "بانتظار الدفع", paid: "مدفوع", confirmed: "مؤكد", preparing: "قيد التحضير", prepared: "تم التحضير", ready: "جاهز", collected: "تم الاستلام", served: "تم التقديم", out_for_delivery: "قيد التوصيل", delivered: "تم التوصيل", completed: "مكتمل", cancelled: "ملغي", refunded: "مسترد" },
  },
  fr: {
    sales: (p: string, v: string, n: number) => `Ventes ${p} : ${v} sur ${n} commande${n > 1 ? "s" : ""} payée${n > 1 ? "s" : ""} ou confirmée${n > 1 ? "s" : ""}.`,
    orders: (p: string, n: number) => `Commandes ${p} : ${n}.`,
    byStatus: (s: string) => `Par statut — ${s}.`,
    aov: (p: string, v: string) => `Panier moyen ${p} : ${v}.`,
    noOrders: (p: string) => `Aucune commande ${p}.`,
    top: (p: string) => `Meilleures ventes ${p} :`,
    topLine: (i: number, name: string, q: number, v: string) => `${i}. ${name} — ${q} vendu(s) (${v})`,
    customers: (p: string, n: number, k: number) => `Clients ${p} : ${n} (${k} nouveaux).`,
    newCustomers: (p: string, n: number) => `Nouveaux clients ${p} : ${n}.`,
    pending: (a: number, b: number, c: number, d: number) => `Commandes en cours : ${a} en attente de paiement, ${b} à préparer, ${c} en préparation, ${d} prêtes.`,
    bookings: (p: string, n: number) => `Réservations ${p} : ${n}.`,
    upcoming: "Prochaines réservations :",
    noUpcoming: "Aucune réservation à venir.",
    members: (a: number, e: number, u: number, v: number) => `Abonnés actuels : ${a}. Renouvellement sous ${EXPIRING_DAYS} jours : ${e}. Impayés : ${u}. Passages aujourd'hui : ${v}.`,
    expiring: (n: number) => (n ? `Renouvellement sous ${EXPIRING_DAYS} jours (${n}) :` : `Aucun abonnement à renouveler sous ${EXPIRING_DAYS} jours.`),
    overdue: (n: number) => `Date de renouvellement dépassée : ${n}.`,
    conversations: (p: string, n: number, o: number) => `Conversations ${p} : ${n}. Ouvertes maintenant : ${o}.`,
    leads: (p: string, n: number, o: number) => `Prospects ${p} : ${n}. Encore nouveaux : ${o}.`,
    products: (a: number, s: number, d: number, sv: number) => `Produits en vente : ${a}. Suspendus : ${s}. En attente de prix/validation : ${d}. Services réservables : ${sv}.`,
    agentLive: "Votre Agent est EN LIGNE — les clients peuvent l'ouvrir.",
    agentPaused: "Votre Agent est EN PAUSE — les clients n'y ont pas accès tant que vous ne le relancez pas.",
    agentNot: "Votre Agent n'est pas encore en ligne — publiez-le depuis Business Brain → Mise en ligne.",
    hours: "Horaires d'ouverture :",
    noHours: "Aucun horaire défini — ajoutez-les dans Succursales.",
    closed: "fermé",
    help: "Je réponds à partir de vos données, gratuitement (sans IA). Essayez :",
    unknown: "Je réponds uniquement sur les données de votre activité (sans IA). Essayez :",
    examples: ["Ventes aujourd'hui", "Commandes cette semaine", "Meilleures ventes ce mois", "Commandes en attente", "Réservations aujourd'hui", "Abonnements à renouveler", "Mon Agent est-il en ligne ?"],
    links: { analytics: "Ouvrir Analytique", orders: "Ouvrir Commandes", bookings: "Ouvrir Réservations", memberships: "Ouvrir Abonnements", conversations: "Ouvrir Conversations", leads: "Ouvrir Prospects", products: "Ouvrir Produits", agent: "Ouvrir Agent", branches: "Ouvrir Succursales", customers: "Ouvrir Clients" },
    days: { mon: "Lun", tue: "Mar", wed: "Mer", thu: "Jeu", fri: "Ven", sat: "Sam", sun: "Dim" },
    status: { pending_payment: "en attente de paiement", paid: "payée", confirmed: "confirmée", preparing: "en préparation", prepared: "préparée", ready: "prête", collected: "retirée", served: "servie", out_for_delivery: "en livraison", delivered: "livrée", completed: "terminée", cancelled: "annulée", refunded: "remboursée" },
  },
};

const DEFAULT_PERIOD: Partial<Record<Intent, Period>> = {
  sales: "today",
  orders: "today",
  overview: "today",
  aov: "last30",
  topProducts: "month",
  customers: "month",
  newCustomers: "month",
  bookings: "today",
  conversations: "today",
  leads: "week",
};

type Summary = {
  orders: number;
  settled_orders: number;
  sales_minor: number;
  by_status: Record<string, number>;
  customers: number;
  new_customers: number;
  top_products: { name: Record<string, string> | string; quantity: number; revenue_minor: number }[];
};

export async function askBusinessAction(input: { locale: string; slug: string; question: string }): Promise<AskAnswer | null> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return null;
  const { locale, slug, question } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const { intent, period: asked, lang } = parseQuestion(question);
  const t = T[lang];
  const base = `/${locale}/${slug}`;
  const tz = resolveTimeZone(tenant.timezone);
  const today = businessToday(tenant.timezone);
  const period = asked ?? DEFAULT_PERIOD[intent] ?? "today";
  const range = periodRange(period, today);
  const fromISO = zonedStart(range.from, tz);
  const toISO = zonedStart(range.to, tz);
  const p = PERIOD_NAME[lang][period];
  const { data: currency } = await supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle();
  const money = (minor: number) => formatMoney(minor, tenant.currency, currency?.exponent ?? 2, lang);
  const pick = (v: Record<string, string> | string) => (typeof v === "string" ? v : (v[lang] ?? v[locale] ?? Object.values(v)[0] ?? ""));
  const answer = (lines: string[], links: (keyof typeof t.links)[] = []): AskAnswer => ({
    lang,
    intent,
    lines,
    links: links.map((k) => ({ label: t.links[k], href: `${base}${k === "agent" ? "/agent" : k === "analytics" ? "/analytics" : `/${k}`}` })),
  });
  const summary = async (): Promise<Summary> => {
    const { data } = await supabase.rpc("tenant_period_summary", { p_tenant_id: tenant.id, p_from: fromISO, p_to: toISO });
    return (data ?? { orders: 0, settled_orders: 0, sales_minor: 0, by_status: {}, customers: 0, new_customers: 0, top_products: [] }) as Summary;
  };

  switch (intent) {
    case "sales":
    case "orders":
    case "overview": {
      const s = await summary();
      if (s.orders === 0) return answer([t.noOrders(p)], ["orders"]);
      const statuses = Object.entries(s.by_status)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${t.status[k as keyof typeof t.status] ?? k}: ${n}`)
        .join(", ");
      const lines =
        intent === "orders"
          ? [t.orders(p, s.orders), t.byStatus(statuses), t.sales(p, money(s.sales_minor), s.settled_orders)]
          : [t.sales(p, money(s.sales_minor), s.settled_orders), t.orders(p, s.orders), t.customers(p, s.customers, s.new_customers)];
      if (s.settled_orders > 0) lines.push(t.aov(p, money(Math.round(s.sales_minor / s.settled_orders))));
      return answer(lines, ["analytics", "orders"]);
    }
    case "aov": {
      const s = await summary();
      if (s.settled_orders === 0) return answer([t.noOrders(p)], ["analytics"]);
      return answer([t.aov(p, money(Math.round(s.sales_minor / s.settled_orders))), t.sales(p, money(s.sales_minor), s.settled_orders)], ["analytics"]);
    }
    case "topProducts": {
      const s = await summary();
      if (s.top_products.length === 0) return answer([t.noOrders(p)], ["analytics", "products"]);
      return answer([t.top(p), ...s.top_products.map((x, i) => t.topLine(i + 1, pick(x.name), x.quantity, money(x.revenue_minor)))], ["analytics", "products"]);
    }
    case "customers":
    case "newCustomers": {
      const s = await summary();
      return answer([intent === "newCustomers" ? t.newCustomers(p, s.new_customers) : t.customers(p, s.customers, s.new_customers)], ["customers"]);
    }
    case "pendingOrders": {
      const { data } = await supabase
        .from("orders")
        .select("status")
        .eq("tenant_id", tenant.id)
        .in("status", ["pending_payment", "paid", "confirmed", "preparing", "prepared", "ready", "out_for_delivery"])
        .limit(5000);
      const n = (k: string) => (data ?? []).filter((o) => o.status === k).length;
      return answer([t.pending(n("pending_payment"), n("paid") + n("confirmed"), n("preparing") + n("prepared"), n("ready") + n("out_for_delivery"))], ["orders"]);
    }
    case "bookings": {
      const [{ count }, { data: next }, { data: services }] = await Promise.all([
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "confirmed").gte("starts_at", fromISO).lt("starts_at", toISO),
        supabase.from("bookings").select("service_id, customer_name, starts_at").eq("tenant_id", tenant.id).eq("status", "confirmed").gt("starts_at", new Date().toISOString()).order("starts_at").limit(5),
        supabase.from("bookable_services").select("id, name").eq("tenant_id", tenant.id),
      ]);
      const serviceName = new Map((services ?? []).map((s) => [s.id, pick(s.name)]));
      const when = (iso: string) => new Date(iso).toLocaleString(lang, { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const lines = [t.bookings(p, count ?? 0)];
      if ((next ?? []).length > 0) lines.push(t.upcoming, ...(next ?? []).map((b) => `• ${when(b.starts_at)} — ${serviceName.get(b.service_id) ?? ""}${b.customer_name ? ` · ${b.customer_name}` : ""}`));
      else lines.push(t.noUpcoming);
      return answer(lines, ["bookings"]);
    }
    case "memberships":
    case "expiringMembers": {
      const soon = new Date(`${today}T00:00:00Z`);
      soon.setUTCDate(soon.getUTCDate() + EXPIRING_DAYS);
      const soonISO = soon.toISOString().slice(0, 10);
      const [{ count: active }, { data: expiring, count: expiringCount }, { count: unpaid }, { count: visits }, { count: overdue }] = await Promise.all([
        supabase.from("memberships").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).in("status", ["active", "paused"]).or(`end_date.is.null,end_date.gte.${today}`),
        supabase
          .from("memberships")
          .select("customer_name, end_date, member_number", { count: "exact" })
          .eq("tenant_id", tenant.id)
          .eq("status", "active")
          .gte("end_date", today)
          .lte("end_date", soonISO)
          .order("end_date")
          .limit(8),
        supabase.from("memberships").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).neq("status", "cancelled").eq("payment_status", "unpaid"),
        supabase.from("membership_visits").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).gte("visited_at", zonedStart(today, tz)),
        supabase.from("memberships").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "active").lt("end_date", today),
      ]);
      if (intent === "memberships") return answer([t.members(active ?? 0, expiringCount ?? 0, unpaid ?? 0, visits ?? 0)], ["memberships"]);
      const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(lang, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
      return answer(
        [t.expiring(expiringCount ?? 0), ...(expiring ?? []).map((m) => `• #${m.member_number} ${m.customer_name} — ${fmt(m.end_date!)}`), t.overdue(overdue ?? 0)],
        ["memberships"],
      );
    }
    case "conversations": {
      const [{ count }, { count: open }] = await Promise.all([
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).gte("started_at", fromISO).lt("started_at", toISO),
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "open"),
      ]);
      return answer([t.conversations(p, count ?? 0, open ?? 0)], ["conversations"]);
    }
    case "leads": {
      const [{ count }, { count: fresh }] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).gte("created_at", fromISO).lt("created_at", toISO),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "new"),
      ]);
      return answer([t.leads(p, count ?? 0, fresh ?? 0)], ["leads"]);
    }
    case "products": {
      const [{ count: active }, { count: suspended }, { count: drafts }, { count: services }] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "active"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "suspended"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "draft"),
        supabase.from("bookable_services").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("is_active", true),
      ]);
      return answer([t.products(active ?? 0, suspended ?? 0, drafts ?? 0, services ?? 0)], ["products"]);
    }
    case "agent": {
      const { data } = await supabase.from("agent_deployments").select("status").eq("tenant_id", tenant.id).maybeSingle();
      return answer([data?.status === "published" ? t.agentLive : data?.status === "paused" ? t.agentPaused : t.agentNot], ["agent"]);
    }
    case "hours": {
      const { data } = await supabase.from("branches").select("opening_hours").eq("tenant_id", tenant.id).eq("is_default", true).maybeSingle();
      const hours = (data?.opening_hours ?? {}) as Record<string, { open: string; close: string }[]>;
      if (Object.keys(hours).length === 0) return answer([t.noHours], ["branches"]);
      const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
      return answer([t.hours, ...days.map((d) => `• ${t.days[d]}: ${(hours[d] ?? []).map((w) => `${w.open}–${w.close}`).join(", ") || t.closed}`)], ["branches"]);
    }
    case "help":
      return answer([t.help, ...t.examples.map((e) => `• ${e}`)]);
    default:
      return answer([t.unknown, ...t.examples.map((e) => `• ${e}`)]);
  }
}
