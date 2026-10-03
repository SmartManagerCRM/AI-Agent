import { LOCALES, type Locale } from "@/i18n/locales";

/** The welcome greeting a business saved for each language its Agent speaks (Agent settings). */
export type AgentGreetings = Partial<Record<Locale, string>>;

/** The greeting fields of `tenant_settings.agent`. */
export type GreetingSettings = { greeting?: string | null; greetings?: AgentGreetings | null } | null | undefined;

const FRENCH_LETTERS = /[àâæçéèêëîïôœùûüÿ]/i;
const FRENCH_WORDS = [
  "bonjour", "bonsoir", "bienvenue", "salut", "je suis", "votre", "vous", "nous", "notre", "avec", "aujourd", "comment",
  "merci", "plats", "commander", "aider", "c'est", "il y a", "des ", "les ", "une ", "est ",
];

/**
 * The language a greeting is written in: Arabic script → Arabic; French
 * letters or common French words → French; otherwise English. Only used for
 * a greeting saved before greetings were kept per language.
 */
export function greetingLanguage(text: string): Locale {
  const arabic = (text.match(/\p{Script=Arabic}/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  if (arabic > 0 && arabic >= latin) return "ar";
  const lower = ` ${text.toLowerCase()} `;
  if (FRENCH_LETTERS.test(text) || FRENCH_WORDS.some((w) => lower.includes(` ${w}`))) return "fr";
  return "en";
}

/** The saved greetings by language, reading a single older greeting as the language it's written in. */
export function savedGreetings(agent: GreetingSettings): AgentGreetings {
  if (agent?.greetings && typeof agent.greetings === "object") {
    const out: AgentGreetings = {};
    for (const l of LOCALES) {
      const text = agent.greetings[l]?.trim();
      if (text) out[l] = text;
    }
    return out;
  }
  const legacy = agent?.greeting?.trim();
  return legacy ? { [greetingLanguage(legacy)]: legacy } : {};
}

/**
 * The greeting the Agent shows and speaks in `locale`: the one saved for
 * that language, or null — the caller then uses the built-in greeting in
 * that language, so a customer who picks Arabic is never greeted in English.
 */
export function greetingFor(agent: GreetingSettings, locale: string): string | null {
  return (LOCALES as readonly string[]).includes(locale) ? (savedGreetings(agent)[locale as Locale] ?? null) : null;
}
