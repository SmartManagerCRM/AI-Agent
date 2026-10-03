/**
 * Ask SmartManager (console): understands a question about the business by
 * matching words — English, Arabic and French — never by calling an AI
 * model. Anything it doesn't recognise gets the list of what it can answer.
 */
export type AskLang = "en" | "ar" | "fr";
export type Period = "today" | "yesterday" | "week" | "last7" | "month" | "lastMonth" | "last30" | "year" | "all";
export type Intent =
  | "help"
  | "pendingOrders"
  | "aov"
  | "topProducts"
  | "newCustomers"
  | "customers"
  | "expiringMembers"
  | "memberships"
  | "bookings"
  | "conversations"
  | "leads"
  | "products"
  | "agent"
  | "hours"
  | "orders"
  | "sales"
  | "overview"
  | "unknown";

/** Lower-case, no Arabic diacritics/tatweel, one form of alef / ta marbuta / ya, no French accents. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    // Arabic letter forms first: decomposing would split أ into ا + a hamza mark.
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s%-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (text: string, words: string[]) => words.some((w) => text.includes(normalize(w)));

// Checked in order: the more specific question first ("new customers" before "customers").
const INTENTS: [Intent, string[]][] = [
  ["help", ["help", "what can you", "what do you know", "aide", "que peux", "مساعده", "ماذا تستطيع", "ماذا يمكنك"]],
  ["pendingOrders", ["pending", "waiting", "unpaid order", "awaiting", "not paid", "en attente", "non paye", "قيد الانتظار", "معلق", "غير مدفوع", "بانتظار"]],
  ["aov", ["average order", "aov", "average basket", "average ticket", "panier moyen", "moyenne", "moyen", "متوسط"]],
  ["topProducts", ["best sell", "best-sell", "top product", "top item", "top selling", "most sold", "most popular", "popular", "bestseller", "best seller", "plus vendu", "meilleure vente", "meilleures ventes", "populaire", "الاكثر مبيعا", "الاكثر طلبا", "الافضل مبيعا"]],
  ["newCustomers", ["new customer", "new client", "first time", "nouveaux clients", "nouveau client", "عملاء جدد", "عميل جديد", "زبائن جدد"]],
  ["expiringMembers", ["expir", "renewal", "renew", "due", "lapse", "renouvel", "echeance", "تنتهي", "انتهاء", "تجديد", "منتهي"]],
  ["memberships", ["member", "subscriber", "subscription", "loyalty", "abonne", "abonnement", "adherent", "fidelite", "عضو", "اعضاء", "عضويه", "عضويات", "مشترك", "اشتراك"]],
  ["bookings", ["booking", "appointment", "reservation", "booked", "rendez", "reserve", "حجز", "حجوزات", "موعد", "مواعيد"]],
  ["customers", ["customer", "client", "buyer", "عميل", "عملاء", "زبون", "زبائن"]],
  ["conversations", ["conversation", "chat", "message", "discussion", "محادثه", "محادثات", "رسائل", "دردشه"]],
  ["leads", ["lead", "prospect", "enquir", "inquir", "محتمل", "استفسار"]],
  ["agent", ["agent", "live", "online", "published", "en ligne", "الوكيل", "مباشر", "منشور"]],
  ["hours", ["opening hour", "hours", "open", "close", "horaire", "ouvert", "ferme", "ساعات", "دوام", "مفتوح", "يفتح", "مغلق"]],
  ["products", ["product", "item", "menu", "catalog", "catalogue", "article", "produit", "منتج", "منتجات", "اصناف", "قائمه"]],
  ["orders", ["order", "commande", "طلب", "طلبات"]],
  ["sales", ["sale", "revenue", "income", "earn", "made", "make", "sell", "sold", "turnover", "money", "vente", "chiffre", "revenu", "gagne", "مبيعات", "ايراد", "ايرادات", "دخل", "ربح", "كسبت"]],
  ["overview", ["overview", "summary", "how am i doing", "how is business", "how are we doing", "resume", "bilan", "ملخص", "نظره عامه", "كيف الاداء", "كيف حال"]],
];

const PERIODS: [Period, string[]][] = [
  ["yesterday", ["yesterday", "hier", "امس", "البارحه"]],
  ["today", ["today", "so far today", "aujourd", "ce jour", "اليوم"]],
  ["last7", ["last 7", "past 7", "last seven", "7 days", "7 derniers", "sept derniers", "اخر 7", "اخر سبعه", "7 ايام"]],
  ["last30", ["last 30", "past 30", "30 days", "30 derniers", "اخر 30", "30 يوم"]],
  ["lastMonth", ["last month", "previous month", "mois dernier", "mois precedent", "الشهر الماضي", "الشهر السابق"]],
  ["week", ["this week", "week", "cette semaine", "semaine", "هذا الاسبوع", "الاسبوع"]],
  ["month", ["this month", "month", "ce mois", "mois", "هذا الشهر", "الشهر"]],
  ["year", ["this year", "year", "cette annee", "annee", "هذه السنه", "هذا العام", "السنه", "العام"]],
  ["all", ["all time", "ever", "total", "since the start", "since we started", "depuis le debut", "au total", "الاجمالي", "منذ البدايه", "كل الوقت"]],
];

const FRENCH = ["combien", "quel", "quelle", "quels", "aujourd", "commandes", "ventes", "semaine", "mois", "est-ce", "est ce", "mes ", "notre", "nos ", "reservations", "abonnes", "horaires"];

export function detectLang(text: string): AskLang {
  if (/[؀-ۿ]/.test(text)) return "ar";
  const n = ` ${normalize(text)} `;
  return FRENCH.some((w) => n.includes(normalize(w))) ? "fr" : "en";
}

/** What a question asks, for which period, in which language. */
export function parseQuestion(question: string): { intent: Intent; period: Period | null; lang: AskLang } {
  const text = normalize(question);
  const lang = detectLang(question);
  const intent = INTENTS.find(([, words]) => has(text, words))?.[0] ?? "unknown";
  const period = PERIODS.find(([, words]) => has(text, words))?.[0] ?? null;
  return { intent, period, lang };
}

/** Local calendar start of each period ("YYYY-MM-DD", inclusive) and end (exclusive) from the business's today. */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  const d = (iso: string, days: number) => {
    const x = new Date(`${iso}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + days);
    return x.toISOString().slice(0, 10);
  };
  const tomorrow = d(today, 1);
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  switch (period) {
    case "today":
      return { from: today, to: tomorrow };
    case "yesterday":
      return { from: d(today, -1), to: today };
    case "week":
      return { from: d(today, -weekday), to: tomorrow };
    case "last7":
      return { from: d(today, -6), to: tomorrow };
    case "last30":
      return { from: d(today, -29), to: tomorrow };
    case "month":
      return { from: monthStart, to: tomorrow };
    case "lastMonth": {
      const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
      return { from: prev, to: monthStart };
    }
    case "year":
      return { from: `${y}-01-01`, to: tomorrow };
    case "all":
      return { from: "2000-01-01", to: tomorrow };
  }
}

/** The instant a local date starts in a time zone (e.g. "2026-10-05" in Asia/Riyadh → 2026-10-04T21:00:00Z). */
export function zonedStart(dateISO: string, timeZone: string): string {
  const guess = Date.parse(`${dateISO}T00:00:00Z`);
  const offset = (instant: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(instant))
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - instant;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first)).toISOString();
}
