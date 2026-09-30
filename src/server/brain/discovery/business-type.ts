/**
 * Business-type classification — deterministic first (spec: "Google types
 * first, AI only if ambiguous"). Two outputs per classification:
 *
 *  - `key`: one of the platform's seeded `business_types` keys, so the
 *    result can be offered as the tenant's type without inventing a new one;
 *  - `category`: a finer, *generic* industry family the Source Intelligence
 *    Router adapts to (food service, beauty, healthcare, retail, ...). No
 *    part of the pipeline is written for one industry — a category only
 *    changes which topics weigh more when ranking pages.
 *
 * Pure module (no I/O) so it is unit-tested directly.
 */
export const CLASSIFIER_VERSION = "type-v1";

export type BusinessCategory =
  | "food_service"
  | "beauty"
  | "wellness"
  | "fitness"
  | "healthcare"
  | "retail"
  | "hospitality"
  | "education"
  | "automotive"
  | "home_services"
  | "professional_services"
  | "engineering"
  | "general";

export type PlatformTypeKey =
  | "restaurant"
  | "cafe"
  | "salon"
  | "spa"
  | "gym"
  | "clinic"
  | "service_business"
  | "engineering"
  | "other";

export type ClassificationSource = "google_types" | "website_schema" | "ai" | "owner";

export type BusinessTypeGuess = {
  key: PlatformTypeKey;
  category: BusinessCategory;
  /** Human label from the source when there is one (e.g. Google's "Coffee shop"). */
  label: string | null;
  confidence: number;
  source: ClassificationSource;
  version: string;
  evidence: string[];
};

type Rule = { key: PlatformTypeKey; category: BusinessCategory };

