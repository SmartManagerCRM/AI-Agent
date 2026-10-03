import type { ContentLang } from "./types";

/**
 * Built-in word list: common menu sections, dishes, drinks, business types,
 * plans and services in English, Arabic and French. A text that is exactly
 * one of these (any case, spacing or Arabic spelling variant) is translated
 * here — instantly, the same way every time, with no outside service.
 * Anything else goes to a translation service (./engine.ts).
 *
 * Only whole entries match: a word list can't reorder words correctly
 * between Arabic and English, so "Iced Latte" is an entry of its own rather
 * than "Iced" + "Latte". When one language maps to several entries (Arabic
 * "حلويات" is both Desserts and Sweets), the first entry wins.
 */
type Entry = readonly [en: string, ar: string, fr: string];

const ENTRIES: readonly Entry[] = [
  // ── Menu sections ──
  ["Breakfast", "فطور", "Petit-déjeuner"],
  ["Lunch", "غداء", "Déjeuner"],
  ["Dinner", "عشاء", "Dîner"],
  ["Appetizers", "مقبلات", "Entrées"],
  ["Starters", "مقبلات", "Entrées"],
  ["Cold Appetizers", "مقبلات باردة", "Entrées froides"],
  ["Hot Appetizers", "مقبلات ساخنة", "Entrées chaudes"],
  ["Soups", "شوربات", "Soupes"],
  ["Soup", "شوربة", "Soupe"],
  ["Soup of the Day", "شوربة اليوم", "Soupe du jour"],
  ["Lentil Soup", "شوربة عدس", "Soupe de lentilles"],
  ["Salads", "سلطات", "Salades"],
  ["Salad", "سلطة", "Salade"],
  ["Green Salad", "سلطة خضراء", "Salade verte"],
  ["Caesar Salad", "سلطة سيزر", "Salade César"],
  ["Main Courses", "الأطباق الرئيسية", "Plats principaux"],
  ["Main Dishes", "الأطباق الرئيسية", "Plats principaux"],
  ["Grills", "مشويات", "Grillades"],
  ["Mixed Grill", "مشاوي مشكلة", "Grillade mixte"],
  ["Seafood", "مأكولات بحرية", "Fruits de mer"],
  ["Fish", "سمك", "Poisson"],
  ["Chicken", "دجاج", "Poulet"],
  ["Meat", "لحم", "Viande"],
  ["Rice", "أرز", "Riz"],
  ["Pasta", "باستا", "Pâtes"],
  ["Pizza", "بيتزا", "Pizza"],
  ["Burgers", "برغر", "Burgers"],
  ["Burger", "برغر", "Burger"],
  ["Sandwiches", "سندويشات", "Sandwichs"],
  ["Sides", "أطباق جانبية", "Accompagnements"],
  ["Side Dishes", "أطباق جانبية", "Accompagnements"],
  ["French Fries", "بطاطس مقلية", "Frites"],
  ["Fries", "بطاطس مقلية", "Frites"],
  ["Bread", "خبز", "Pain"],
  ["Kids Menu", "قائمة الأطفال", "Menu enfant"],
  ["Meals", "وجبات", "Repas"],
  ["Offers", "عروض", "Offres"],
  ["Specials", "أطباق مميزة", "Spécialités"],
  ["Desserts", "حلويات", "Desserts"],
  ["Sweets", "حلويات", "Douceurs"],
  ["Dessert", "حلوى", "Dessert"],
  ["Cakes", "كيك", "Gâteaux"],
  ["Cake", "كيكة", "Gâteau"],
  ["Pastries", "معجنات", "Pâtisseries"],
  ["Ice Cream", "آيس كريم", "Glace"],
  ["Drinks", "مشروبات", "Boissons"],
  ["Beverages", "مشروبات", "Boissons"],
  ["Hot Drinks", "مشروبات ساخنة", "Boissons chaudes"],
  ["Cold Drinks", "مشروبات باردة", "Boissons fraîches"],
  ["Soft Drinks", "مشروبات غازية", "Boissons gazeuses"],
  ["Juices", "عصائر", "Jus"],
  ["Fresh Juices", "عصائر طازجة", "Jus frais"],
  ["Juice", "عصير", "Jus"],
  ["Smoothies", "سموذي", "Smoothies"],
  ["Milkshakes", "ميلك شيك", "Milk-shakes"],
  // ── Dishes ──
  ["Fattoush", "فتوش", "Fattouche"],
  ["Tabbouleh", "تبولة", "Taboulé"],
  ["Hummus", "حمص", "Houmous"],
  ["Moutabal", "متبل", "Moutabal"],
  ["Baba Ghanoush", "بابا غنوج", "Baba ganoush"],
  ["Falafel", "فلافل", "Falafel"],
  ["Shish Tawook", "شيش طاووق", "Chich taouk"],
  ["Kebab", "كباب", "Kebab"],
  ["Shawarma", "شاورما", "Chawarma"],
  ["Chicken Shawarma", "شاورما دجاج", "Chawarma au poulet"],
  ["Meat Shawarma", "شاورما لحم", "Chawarma à la viande"],
  ["Mandi", "مندي", "Mandi"],
  ["Kabsa", "كبسة", "Kabsa"],
  ["Croissant", "كرواسون", "Croissant"],
  ["Cheesecake", "تشيز كيك", "Cheesecake"],
  ["Chocolate Cake", "كيكة الشوكولاتة", "Gâteau au chocolat"],
  ["Kunafa", "كنافة", "Knafeh"],
  ["Baklava", "بقلاوة", "Baklava"],
  ["Umm Ali", "أم علي", "Om Ali"],
  // ── Coffee & tea ──
  ["Coffee", "قهوة", "Café"],
  ["Hot Coffee", "قهوة ساخنة", "Café chaud"],
  ["Iced Coffee", "قهوة مثلجة", "Café glacé"],
  ["Cold Coffee", "قهوة باردة", "Café froid"],
  ["Specialty Coffee", "قهوة مختصة", "Café de spécialité"],
  ["Arabic Coffee", "قهوة عربية", "Café arabe"],
  ["Turkish Coffee", "قهوة تركية", "Café turc"],
  ["Espresso", "إسبريسو", "Expresso"],
  ["Double Espresso", "إسبريسو دبل", "Double expresso"],
  ["Americano", "أمريكانو", "Americano"],
  ["Cappuccino", "كابتشينو", "Cappuccino"],
  ["Latte", "لاتيه", "Latte"],
  ["Iced Latte", "آيس لاتيه", "Latte glacé"],
  ["Spanish Latte", "سبانش لاتيه", "Latte espagnol"],
  ["Flat White", "فلات وايت", "Flat white"],
  ["Macchiato", "ماكياتو", "Macchiato"],
  ["Mocha", "موكا", "Moka"],
  ["Cortado", "كورتادو", "Cortado"],
  ["Hot Chocolate", "شوكولاتة ساخنة", "Chocolat chaud"],
  ["Tea", "شاي", "Thé"],
  ["Green Tea", "شاي أخضر", "Thé vert"],
  ["Mint Tea", "شاي بالنعناع", "Thé à la menthe"],
  ["Karak Tea", "شاي كرك", "Thé karak"],
  ["Iced Tea", "شاي مثلج", "Thé glacé"],
  ["Matcha Latte", "ماتشا لاتيه", "Latte matcha"],
  ["Orange Juice", "عصير برتقال", "Jus d'orange"],
  ["Lemon Mint", "ليمون بالنعناع", "Citron menthe"],
  ["Lemonade", "ليموناضة", "Limonade"],
  ["Water", "ماء", "Eau"],
  ["Mineral Water", "مياه معدنية", "Eau minérale"],
  ["Sparkling Water", "مياه فوارة", "Eau pétillante"],
  // ── Business types ──
  ["Restaurant", "مطعم", "Restaurant"],
  ["Café", "مقهى", "Café"],
  ["Cafe", "مقهى", "Café"],
  ["Bakery", "مخبز", "Boulangerie"],
  ["Real Estate", "عقارات", "Immobilier"],
  ["Retail Shop", "متجر تجزئة", "Commerce de détail"],
  ["Travel Agency", "وكالة سفر", "Agence de voyages"],
  ["Salon", "صالون", "Salon"],
  ["Beauty Salon", "صالون تجميل", "Salon de beauté"],
  ["Barbershop", "صالون حلاقة", "Barbier"],
  ["Spa", "سبا", "Spa"],
  ["Gym", "نادي رياضي", "Salle de sport"],
  ["Clinic", "عيادة", "Clinique"],
  ["Dental Clinic", "عيادة أسنان", "Cabinet dentaire"],
  ["Pharmacy", "صيدلية", "Pharmacie"],
  ["Hotel", "فندق", "Hôtel"],
  ["Supermarket", "سوبرماركت", "Supermarché"],
  ["Car Rental", "تأجير سيارات", "Location de voitures"],
  ["Laundry", "مغسلة", "Blanchisserie"],
  ["Engineering Company", "شركة هندسية", "Bureau d'ingénierie"],
  ["Service Business", "نشاط خدمي", "Entreprise de services"],
  ["Other", "أخرى", "Autre"],
  // ── Plans ──
  ["Starter", "أساسي", "Débutant"],
  ["Basic", "أساسي", "Basique"],
  ["Growth", "نمو", "Croissance"],
  ["Pro", "احترافي", "Pro"],
  ["Professional", "احترافي", "Professionnel"],
  ["Premium", "مميز", "Premium"],
  ["Enterprise", "مؤسسات", "Entreprise"],
  ["Free", "مجاني", "Gratuit"],
  ["Trial", "تجريبي", "Essai"],
  // ── Services & memberships ──
  ["Haircut", "قص شعر", "Coupe de cheveux"],
  ["Manicure", "مانيكير", "Manucure"],
  ["Pedicure", "باديكير", "Pédicure"],
  ["Massage", "مساج", "Massage"],
  ["Consultation", "استشارة", "Consultation"],
  ["Table Reservation", "حجز طاولة", "Réservation de table"],
  ["Personal Training", "تدريب شخصي", "Coaching personnel"],
  ["Monthly Membership", "عضوية شهرية", "Abonnement mensuel"],
  ["Annual Membership", "عضوية سنوية", "Abonnement annuel"],
  ["Day Pass", "تذكرة يومية", "Pass journée"],
  ["Delivery", "توصيل", "Livraison"],
];

const INDEX: Record<ContentLang, number> = { en: 0, ar: 1, fr: 2 };

/** Case, spacing, punctuation and Arabic spelling variants (hamza forms, ى/ي, ة/ه, diacritics, tatweel) all compare equal. */
export function normalizeForGlossary(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[’'`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[\s\-_/]+/g, " ")
    .replace(/^[\s.,:;!?()"«»]+|[\s.,:;!?()"«»]+$/g, "")
    .trim();
}

const LOOKUP: Record<ContentLang, Map<string, Entry>> = { en: new Map(), ar: new Map(), fr: new Map() };
for (const entry of ENTRIES) {
  for (const lang of ["en", "ar", "fr"] as const) {
    const key = normalizeForGlossary(entry[INDEX[lang]]);
    if (!LOOKUP[lang].has(key)) LOOKUP[lang].set(key, entry);
  }
}

/** The word list's translation of the whole text, or null when it isn't an entry. */
export function glossaryTranslate(text: string, from: ContentLang, to: ContentLang): string | null {
  const entry = LOOKUP[from].get(normalizeForGlossary(text));
  return entry ? entry[INDEX[to]] : null;
}

/** Tests: every entry, to check the list itself. */
export const GLOSSARY_ENTRIES = ENTRIES;
