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
    // Typed punctuation the voice would stumble over ("assistant!, .. We", "them , or", "want !!", "today! ..."):
    // spaces before marks go, stray dots/commas after ! or ? go, repeats collapse — the words are never changed.
    .replace(/[ \t]+([,.!?؟،…])/g, "$1")
    .replace(/([!?؟])[\s,.،…]*[,.،…]+/g, "$1")
    .replace(/[,،]\s*(?:\.{2,}|…)/g, ",")
    // An ellipsis mid-sentence ("Welcome... to") is a pause (comma); before a new sentence, a full stop.
    .replace(/(?:\.{2,}|…)(\s+)(?=\p{Ll})/gu, ",$1")
    .replace(/\.{2,}|…/g, ".")
    .replace(/([!?؟.,،])\1+/g, "$1")
    .replace(/^[\s,.;:!?،]+/gm, "")
    .trim();
}

/** Currency signs and local abbreviations written next to prices, and the currency each one means. */
const CURRENCY_SIGNS: Record<string, string> = {
  $: "USD", "€": "EUR", "£": "GBP", "₹": "INR", "₺": "TRY", "₦": "NGN", "₩": "KRW", "₱": "PHP", "₫": "VND", "₪": "ILS",
  "₴": "UAH", "₽": "RUB", "₸": "KZT",
  "ر.س": "SAR", "د.إ": "AED", "د.ك": "KWD", "ر.ق": "QAR", "د.ب": "BHD", "ر.ع": "OMR", "د.أ": "JOD", "د.ا": "JOD",
  "ج.م": "EGP", "د.ت": "TND", "د.م": "MAD", "د.ج": "DZD", "د.ل": "LYD", "د.ع": "IQD", "ل.ل": "LBP", "ل.س": "SYP",
  "ر.ي": "YER", "ج.س": "SDG", DT: "TND", TL: "TRY",
};

let currencyCodes: ReadonlySet<string> | null = null;
/** ISO codes the runtime can name (every currency the platform offers). */
function isCurrencyCode(code: string): boolean {
  if (!currencyCodes) {
    try {
      currencyCodes = new Set(Intl.supportedValuesOf("currency"));
    } catch {
      currencyCodes = new Set();
    }
  }
  if (currencyCodes.size > 0) return currencyCodes.has(code);
  try {
    return new Intl.DisplayNames(["en"], { type: "currency", fallback: "none" }).of(code) !== undefined;
  } catch {
    return false;
  }
}

const SIGN_PATTERN = Object.keys(CURRENCY_SIGNS)
  .sort((a, b) => b.length - a.length)
  .map((s) => s.replace(/[.$]/g, "\\$&"))
  .join("|");
// A written amount: 18 · 18.50 · 18,50 · 1,250.00 · ١٨٫٠٠ (Arabic digits).
const AMOUNT = "[0-9\\u0660-\\u0669]+(?:[,\\u066C\\u00A0\\u202F][0-9\\u0660-\\u0669]{3})*(?:[.,\\u066B][0-9\\u0660-\\u0669]+)?";
const CURRENCY = `(?:\\b[A-Z]{3}\\b|(?:${SIGN_PATTERN})\\.?)`;
const MONEY = new RegExp(`(${CURRENCY})[ \\u00A0\\u202F]?(${AMOUNT})|(${AMOUNT})[ \\u00A0\\u202F]?(${CURRENCY})`, "gu");

function currencyOf(token: string): string | null {
  const t = token.replace(/\.$/, "");
  if (CURRENCY_SIGNS[t]) return CURRENCY_SIGNS[t];
  return /^[A-Z]{3}$/.test(t) && isCurrencyCode(t) ? t : null;
}

function amountValue(written: string, language: SpeechLanguage): number | null {
  let s = written
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[  ٬]/g, "")
    .replace(/٫/g, ".");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both: the last one is the decimal mark.
    s = lastDot > lastComma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    // "18,50" is a decimal; "1,250" a thousand — in French a decimal (1,250 dinars is 1.25).
    const single = (s.match(/,/g) ?? []).length === 1;
    s = single && (s.length - lastComma - 1 !== 3 || language === "fr") ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const value = Number(s);
  return Number.isFinite(value) ? value : null;
}

