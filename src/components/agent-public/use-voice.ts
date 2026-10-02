"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { pickTranscript, pickVoice, replyLanguage, speechLang, speechVocabulary, spokenText, voiceErrorKey } from "./voice";

/** The parts of the Web Speech API used here (not every TypeScript DOM lib ships them). */
type RecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function synthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

// Browser capabilities never change while the page is open; the server never knows them.
const noSubscription = () => () => {};
const onServer = () => false;

/** Whether this browser can transcribe speech (the mic is only offered where it works). */
export function useCanListen(): boolean {
  return useSyncExternalStore(noSubscription, () => recognitionCtor() !== null, onServer);
}

const MUTED_KEY = "agent-voice-muted";
const MUTED_EVENT = "agent-voice-muted";
function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeMuted(onChange: () => void) {
  window.addEventListener(MUTED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MUTED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The customer's "Agent voice off" choice, remembered on this device: no
 * spoken greeting and no replies read automatically (Listen still works).
 */
export function useVoiceMuted(): [boolean, (muted: boolean) => void] {
  const muted = useSyncExternalStore(subscribeMuted, readMuted, onServer);
  const setMuted = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(MUTED_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
    window.dispatchEvent(new Event(MUTED_EVENT));
  }, []);
  return [muted, setMuted];
}

/**
 * Voice for the Customer Agent, entirely in the browser: speech → text with
 * the Web Speech API's recognition, replies → speech with `speechSynthesis`.
 * No audio leaves the page for an AI model, so a spoken message costs the
 * same as a typed one. Unsupported browsers simply don't offer the mic.
 */
/** How many guesses to ask the recognizer for (free: they come from the same recognition). */
const ALTERNATIVES = 5;

export function useVoice({
  locale,
  names,
  onInterim,
  onFinal,
}: {
  locale: string;
  /** This business's own product, category and service names (every language) — what customers are likely to say. */
  names: readonly string[];
  /** The words heard so far (shown in the composer while listening). */
  onInterim: (text: string) => void;
  /** The finished transcript — sent as the customer's message. */
  onFinal: (text: string) => void;
}) {
  const canListen = useCanListen();
  const canSpeak = useSyncExternalStore(noSubscription, synthesisSupported, onServer);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const transcriptRef = useRef("");
  const sentRef = useRef(false);
  const callbacks = useRef({ onInterim, onFinal });
  useEffect(() => {
    callbacks.current = { onInterim, onFinal };
  }, [onInterim, onFinal]);

  // Asking once starts the (lazy) voice list loading, so it's ready by the first reply.
  useEffect(() => {
    if (synthesisSupported()) window.speechSynthesis.getVoices();
  }, []);

  const vocabulary = useMemo(() => speechVocabulary(names), [names]);
  const vocabularyRef = useRef(vocabulary);
  useEffect(() => {
    vocabularyRef.current = vocabulary;
  }, [vocabulary]);

  const lang = speechLang(locale, typeof navigator === "undefined" ? [] : (navigator.languages ?? []));

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  /**
   * Reads text aloud with the browser's own voice. Several parts are read
   * one after the other, each in the language it is written in (an Arabic
   * introduction, then a greeting the business typed in English).
   * `onStart` fires once the browser actually starts speaking — browsers
   * refuse to speak before the customer's first tap on the page.
   */
  const speak = useCallback(
    (id: number, reply: string | string[], options?: { onStart?: () => void }) => {
      if (!canSpeak) return false;
      const synth = window.speechSynthesis;
      const utterances: SpeechSynthesisUtterance[] = [];
      for (const part of Array.isArray(reply) ? reply : [reply]) {
        const text = spokenText(part);
        if (!text) continue;
        const partLang = speechLang(replyLanguage(text, locale), navigator.languages ?? []);
        const voice = pickVoice(synth.getVoices(), partLang);
        // Voices load lazily on some browsers; with none listed yet the language tag alone picks one.
        if (!voice && synth.getVoices().length > 0) continue;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = voice?.lang ?? partLang;
        if (voice) utterance.voice = voice;
        utterances.push(utterance);
      }
      if (utterances.length === 0) return false;
      synth.cancel();
      const done = () => setSpeakingId((current) => (current === id ? null : current));
      utterances[0].onstart = () => options?.onStart?.();
      utterances.forEach((u, i) => {
        u.onerror = done;
        if (i === utterances.length - 1) u.onend = done;
      });
      setSpeakingId(id);
      for (const u of utterances) synth.speak(u);
      return true;
    },
    [canSpeak, locale],
  );

  const finish = useCallback(() => {
    const text = transcriptRef.current.trim();
    if (text && !sentRef.current) {
      sentRef.current = true;
      callbacks.current.onFinal(text);
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognitionRef.current) return;
    stopSpeaking();
    // iOS only lets a page speak after a tap: an empty utterance now unlocks the spoken reply later.
    if (canSpeak) {
      const unlock = new SpeechSynthesisUtterance(" ");
      unlock.volume = 0;
      window.speechSynthesis.speak(unlock);
    }
    setErrorKey(null);
    transcriptRef.current = "";
    sentRef.current = false;
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = ALTERNATIVES;
    recognition.onresult = (e) => {
      let text = "";
      let final = true;
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        // Words still being heard show the recognizer's first guess; a finished phrase takes the guess that fits the menu best.
        const guesses = Array.from({ length: result.isFinal ? result.length : Math.min(result.length, 1) }, (_, k) => result[k].transcript);
        text += result.isFinal ? pickTranscript(guesses, vocabularyRef.current) : (guesses[0] ?? "");
        if (!result.isFinal) final = false;
      }
      transcriptRef.current = text;
      callbacks.current.onInterim(text);
      if (final) finish();
    };
    recognition.onerror = (e) => setErrorKey(voiceErrorKey(e.error));
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      // Some browsers end without marking the last result final: what was heard is still the message.
      finish();
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setErrorKey("voice.failed");
    }
  }, [canSpeak, finish, lang, stopSpeaking]);

  const stop = useCallback(() => recognitionRef.current?.stop(), []);

  // Leaving the chat stops the mic and any reply being read.
  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );

  return {
    canListen,
    canSpeak,
    listening,
    speakingId,
    errorKey,
    clearError: () => setErrorKey(null),
    start,
    stop,
    speak,
    stopSpeaking,
  };
}
