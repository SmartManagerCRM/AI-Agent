/**
 * Pure helpers for the Agent's voice mode. Speech is recognised and spoken
 * by the customer's own browser (Web Speech API), so talking to the Agent
 * costs exactly what typing does: the transcript goes through the same
 * deterministic-first chat, and no audio is ever sent to an AI model.
 */

const DEFAULT_REGION: Record<string, string> = { ar: "ar-SA", en: "en-US", fr: "fr-FR" };

/** Only Arabic follows the customer's own dialect (e.g. ar-EG); its regional models differ a lot. */
const REGIONAL = new Set(["ar"]);

/**
 * The recognition language: the Agent's language. Arabic uses the
 * customer's own dialect when their browser lists one; English and French
 * always use one standard accent model — a phone's other English variants
 * (e.g. en-IN) bias recognition towards words a menu never contains.
 */
export function speechLang(locale: string, browserLanguages: readonly string[] = []): string {
  const base = locale.toLowerCase().split("-")[0];
  const regional = REGIONAL.has(base)
    ? browserLanguages.find((l) => l.toLowerCase().split("-")[0] === base && l.includes("-"))
    : undefined;
  return regional ?? DEFAULT_REGION[base] ?? locale;
}

/** Words customers use when ordering by voice, so "add it to cart" beats a misheard "Aditya ka". */
const ORDERING_WORDS = [
  // English
  "add", "cart", "basket", "order", "checkout", "menu", "price", "much", "delivery", "deliver", "pickup", "table",
  "hours", "open", "remove", "cancel", "book", "booking", "appointment", "recommend", "please", "want", "like",
  // French
  "ajouter", "ajoute", "panier", "commande", "commander", "carte", "prix", "combien", "livraison", "emporter",
  "horaires", "ouvert", "supprimer", "annuler", "réserver", "rendez", "voudrais", "veux",
  // Arabic
  "اضف", "ضيف", "السله", "سله", "الطلب", "اطلب", "القائمه", "المنيو", "منيو", "السعر", "بكم", "كم", "توصيل",
  "استلام", "ساعات", "مفتوح", "احذف", "الغ", "احجز", "حجز", "موعد", "اريد", "ابغى", "ابي", "عايز",
];

/** Lower-case, no accents/diacritics/tatweel, one form of alef/ya/ta marbuta — so spoken and written forms compare equal. */
export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The distinct words worth matching: this business's own item names plus ordering words. */
export function speechVocabulary(names: readonly string[]): Set<string> {
  const words = new Set<string>();
  for (const word of [...names.flatMap((n) => normalizeSpeech(n).split(" ")), ...ORDERING_WORDS.map(normalizeSpeech)]) {
    if (word.length >= 3 || /\p{Script=Arabic}/u.test(word)) words.add(word);
  }
  return words;
}

/**
 * Of the recognizer's guesses (best first), the one that names the most of
 * this business's items and ordering words. The recognizer's own first
 * guess wins any tie, so a guess is only replaced by one that clearly fits
 * the menu better.
 */
export function pickTranscript(alternatives: readonly string[], vocabulary: ReadonlySet<string>): string {
  const score = (text: string) => new Set(normalizeSpeech(text).split(" ").filter((w) => vocabulary.has(w))).size;
  let best = alternatives[0] ?? "";
  let bestScore = score(best);
  for (const alternative of alternatives.slice(1)) {
    const s = score(alternative);
    if (s > bestScore) {
      best = alternative;
      bestScore = s;
    }
  }
  return best;
}

/**
 * The language a reply is written in, for choosing the voice that reads it:
 * Arabic script → Arabic; otherwise the Agent's language unless that is
 * Arabic (a Latin-script reply in the Arabic Agent is English).
 */
export function replyLanguage(text: string, locale: string): string {
  const arabic = (text.match(/\p{Script=Arabic}/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  if (arabic > 0 && arabic >= latin) return "ar";
  const base = locale.toLowerCase().split("-")[0];
  return base === "ar" ? "en" : base;
}

/** What a reply sounds like read aloud: no links, emoji or formatting marks. */
export function spokenText(reply: string): string {
  return reply
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0F\u200D\u20E3]+/gu, " ")
    .replace(/[*_#`~>|]+/g, " ")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

type VoiceLike = { lang: string; localService?: boolean; default?: boolean };

/**
 * A voice for the reply's language — exact region first, then any voice of
 * the language. None → the reply is not spoken (reading Arabic with an
 * English voice is worse than silence).
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
  const norm = (l: string) => l.toLowerCase().replace("_", "-");
  const want = norm(lang);
  const base = want.split("-")[0];
  const same = voices.filter((v) => norm(v.lang).split("-")[0] === base);
  if (same.length === 0) return null;
  const rank = (v: V) => (norm(v.lang) === want ? 0 : 2) + (v.localService ? 0 : 1);
  return [...same].sort((a, b) => rank(a) - rank(b))[0];
}

/** Recognition error → message key (agent.voice.*). */
export function voiceErrorKey(error: string): string | null {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "voice.blocked";
    case "no-speech":
      return "voice.noSpeech";
    case "network":
      return "voice.network";
    case "audio-capture":
      return "voice.noMic";
    case "aborted":
      return null;
    default:
      return "voice.failed";
  }
}