/**
 * Prices as a voice says them, in the reply's language: "18.00 SAR" → "18 Saudi
 * riyals", "١٨ ر.س" → "18 ريال سعودي", "18,50 €" → "18,5 euros". Read as written,
 * a voice spells a currency code or sign out letter by letter. Amounts keep
 * their value; only how they are written changes. Unknown signs stay as they are.
 */
export function spokenAmounts(text: string, language: SpeechLanguage): string {
  const tag = language === "ar" ? "ar-u-nu-latn" : language;
  return (
    text
      .replace(/[‎‏؜]/g, "")
      .replace(MONEY, (match, curBefore?: string, amountAfter?: string, amountBefore?: string, curAfter?: string) => {
        const code = currencyOf(curBefore ?? curAfter ?? "");
        const value = amountValue(amountAfter ?? amountBefore ?? "", language);
        if (!code || value === null) return match;
        try {
          return new Intl.NumberFormat(tag, {
            style: "currency",
            currency: code,
            currencyDisplay: "name",
            minimumFractionDigits: 0,
            maximumFractionDigits: 3,
          }).format(value);
        } catch {
          return match;
        }
      })
      // "2 × Latte = 36 riyals" is two lattes for 36 riyals, not "two multiplied by latte equals".
      .replace(/(\d)\s*×\s*/g, "$1 ")
      .replace(/\s+=\s+/g, ", ")
  );
}

/** The Agent's voice, as chosen in Agent settings. */
export type VoiceGender = "male" | "female";
export const VOICE_GENDERS: readonly VoiceGender[] = ["male", "female"];
export const DEFAULT_VOICE_GENDER: VoiceGender = "male";

type VoiceLike = { lang: string; name?: string; localService?: boolean; default?: boolean };

/*
 * Browsers don't say whether a voice is male or female, so it is read from
 * the voice's name: the speaker names Apple (iPhone, Mac), Microsoft
 * (Windows, Edge) and Google (Chrome) give their English, Arabic and French
 * voices, plus an explicit "Male"/"Female" in the name.
 */
const MALE_NAMES = new Set([
  // English
  "alex", "aaron", "arthur", "daniel", "fred", "gordon", "oliver", "rishi", "tom", "david", "mark", "george", "james", "richard",
  "guy", "davis", "andrew", "brian", "brandon", "christopher", "eric", "jacob", "jason", "roger", "ryan", "steffan", "thomas",
  "tony", "liam", "william",
  // French
  "nicolas", "paul", "claude", "henri", "alain", "jerome", "maurice", "yves", "remy", "lucien", "antoine", "jean", "thierry",
  // Arabic
  "maged", "majed", "tarik", "naayf", "hamed", "shakir", "hamdan", "fahed", "rami", "taim", "omar", "moaz", "ismael", "ali",
  "bassel", "jamal", "abdullah", "laith", "hedi", "saleh",
]);
const FEMALE_NAMES = new Set([
  // English
  "samantha", "karen", "moira", "tessa", "victoria", "allison", "ava", "susan", "zoe", "nicky", "fiona", "martha", "serena", "kate",
  "zira", "hazel", "catherine", "linda", "heera", "aria", "jenny", "michelle", "sara", "emma", "libby", "sonia", "natasha", "jane",
  "nancy", "amber", "ashley", "cora", "elizabeth", "monica",
  // French
  "amelie", "audrey", "aurelie", "julie", "hortense", "denise", "eloise", "vivienne", "celeste", "coralie", "jacqueline",
  "josephine", "yvette", "sylvie",
  // Arabic
  "laila", "hoda", "zariyah", "salma", "fatima", "amany", "layla", "mouna", "iman", "amina", "rana", "sana", "noura", "aysha",
  "amal", "reem", "maryam",
]);

/** A voice's gender from its name, or null when the name doesn't tell. */
export function voiceGender(name: string | undefined): VoiceGender | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/\bfemale\b/.test(lower)) return "female";
  if (/\bmale\b/.test(lower)) return "male";
  const words = normalizeSpeech(lower)
    .split(" ")
    .map((w) => w.replace(/(multilingual)?(neural)?$/, ""));
  for (const word of words) {
    if (MALE_NAMES.has(word)) return "male";
    if (FEMALE_NAMES.has(word)) return "female";
  }
  return null;
}

/** The newer, human-sounding voices (Edge "Natural", Apple "Enhanced"/"Premium", Google/Microsoft "Neural"). */
const NATURAL_VOICE = /natural|neural|enhanced|premium|siri/i;