/** Exact type → classification (Google Places Table A types and schema.org types share many names). */
const EXACT: Record<string, Rule> = {
  // Food service
  cafe: { key: "cafe", category: "food_service" },
  coffee_shop: { key: "cafe", category: "food_service" },
  tea_house: { key: "cafe", category: "food_service" },
  cafeorcoffeeshop: { key: "cafe", category: "food_service" },
  bakery: { key: "cafe", category: "food_service" },
  dessert_shop: { key: "cafe", category: "food_service" },
  ice_cream_shop: { key: "cafe", category: "food_service" },
  juice_shop: { key: "cafe", category: "food_service" },
  donut_shop: { key: "cafe", category: "food_service" },
  confectionery: { key: "cafe", category: "food_service" },
  chocolate_shop: { key: "cafe", category: "food_service" },
  restaurant: { key: "restaurant", category: "food_service" },
  foodestablishment: { key: "restaurant", category: "food_service" },
  meal_takeaway: { key: "restaurant", category: "food_service" },
  meal_delivery: { key: "restaurant", category: "food_service" },
  cafeteria: { key: "restaurant", category: "food_service" },
  food_court: { key: "restaurant", category: "food_service" },
  bar: { key: "restaurant", category: "food_service" },
  pub: { key: "restaurant", category: "food_service" },
  diner: { key: "restaurant", category: "food_service" },
  bistro: { key: "restaurant", category: "food_service" },
  catering_service: { key: "restaurant", category: "food_service" },
  fastfoodrestaurant: { key: "restaurant", category: "food_service" },
  // Beauty / wellness / fitness
  beauty_salon: { key: "salon", category: "beauty" },
  hair_salon: { key: "salon", category: "beauty" },
  hair_care: { key: "salon", category: "beauty" },
  barber_shop: { key: "salon", category: "beauty" },
  nail_salon: { key: "salon", category: "beauty" },
  beautician: { key: "salon", category: "beauty" },
  makeup_artist: { key: "salon", category: "beauty" },
  beautysalon: { key: "salon", category: "beauty" },
  hairsalon: { key: "salon", category: "beauty" },
  nailsalon: { key: "salon", category: "beauty" },
  spa: { key: "spa", category: "wellness" },
  day_spa: { key: "spa", category: "wellness" },
  dayspa: { key: "spa", category: "wellness" },
  massage: { key: "spa", category: "wellness" },
  sauna: { key: "spa", category: "wellness" },
  wellness_center: { key: "spa", category: "wellness" },
  gym: { key: "gym", category: "fitness" },
  fitness_center: { key: "gym", category: "fitness" },
  yoga_studio: { key: "gym", category: "fitness" },
  pilates_studio: { key: "gym", category: "fitness" },
  sports_club: { key: "gym", category: "fitness" },
  exercisegym: { key: "gym", category: "fitness" },
  healthclub: { key: "gym", category: "fitness" },
  // Healthcare
  doctor: { key: "clinic", category: "healthcare" },
  dentist: { key: "clinic", category: "healthcare" },
  dental_clinic: { key: "clinic", category: "healthcare" },
  medical_clinic: { key: "clinic", category: "healthcare" },
  medical_lab: { key: "clinic", category: "healthcare" },
  physiotherapist: { key: "clinic", category: "healthcare" },
  chiropractor: { key: "clinic", category: "healthcare" },
  skin_care_clinic: { key: "clinic", category: "healthcare" },
  hospital: { key: "clinic", category: "healthcare" },
  veterinary_care: { key: "clinic", category: "healthcare" },
  medicalclinic: { key: "clinic", category: "healthcare" },
  physician: { key: "clinic", category: "healthcare" },
  optician: { key: "clinic", category: "healthcare" },
  // Services
  plumber: { key: "service_business", category: "home_services" },
  electrician: { key: "service_business", category: "home_services" },
  locksmith: { key: "service_business", category: "home_services" },
  painter: { key: "service_business", category: "home_services" },
  roofing_contractor: { key: "service_business", category: "home_services" },
  general_contractor: { key: "service_business", category: "home_services" },
  moving_company: { key: "service_business", category: "home_services" },
  laundry: { key: "service_business", category: "home_services" },
  dry_cleaning: { key: "service_business", category: "home_services" },
  cleaning_service: { key: "service_business", category: "home_services" },
  pest_control_service: { key: "service_business", category: "home_services" },
  tailor: { key: "service_business", category: "home_services" },
  hvacbusiness: { key: "service_business", category: "home_services" },
  homeandconstructionbusiness: { key: "service_business", category: "home_services" },
  car_repair: { key: "service_business", category: "automotive" },
  car_wash: { key: "service_business", category: "automotive" },
  car_rental: { key: "service_business", category: "automotive" },
  autorepair: { key: "service_business", category: "automotive" },
  lawyer: { key: "service_business", category: "professional_services" },
  attorney: { key: "service_business", category: "professional_services" },
  accounting: { key: "service_business", category: "professional_services" },
  insurance_agency: { key: "service_business", category: "professional_services" },
  real_estate_agency: { key: "service_business", category: "professional_services" },
  travel_agency: { key: "service_business", category: "professional_services" },
  consultant: { key: "service_business", category: "professional_services" },
  courier_service: { key: "service_business", category: "professional_services" },
  legalservice: { key: "service_business", category: "professional_services" },
  professionalservice: { key: "service_business", category: "professional_services" },
  engineering_firm: { key: "engineering", category: "engineering" },
  architect: { key: "engineering", category: "engineering" },
  // Hospitality / education (no dedicated platform key — "other")
  hotel: { key: "other", category: "hospitality" },
  lodging: { key: "other", category: "hospitality" },
  resort_hotel: { key: "other", category: "hospitality" },
  guest_house: { key: "other", category: "hospitality" },
  lodgingbusiness: { key: "other", category: "hospitality" },
  school: { key: "other", category: "education" },
  university: { key: "other", category: "education" },
  preschool: { key: "other", category: "education" },
  educationalorganization: { key: "other", category: "education" },
  // Retail
  store: { key: "other", category: "retail" },
  supermarket: { key: "other", category: "retail" },
  grocery_store: { key: "other", category: "retail" },
  convenience_store: { key: "other", category: "retail" },
  shopping_mall: { key: "other", category: "retail" },
  pharmacy: { key: "other", category: "retail" },
  drugstore: { key: "other", category: "retail" },
  florist: { key: "other", category: "retail" },
  onlinestore: { key: "other", category: "retail" },
};

/** Suffix rules for Google's long tail (`italian_restaurant`, `electronics_store`, `dental_clinic`, ...). */
const SUFFIX: [string, Rule][] = [
  ["_restaurant", { key: "restaurant", category: "food_service" }],
  ["restaurant", { key: "restaurant", category: "food_service" }],
  ["_cafe", { key: "cafe", category: "food_service" }],
  ["_bakery", { key: "cafe", category: "food_service" }],
  ["_salon", { key: "salon", category: "beauty" }],
  ["_spa", { key: "spa", category: "wellness" }],
  ["_studio", { key: "gym", category: "fitness" }],
  ["_clinic", { key: "clinic", category: "healthcare" }],
  ["_doctor", { key: "clinic", category: "healthcare" }],
  ["_contractor", { key: "service_business", category: "home_services" }],
  ["_service", { key: "service_business", category: "professional_services" }],
  ["_agency", { key: "service_business", category: "professional_services" }],
  ["_hotel", { key: "other", category: "hospitality" }],
  ["_school", { key: "other", category: "education" }],
  ["_store", { key: "other", category: "retail" }],
  ["_shop", { key: "other", category: "retail" }],
  ["store", { key: "other", category: "retail" }],
];

