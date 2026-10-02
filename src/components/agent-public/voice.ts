/**
 * Pure helpers for the Agent's voice mode. Speech is recognised and spoken
 * by the customer's own browser (Web Speech API), so talking to the Agent
 * costs exactly what typing does: the transcript goes through the same
 * deterministic-first chat, and no audio is ever sent to an AI model.
 */

const DEFAULT_REGION: Record<string, string> = { ar: "ar-SA", en: "en-US", fr: "fr-FR" };

/** The recognition language: the Agent's language, in the customer's own regional variant when their browser has one (e.g. ar-EG). */
export function speechLang(locale: string, browserLanguages: readonly string[] = []): string {
  const base = locale.toLowerCase().split("-")[0];
  const regional = browserLanguages.find((l) => l.toLowerCase().split("-")[0] === base && l.includes("-"));
  return regional ?? DEFAULT_REGION[base] ?? locale;
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
