/**
 * Bookings → WhatsApp: a ready-to-send message with the booking's details,
 * opened in WhatsApp through a wa.me link (the owner presses Send — nothing
 * is sent automatically, no API, no cost). Written in the language the
 * customer used on the Agent.
 */

export type MessageLocale = "en" | "ar" | "fr";

export type BookingMessage = {
  kind: "confirmed" | "declined";
  locale: MessageLocale;
  customerName: string | null;
  businessName: string;
  serviceName: string;
  /** Already formatted for the customer ("Fri 10 Oct"). */
  date: string;
  /** Local clock times ("19:00"). */
  time: string;
  endTime: string | null;
  partySize: number;
  /** The branch it's at (businesses with several branches), in the customer's language. */
  branchName?: string | null;
  branchAddress?: string | null;
};

function people(locale: MessageLocale, n: number): string {
  if (locale === "ar") return n === 1 ? "شخص واحد" : n === 2 ? "شخصان" : `${n} أشخاص`;
  if (locale === "fr") return n === 1 ? "1 personne" : `${n} personnes`;
  return n === 1 ? "1 person" : `${n} people`;
}

function branchLine(locale: MessageLocale, name: string, address: string | null): string {
  const label = locale === "ar" ? "الفرع" : locale === "fr" ? "Succursale" : "Branch";
  return `📍 ${label}${locale === "fr" ? " " : ""}: ${name}${address ? ` — ${address}` : ""}`;
}

export function bookingMessage(m: BookingMessage): string {
  const name = m.customerName?.trim() || "";
  const branch = m.branchName?.trim() || "";
  const address = m.branchAddress?.trim() || null;
  // "• 📍 Branch: Marina — Marina Walk 5", after the service, when the business has several branches.
  const details = (when: string) => [`• ${m.serviceName}`, ...(branch ? [`• ${branchLine(m.locale, branch, address)}`] : []), `• ${when}`, `• ${people(m.locale, m.partySize)}`];
  const at = (word: string) => (branch ? ` ${word} ${branch}` : "");
  const when = (at: string, until: string) => (m.endTime ? `${m.date} ${at} ${m.time} ${until} ${m.endTime}` : `${m.date} ${at} ${m.time}`);
  if (m.locale === "ar") {
    if (m.kind === "declined") {
      return `مرحباً${name ? ` ${name}` : ""}، شكراً لطلب الحجز لدى ${m.businessName}${at("–")}. نعتذر منك، جدولنا ممتلئ يوم ${m.date} الساعة ${m.time}. يُرجى اختيار وقت آخر، ويسعدنا استقبالك.`;
    }
    return [
      `مرحباً${name ? ` ${name}` : ""}، تم تأكيد حجزك لدى ${m.businessName} ✅`,
      ...details(when("الساعة", "حتى")),
      "بانتظارك!",
    ].join("\n");
  }
  if (m.locale === "fr") {
    if (m.kind === "declined") {
      return `Bonjour${name ? ` ${name}` : ""}, merci pour votre demande de réservation chez ${m.businessName}${at("–")}. Nous sommes désolés : notre planning est complet le ${m.date} à ${m.time}. N'hésitez pas à choisir un autre horaire, nous serons ravis de vous accueillir.`;
    }
    return [
      `Bonjour${name ? ` ${name}` : ""}, votre réservation chez ${m.businessName} est confirmée ✅`,
      ...details(when("à", "jusqu'à")),
      "Au plaisir de vous accueillir !",
    ].join("\n");
  }
  if (m.kind === "declined") {
    return `Hello${name ? ` ${name}` : ""}, thank you for your booking request at ${m.businessName}${at("–")}. We're so sorry — our schedule is full on ${m.date} at ${m.time}. Please choose another time; we'd love to welcome you.`;
  }
  return [
    `Hello${name ? ` ${name}` : ""}, your booking at ${m.businessName} is confirmed ✅`,
    ...details(when("at", "until")),
    "We look forward to seeing you!",
  ].join("\n");
}

/** International dialling codes, by the ways a business may have written its country (free text). */
const DIAL: [string[], string][] = [
  [["qa", "qat", "qatar", "قطر"], "974"],
  [["ae", "are", "uae", "united arab emirates", "emirates", "الإمارات", "الامارات"], "971"],
  [["sa", "sau", "ksa", "saudi arabia", "saudi", "السعودية"], "966"],
  [["kw", "kwt", "kuwait", "الكويت"], "965"],
  [["bh", "bhr", "bahrain", "البحرين"], "973"],
  [["om", "omn", "oman", "عمان", "عُمان"], "968"],
  [["tn", "tun", "tunisia", "tunisie", "تونس"], "216"],
  [["dz", "dza", "algeria", "algérie", "algerie", "الجزائر"], "213"],
  [["ma", "mar", "morocco", "maroc", "المغرب"], "212"],
  [["eg", "egy", "egypt", "égypte", "egypte", "مصر"], "20"],
  [["jo", "jor", "jordan", "jordanie", "الأردن", "الاردن"], "962"],
  [["lb", "lbn", "lebanon", "liban", "لبنان"], "961"],
  [["fr", "fra", "france", "فرنسا"], "33"],
  [["gb", "gbr", "uk", "united kingdom", "england"], "44"],
  [["us", "usa", "united states", "united states of america"], "1"],
];

export function dialCode(country: string | null | undefined): string | null {
  const c = country?.trim().toLowerCase();
  if (!c) return null;
  return DIAL.find(([names]) => names.includes(c))?.[1] ?? null;
}

/**
 * The number as wa.me wants it (country code + number, digits only), or null
 * when it can't be told. A local number ("05…", "5512 3456") gets the
 * business's country code.
 */
export function whatsappNumber(phone: string | null | undefined, country: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (!trimmed.startsWith("+")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else {
      const cc = dialCode(country);
      if (cc && !(digits.startsWith(cc) && digits.length >= cc.length + 7)) digits = cc + digits.replace(/^0+/, "");
      else if (!cc && digits.startsWith("0")) return null;
    }
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