/** Types that say nothing about what the business is. */
const GENERIC = new Set([
  "establishment",
  "point_of_interest",
  "food",
  "health",
  "service",
  "premise",
  "localbusiness",
  "organization",
  "thing",
  "place",
  "corporation",
]);

function normalizeType(type: string): string {
  return type.trim().toLowerCase().replace(/^https?:\/\/schema\.org\//, "");
}

export function ruleForType(type: string): Rule | null {
  const t = normalizeType(type);
  if (!t || GENERIC.has(t)) return null;
  if (EXACT[t]) return EXACT[t];
  for (const [suffix, rule] of SUFFIX) if (t.endsWith(suffix)) return rule;
  return null;
}

/**
 * From Google's `primaryType` + `types`. A mapped primary type is
 * authoritative (95). Otherwise the secondary types vote; a unanimous vote
 * is 80, a split vote is ambiguous (null → AI may be asked).
 */
export function classifyFromGoogle(input: {
  primaryType: string | null;
  types: string[];
  label?: string | null;
}): BusinessTypeGuess | null {
  const base = { source: "google_types" as const, version: CLASSIFIER_VERSION, label: input.label ?? null };
  if (input.primaryType) {
    const rule = ruleForType(input.primaryType);
    if (rule) return { ...rule, ...base, confidence: 95, evidence: [`primaryType=${input.primaryType}`] };
  }
  return vote(input.types, { ...base, confidence: 80 });
}

/** From a website's JSON-LD `@type` values (LocalBusiness subtypes). Slightly less trusted than Google's type. */
export function classifyFromSchemaTypes(types: string[]): BusinessTypeGuess | null {
  return vote(types, { source: "website_schema", version: CLASSIFIER_VERSION, label: null, confidence: 75 });
}

function vote(
  types: string[],
  base: Pick<BusinessTypeGuess, "source" | "version" | "label" | "confidence">,
): BusinessTypeGuess | null {
  const hits = new Map<string, { rule: Rule; types: string[] }>();
  for (const type of types) {
    const rule = ruleForType(type);
    if (!rule) continue;
    const id = `${rule.key}/${rule.category}`;
    const hit = hits.get(id) ?? { rule, types: [] };
    hit.types.push(type);
    hits.set(id, hit);
  }
  if (hits.size !== 1) return null; // nothing specific, or a split vote → ambiguous
  const [only] = [...hits.values()];
  return { ...only.rule, ...base, evidence: only.types.map((t) => `type=${t}`) };
}

/** Maps an AI answer (constrained to the platform keys/categories) back onto a guess — rejected when off-vocabulary. */
export function guessFromAi(answer: { key?: unknown; category?: unknown; confidence?: unknown }): BusinessTypeGuess | null {
  const keys: PlatformTypeKey[] = ["restaurant", "cafe", "salon", "spa", "gym", "clinic", "service_business", "engineering", "other"];
  if (!keys.includes(answer.key as PlatformTypeKey) || !ALL_CATEGORIES.includes(answer.category as BusinessCategory)) return null;
  const reported = typeof answer.confidence === "number" ? answer.confidence : 50;
  return {
    key: answer.key as PlatformTypeKey,
    category: answer.category as BusinessCategory,
    label: null,
    // AI is inference: capped below any deterministic source.
    confidence: Math.max(0, Math.min(65, Math.round(reported))),
    source: "ai",
    version: CLASSIFIER_VERSION,
    evidence: ["ai"],
  };
}

export const ALL_CATEGORIES: BusinessCategory[] = [
  "food_service",
  "beauty",
  "wellness",
  "fitness",
  "healthcare",
  "retail",
  "hospitality",
  "education",
  "automotive",
  "home_services",
  "professional_services",
  "engineering",
  "general",
];

/** Category implied by a platform key alone (used when the owner already chose a type and nothing better is known). */
export function categoryForKey(key: string): BusinessCategory {
  switch (key) {
    case "restaurant":
    case "cafe":
      return "food_service";
    case "salon":
      return "beauty";
    case "spa":
      return "wellness";
    case "gym":
      return "fitness";
    case "clinic":
      return "healthcare";
    case "service_business":
      return "professional_services";
    case "engineering":
      return "engineering";
    default:
      return "general";
  }
}
