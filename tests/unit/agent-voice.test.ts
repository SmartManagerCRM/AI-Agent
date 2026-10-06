import { describe, expect, it } from "vitest";

import {
  normalizeSpeech,
  pickTranscript,
  pickVoice,
  planSpeech,
  replyLanguage,
  speechChunks,
  speechLang,
  speechSentences,
  speechVocabulary,
  spokenAmounts,
  spokenText,
  voiceErrorKey,
  voiceGender,
} from "@/components/agent-public/voice";

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
  });

  it("smooths typed punctuation so the greeting flows (words unchanged)", () => {
    expect(
      spokenText("Am your AI ordering assistant!, .. We have plenty of delicious dishes in the menu today! ... You can enjoy browsing them , or I can assist you if you want !!"),
    ).toBe("Am your AI ordering assistant! We have plenty of delicious dishes in the menu today! You can enjoy browsing them, or I can assist you if you want!");
    expect(spokenText("Welcome... to Roasters Café!!")).toBe("Welcome, to Roasters Café!");
    expect(spokenText("Latte 18.50 SAR, Mocha 20.00 SAR.")).toBe("Latte 18.50 SAR, Mocha 20.00 SAR.");
    expect(spokenText("مرحبا بك !! كيف أساعدك ؟؟")).toBe("مرحبا بك! كيف أساعدك؟");
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

  it("tells a voice's gender from its name (Apple, Microsoft, Google), or says it can't", () => {
    expect(voiceGender("Microsoft Guy Online (Natural) - English (United States)")).toBe("male");
    expect(voiceGender("Microsoft Aria Online (Natural) - English (United States)")).toBe("female");
    expect(voiceGender("Microsoft AvaMultilingual Online (Natural) - English (United States)")).toBe("female");
    expect(voiceGender("ar-SA-HamedNeural")).toBe("male");
    expect(voiceGender("Microsoft Zariyah Online (Natural) - Arabic (Saudi Arabia)")).toBe("female");
    expect(voiceGender("Maged")).toBe("male");
    expect(voiceGender("Samantha (Enhanced)")).toBe("female");
    expect(voiceGender("Amélie")).toBe("female");
    expect(voiceGender("Google UK English Male")).toBe("male");
    expect(voiceGender("Google UK English Female")).toBe("female");
    expect(voiceGender("Google US English")).toBeNull();
    expect(voiceGender("en-us-x-iom-local")).toBeNull();
  });

  it("speaks with the chosen gender's most natural voice, else the device's own voice — never silence", () => {
    const voices = [
      { lang: "en-US", name: "Microsoft Zira - English (United States)", localService: true },
      { lang: "en-US", name: "Microsoft David - English (United States)", localService: true },
      { lang: "en-US", name: "Microsoft Guy Online (Natural) - English (United States)", localService: false },
      { lang: "en-US", name: "Microsoft Aria Online (Natural) - English (United States)", localService: false },
      { lang: "ar-SA", name: "Google العربية", localService: false },
    ];
    expect(pickVoice(voices, "en-US", "male")?.name).toContain("Guy");
    expect(pickVoice(voices, "en-US", "female")?.name).toContain("Aria");
    // Only an unnamed Arabic voice: used for either gender.
    expect(pickVoice(voices, "ar-SA", "male")?.name).toBe("Google العربية");
    expect(pickVoice(voices, "fr-FR", "male")).toBeNull();
  });

  it("reads sentence by sentence, keeping tiny pieces together", () => {
    expect(speechChunks("Great choice! Here are some options. OK.")).toEqual(["Great choice!", "Here are some options. OK."]);
    expect(speechChunks("أهلاً! كيف يمكنني مساعدتك؟ لدينا قهوة طازجة كل يوم.")).toEqual(["أهلاً! كيف يمكنني مساعدتك؟", "لدينا قهوة طازجة كل يوم."]);
    expect(speechChunks("No punctuation here")).toEqual(["No punctuation here"]);
  });

  it("plans the greeting: each part in its own language, in the chosen voice", () => {
    const voices = [
      { lang: "ar-SA", name: "Maged", localService: true },
      { lang: "ar-SA", name: "Laila", localService: true },
      { lang: "en-US", name: "Daniel", localService: true },
      { lang: "en-US", name: "Samantha", localService: true },
    ];
    const plan = planSpeech(["أهلاً! أنا Doudi.", "Welcome to Qahwa! Fresh coffee, ready when you are."], { locale: "ar", gender: "female", voices });
    expect(plan.map((p) => `${p.voice?.name}: ${p.text}`)).toEqual([
      "Laila: أهلاً! أنا Doudi.",
      "Samantha: Welcome to Qahwa!",
      "Samantha: Fresh coffee, ready when you are.",
    ]);
    expect(planSpeech(["Bonjour !"], { locale: "fr", gender: "male", voices })).toEqual([]); // no French voice
    expect(planSpeech(["Hello there."], { locale: "en", gender: "male", voices: [] })[0]).toMatchObject({ lang: "en-US", voice: null });
  });

  it("says prices as words in the reply's language, never spelling out a currency code or sign", () => {
    expect(spokenAmounts("• Spanish Latte — 18.00 SAR", "en")).toBe("• Spanish Latte — 18 Saudi riyals");
    expect(spokenAmounts("Latte 18.50 SAR, Mocha 1 SAR.", "en")).toBe("Latte 18.5 Saudi riyals, Mocha 1 Saudi riyal.");
    expect(spokenAmounts("Total: 1,250.00 SAR · Only $5 · EUR 3.5", "en")).toBe("Total: 1,250 Saudi riyals · Only 5 US dollars · 3.5 euros");
    expect(spokenAmounts("سعر اللاتيه 18.00 SAR", "ar")).toBe("سعر اللاتيه 18 ريال سعودي");
    expect(spokenAmounts("السعر \u200F١٨٫٠٠ ر.س.\u200F", "ar")).toBe("السعر 18 ريال سعودي");
    expect(spokenAmounts("Prix : 18,50 € — total 12.500 TND", "fr")).toBe("Prix : 18,5 euros — total 12,5 dinars tunisiens");
    expect(spokenAmounts("Total 1,250 DT", "fr")).toBe("Total 1,25 dinar tunisien");
    expect(spokenAmounts("2 × Latte = 36.00 SAR", "en")).toBe("2 Latte, 36 Saudi riyals");
    // Not prices: left as written.
    expect(spokenAmounts("Ref ABC 123, USB 3, order #12 at 5 pm", "en")).toBe("Ref ABC 123, USB 3, order #12 at 5 pm");
  });

  it("reads a price list line by line, never stopping at a decimal point", () => {
    expect(speechChunks("Mocha — 20.5 riyals. Would you like anything else?")).toEqual(["Mocha — 20.5 riyals.", "Would you like anything else?"]);
    expect(speechSentences(["Here are our coffees:\n• Latte — 18.00 SAR\n• Mocha — 20.50 SAR"], "en")).toEqual([
      { text: "Here are our coffees:", language: "en" },
      { text: "Latte — 18 Saudi riyals", language: "en" },
      { text: "Mocha — 20.5 Saudi riyals", language: "en" },
    ]);
    expect(speechSentences(["قهوتنا:\n• لاتيه — 18.00 SAR"], "ar")).toEqual([{ text: "قهوتنا: لاتيه — 18 ريال سعودي", language: "ar" }]);
  });
});