/**
 * A voice for the reply's language: the chosen gender first, then the
 * most natural-sounding voice, the exact region, a voice on the device.
 * With no voice of the chosen gender in that language the device's own
 * voice for the language is used (never silence for a voice preference);
 * with no voice of the language at all, none — reading Arabic with an
 * English voice is worse than silence.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string, gender?: VoiceGender): V | null {
  const norm = (l: string) => l.toLowerCase().replace("_", "-");
  const want = norm(lang);
  const base = want.split("-")[0];
  const same = voices.filter((v) => norm(v.lang).split("-")[0] === base);
  if (same.length === 0) return null;
  const rank = (v: V) => {
    const g = gender ? voiceGender(v.name) : null;
    return (
      (gender ? (g === gender ? 0 : g === null ? 50 : 100) : 0) +
      (norm(v.lang) === want ? 0 : 10) +
      (NATURAL_VOICE.test(v.name ?? "") ? 0 : 3) +
      (v.localService ? 0 : 1)
    );
  };
  return [...same].sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * A reply split into its sentences, read one after another: the short
 * natural pauses between them make delivery calmer and clearer (and keep
 * every utterance short — some browsers cut long ones off).
 */
export function speechChunks(text: string): string[] {
  // A decimal point ("18.5 riyals") doesn't end a sentence.
  const DECIMAL = "\uE000";
  const sentences = text.replace(/(\d)\.(?=\d)/g, `$1${DECIMAL}`).match(/[^.!?؟…\n]+(?:[.!?؟…]+|\n|$)/g) ?? [text];
  const chunks: string[] = [];
  for (const sentence of sentences.map((s) => s.split(DECIMAL).join(".").trim()).filter(Boolean)) {
    const last = chunks[chunks.length - 1];
    // Very short pieces ("OK." "1.") stay with the sentence before them, after a pause (one line of a list each).
    if (last && (sentence.length < 12 || last.length < 12) && last.length + sentence.length < 160)
      chunks[chunks.length - 1] = `${/[.!?؟…,،:;]$/.test(last) ? last : `${last},`} ${sentence}`;
    else chunks.push(sentence);
  }
  return chunks;
}

/** Delivery: unhurried, natural pitch (shifting the pitch of a good voice makes it sound synthetic). */
export const SPEECH_RATE = 0.97;

/** A language the Agent speaks, for a sentence of speech. */
export type SpeechLanguage = "en" | "ar" | "fr";

/**
 * The sentences to speak, in order, each with the language of the part it
 * came from (an Arabic introduction, then a greeting typed in English).
 * Shared by the premium voice (the server generates exactly these
 * sentences) and the device-voice fallback, so both speak the same pieces.
 */
export function speechSentences(parts: readonly string[], locale: string): { text: string; language: SpeechLanguage }[] {
  const out: { text: string; language: SpeechLanguage }[] = [];
  for (const part of parts) {
    const written = spokenText(part);
    if (!written) continue;
    const detected = replyLanguage(written, locale);
    const language: SpeechLanguage = detected === "ar" || detected === "fr" ? detected : "en";
    for (const chunk of speechChunks(spokenAmounts(written, language))) out.push({ text: chunk, language });
  }
  return out;
}

/**
 * What to say, sentence by sentence, and with which voice: each part in the
 * language it is written in (an Arabic introduction, then a greeting the
 * business typed in English), in the business's chosen voice gender.
 * Parts with no voice for their language are skipped — unless the browser
 * hasn't listed its voices yet, when the language tag alone picks one.
 */
export function planSpeech<V extends VoiceLike>(
  parts: readonly string[],
  options: { locale: string; gender: VoiceGender; voices: readonly V[]; browserLanguages?: readonly string[] },
): { text: string; lang: string; voice: V | null }[] {
  const plan: { text: string; lang: string; voice: V | null }[] = [];
  for (const part of parts) {
    const written = spokenText(part);
    if (!written) continue;
    const detected = replyLanguage(written, options.locale);
    const lang = speechLang(detected, options.browserLanguages ?? []);
    const voice = pickVoice(options.voices, lang, options.gender);
    if (!voice && options.voices.length > 0) continue;
    const language: SpeechLanguage = detected === "ar" || detected === "fr" ? detected : "en";
    for (const chunk of speechChunks(spokenAmounts(written, language))) plan.push({ text: chunk, lang: voice?.lang ?? lang, voice });
  }
  return plan;
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
