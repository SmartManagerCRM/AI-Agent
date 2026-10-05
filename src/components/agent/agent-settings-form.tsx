"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useRef, useState } from "react";

import { Button } from "@/components/console/button";
import { DEFAULT_VOICE_GENDER, planSpeech, SPEECH_RATE, type VoiceGender } from "@/components/agent-public/voice";
import { updateAgentSettingsAction } from "@/server/ai/actions";
import type { AgentGreetings } from "@/lib/agent-greeting";
import type { Locale } from "@/i18n/locales";
import { previewAgentVoiceAction } from "@/server/voice/actions";

type Props = {
  tenantId: string;
  slug: string;
  locale: string;
  current: { active: boolean; assistant_name: string | null; tone: string | null; voice?: VoiceGender | null };
  /** The greeting saved for each language (an older single greeting under the language it's written in). */
  greetings: AgentGreetings;
  /** The premium voice set up for each gender (its name), or null where the device voice is used. */
  premiumVoices: Record<VoiceGender, string | null>;
};

/** One greeting per language the Agent speaks; the customer hears the one for the language they pick. */
const GREETING_LANGUAGES: { value: Locale; native: string; dir: "ltr" | "rtl"; hi: (name: string) => string; fallback: string }[] = [
  { value: "en", native: "English", dir: "ltr", hi: (n) => `Hi! I'm ${n}.`, fallback: "How can I help you today?" },
  { value: "ar", native: "العربية", dir: "rtl", hi: (n) => `أهلاً! أنا ${n}.`, fallback: "كيف يمكنني مساعدتك اليوم؟" },
  { value: "fr", native: "Français", dir: "ltr", hi: (n) => `Bonjour ! Je suis ${n}.`, fallback: "Comment puis-je vous aider aujourd'hui ?" },
];

/** The two Agent voices, with the character each is chosen for. */
const VOICES: VoiceGender[] = ["male", "female"];

export function AgentSettingsForm({ tenantId, slug, locale, current, greetings, premiumVoices }: Props) {
const t = useTranslations("console.agentSettings");
  const [error, formAction, pending] = useActionState(updateAgentSettingsAction, undefined);
  const [voice, setVoice] = useState<VoiceGender>(current.voice ?? DEFAULT_VOICE_GENDER);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const greetingRefs = useRef<Partial<Record<Locale, HTMLInputElement | null>>>({});
  // Preview speaks the greeting of the language whose field was used last.
  const [previewLang, setPreviewLang] = useState<Locale>(
    () => GREETING_LANGUAGES.find((l) => greetings[l.value])?.value ?? "en",
  );
  const lang = GREETING_LANGUAGES.find((l) => l.value === previewLang) ?? GREETING_LANGUAGES[0];
  // The language's own name, and — when the console is in another language — its name in that language too.
  const languageLabel = (l: (typeof GREETING_LANGUAGES)[number]) => (l.value === locale ? l.native : `${l.native} (${t(`lang.${l.value}`)})`);

  // Speaks the name and greeting as typed, with this device's voice of the chosen gender — what a
  // customer on the same kind of phone or computer hears.
  const preview = async () => {
    previewAudio.current?.pause();
    if (premiumVoices[voice]) {
      // Premium voice: generated on the server (and cached), played here.
      const audio = (previewAudio.current ??= new Audio());
      setPreviewing(true);
      setPreviewNote(t("generating"));
      const result = await previewAgentVoiceAction({
        locale,
        slug,
        gender: voice,
        name: nameRef.current?.value ?? "",
        greeting: greetingRefs.current[previewLang]?.value ?? "",
        language: previewLang,
      }).catch(() => ({ ok: false as const, message: t("noAnswer") }));
      setPreviewing(false);
      if (!result.ok) {
        setPreviewNote(result.message);
        return;
      }
      audio.src = `data:audio/mpeg;base64,${result.audio}`;
      await audio.play().catch(() => {});
      setPreviewNote(t("playingPremium", { gender: t(voice), name: result.voiceName ? ` (“${result.voiceName}”)` : "" }));
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setPreviewNote(t("cantSpeak"));
      return;
    }
    const synth = window.speechSynthesis;
    const name = nameRef.current?.value.trim() || t("yourAssistant");
    const greeting = greetingRefs.current[previewLang]?.value.trim() || lang.fallback;
    const plan = planSpeech([lang.hi(name), greeting], { locale: previewLang, gender: voice, voices: synth.getVoices(), browserLanguages: navigator.languages });
    if (plan.length === 0) {
      setPreviewNote(t("noVoice"));
      return;
    }
    synth.cancel();
    for (const part of plan) {
      const u = new SpeechSynthesisUtterance(part.text);
      u.lang = part.lang;
      if (part.voice) u.voice = part.voice;
      u.rate = SPEECH_RATE;
      synth.speak(u);
    }
    const used = plan[plan.length - 1].voice?.name;
    setPreviewNote(used ? t("playingDevice", { name: used }) : t("playingDefault"));
  };

  return (
    <form
      action={formAction}
      // Submitted by hand so React doesn't reset the form after saving: a reset puts every field back
      // to what it showed when the page opened (the voice to "male"), and the next save would store that.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex max-w-md flex-col gap-3"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1 text-sm">
        {t("assistantName")}
        <input
          ref={nameRef}
          name="assistantName"
          defaultValue={current.assistant_name ?? ""}
          maxLength={80}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <fieldset className="flex flex-col gap-2 text-sm" data-testid="agent-greetings">
        <legend className="mb-1">{t("greeting")}</legend>
        {GREETING_LANGUAGES.map((l) => (
          <label key={l.value} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">{languageLabel(l)}</span>
            <input
              ref={(el) => {
                greetingRefs.current[l.value] = el;
              }}
              name={`greeting_${l.value}`}
              lang={l.value}
              dir={l.dir}
              defaultValue={greetings[l.value] ?? ""}
              maxLength={300}
              placeholder={l.fallback}
              onFocus={() => setPreviewLang(l.value)}
              className="rounded-md border border-neutral-300 px-3 py-2"
            />
          </label>
        ))}
        <span className="text-xs text-slate-500">
          {t("greetingHint")}
        </span>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        {t("toneLabel")}
        <select name="tone" defaultValue={current.tone ?? "friendly"} className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="friendly">{t("tone.friendly")}</option>
          <option value="formal">{t("tone.formal")}</option>
          <option value="playful">{t("tone.playful")}</option>
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm" data-testid="agent-voice">
        <legend className="mb-1">{t("voiceLabel")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {VOICES.map((v) => (
            <label
              key={v}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition ${
                voice === v ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-neutral-300 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2 font-medium text-slate-900">
                <input type="radio" name="voice" value={v} checked={voice === v} onChange={() => setVoice(v)} className="accent-emerald-600" />
                {t(v)}
              </span>
              <span className="text-xs leading-snug text-slate-500">{t(`${v}Description`)}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={preview} disabled={previewing}>
            {t("preview", { language: lang.native })}
          </Button>
          {previewNote && (
            <span className="text-xs text-slate-500" role="status">
              {previewNote}
            </span>
          )}
        </div>
        {premiumVoices[voice] ? (
          <p className="text-xs text-slate-500">
            {t("premiumNote", { gender: t(voice) })}
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            {t("deviceNote")}
          </p>
        )}
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {t("save")}
      </Button>
    </form>
  );
}
