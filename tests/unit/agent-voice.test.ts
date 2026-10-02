import { describe, expect, it } from "vitest";

import { normalizeSpeech, pickTranscript, pickVoice, replyLanguage, speechLang, speechVocabulary, spokenText, voiceErrorKey } from "@/components/agent-public/voice";

describe("Agent voice (browser speech, no AI)", () => {
  it("listens in the Agent's language: Arabic in the customer's own dialect, English and French in one standard accent", () => {
    expect(speechLang("ar")).toBe("ar-SA");
    expect(speechLang("ar", ["en-GB", "ar-EG"])).toBe("ar-EG");
    expect(speechLang("ar", ["ar"])).toBe("ar-SA"); // a bare language tag isn't a dialect
    expect(speechLang("en", ["en-IN", "hi-IN"])).toBe("en-US"); // never the phone's other English variant
    expect(speechLang("en", ["ar-AE"])).toBe("en-US");
    expect(speechLang("fr", ["fr-MA", "ar"])).toBe("fr-FR");
  });

  it("compares spoken and written forms (case, accents, Arabic diacritics and letter forms)", () => {
    expect(normalizeSpeech("Café Glacé!")).toBe("cafe glace");
    expect(normalizeSpeech("أضِفْ قهوة إلى السلّة")).toBe("اضف قهوه الي السله");
  });

  it("takes the recognizer's guess that fits this business's menu", () => {
    const vocabulary = speechVocabulary(["Iced Coffee", "Spanish Latte", "قهوة مثلجة", "Drinks", "Desserts"]);
    // The live misrecognitions: a top guess that names nothing on the menu loses to one that does.
    expect(pickTranscript(["Kapil", "coffee", "copy"], vocabulary)).toBe("coffee");
    expect(pickTranscript(["Aditya ka", "add it to cart", "add it to the car"], vocabulary)).toBe("add it to cart");
    expect(pickTranscript(["ابغى قهوه مثلجه", "ابغى قهوة"], vocabulary)).toBe("ابغى قهوه مثلجه");
    // A tie keeps the recognizer's own first guess; nothing to choose from keeps it too.
    expect(pickTranscript(["hi how are you", "hi how are ya"], vocabulary)).toBe("hi how are you");
    expect(pickTranscript(["Spanish latte please"], vocabulary)).toBe("Spanish latte please");
    expect(pickTranscript([], vocabulary)).toBe("");
  });

  it("reads replies without links, emoji or formatting marks", () => {
    expect(spokenText("Your order is ready 🎉👍🏽\nPay here: https://pay.example.com/abc?x=1 thanks")).toBe("Your order is ready\nPay here: thanks");
    expect(spokenText("**Latte** — 18 SAR\n- Mocha\n• Tea")).toBe("Latte — 18 SAR\nMocha\nTea");
    expect(spokenText("مرحبًا 👋 كيف يمكنني مساعدتك؟")).toBe("مرحبًا كيف يمكنني مساعدتك؟");
    expect(spokenText("https://only.a/link")).toBe("");
  });

  it("speaks only with a voice of the reply's language — exact region first", () => {
    const voices = [
      { lang: "en-US", localService: true },
      { lang: "ar-EG", localService: false },
      { lang: "ar_SA", localService: true },
      { lang: "fr-CA", localService: true },
    ];
    expect(pickVoice(voices, "ar-SA")?.lang).toBe("ar_SA");
    expect(pickVoice(voices, "ar-EG")?.lang).toBe("ar-EG");
    expect(pickVoice(voices, "fr-FR")?.lang).toBe("fr-CA");
    expect(pickVoice([{ lang: "en-US" }], "ar-SA")).toBeNull();
  });

  it("reads a reply in the language it is written in", () => {
    expect(replyLanguage("ساعات العمل اليوم 07:00–23:59", "ar")).toBe("ar");
    expect(replyLanguage("Al Rawdah is open today 07:00–23:59.", "ar")).toBe("en"); // English text in the Arabic Agent
    expect(replyLanguage("Nous sommes ouverts aujourd'hui.", "fr")).toBe("fr");
    expect(replyLanguage("لاتيه — Spanish Latte 18 SAR", "en")).toBe("en"); // mostly Latin
    expect(replyLanguage("مرحبا! Latte", "en")).toBe("ar");
  });

  it("explains recognition failures; a deliberate stop is silent", () => {
    expect(voiceErrorKey("not-allowed")).toBe("voice.blocked");
    expect(voiceErrorKey("no-speech")).toBe("voice.noSpeech");
    expect(voiceErrorKey("aborted")).toBeNull();
    expect(voiceErrorKey("something-new")).toBe("voice.failed");
  });
});
