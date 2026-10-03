"use client";

import { useActionState, useRef, useState } from "react";

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
const GREETING_LANGUAGES: { value: Locale; label: string; dir: "ltr" | "rtl"; hi: (name: string) => string; fallback: string }[] = [
  { value: "en", label: "English", dir: "ltr", hi: (n) => `Hi! I'm ${n}.`, fallback: "How can I help you today?" },
  { value: "ar", label: "العربية (Arabic)", dir: "rtl", hi: (n) => `أهلاً! أنا ${n}.`, fallback: "كيف يمكنني مساعدتك اليوم؟" },
  { value: "fr", label: "Français (French)", dir: "ltr", hi: (n) => `Bonjour ! Je suis ${n}.`, fallback: "Comment puis-je vous aider aujourd'hui ?" },
];

/** The two Agent voices, with the character each is chosen for. */
const VOICES: { value: VoiceGender; label: string; description: string }[] = [
  {
    value: "male",
    label: "Male",
    description: "Around 28–35. Warm, confident and professional — friendly but calm, short clear sentences.",
  },
  {
    value: "female",
    label: "Female",
    description: "The same personality: warm, intelligent and approachable — natural, calm delivery, never robotic.",
  },
];

export function AgentSettingsForm({ tenantId, slug, locale, current, greetings, premiumVoices }: Props) {
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

  // Speaks the name and greeting as typed, with this device's voice of the chosen gender — what a
  // customer on the same kind of phone or computer hears.
  const preview = async () => {
    previewAudio.current?.pause();
    if (premiumVoices[voice]) {
      // Premium voice: generated on the server (and cached), played here.
      const audio = (previewAudio.current ??= new Audio());
      setPreviewing(true);
      setPreviewNote("Generating the premium voice…");
      const result = await previewAgentVoiceAction({
        locale,
        slug,
        gender: voice,
        name: nameRef.current?.value ?? "",
        greeting: greetingRefs.current[previewLang]?.value ?? "",
        language: previewLang,
      }).catch(() => ({ ok: false as const, message: "The premium voice didn't answer — please try again." }));
      setPreviewing(false);
      if (!result.ok) {
        setPreviewNote(result.message);
        return;
      }
      audio.src = `data:audio/mpeg;base64,${result.audio}`;
      await audio.play().catch(() => {});
      setPreviewNote(`Playing the premium ${voice} voice${result.voiceName ? ` (“${result.voiceName}”)` : ""}.`);
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setPreviewNote("This browser can't speak — try Chrome, Safari or Edge.");
      return;
    }
    const synth = window.speechSynthesis;
    const name = nameRef.current?.value.trim() || "your assistant";
    const greeting = greetingRefs.current[previewLang]?.value.trim() || lang.fallback;
    const plan = planSpeech([lang.hi(name), greeting], { locale: previewLang, gender: voice, voices: synth.getVoices(), browserLanguages: navigator.languages });
    if (plan.length === 0) {
      setPreviewNote("This device has no voice for that language.");
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
    setPreviewNote(used ? `Playing on this device with “${used}”.` : "Playing with this device's default voice.");
  };

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1 text-sm">
        Assistant name
        <input
          ref={nameRef}
          name="assistantName"
          defaultValue={current.assistant_name ?? ""}
          maxLength={80}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <fieldset className="flex flex-col gap-2 text-sm" data-testid="agent-greetings">
        <legend className="mb-1">Greeting</legend>
        {GREETING_LANGUAGES.map((l) => (
          <label key={l.value} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">{l.label}</span>
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
          Shown on your Agent&apos;s page and in the chat, and spoken when a customer opens it — in the language the customer
          picks, every time they change it. A language left empty uses the greeting shown in grey.
        </span>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        Tone
        <select name="tone" defaultValue={current.tone ?? "friendly"} className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="friendly">Friendly</option>
          <option value="formal">Formal</option>
          <option value="playful">Playful</option>
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm" data-testid="agent-voice">
        <legend className="mb-1">Voice</legend>
        <div className="grid grid-cols-2 gap-2">
          {VOICES.map((v) => (
            <label
              key={v.value}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition ${
                voice === v.value ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-neutral-300 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2 font-medium text-slate-900">
                <input type="radio" name="voice" value={v.value} checked={voice === v.value} onChange={() => setVoice(v.value)} className="accent-emerald-600" />
                {v.label}
              </span>
              <span className="text-xs leading-snug text-slate-500">{v.description}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={preview} disabled={previewing}>
            ▶ Preview voice ({lang.label.split(" ")[0]})
          </Button>
          {previewNote && (
            <span className="text-xs text-slate-500" role="status">
              {previewNote}
            </span>
          )}
        </div>
        {premiumVoices[voice] ? (
          <p className="text-xs text-slate-500">
            Premium voice: every customer hears this same natural {voice} voice, on any phone or computer, in English, Arabic and
            French. Phrases your Agent repeats (like your greeting) are prepared once and reused.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Your Agent speaks with each customer&apos;s own phone or computer voice — free, no AI cost. It picks that device&apos;s
            most natural voice of the gender you choose; a device without one uses its standard voice.
          </p>
        )}
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        Save
      </Button>
    </form>
  );
}
