import { describe, expect, it } from "vitest";

import { greetingFor, greetingLanguage, savedGreetings } from "@/lib/agent-greeting";
import { matchDeterministic, type BrainSnapshot } from "@/server/ai/deterministic/match";

describe("Agent greeting per language", () => {
  it("tells which language a greeting is written in", () => {
    expect(greetingLanguage("Am your AI ordering assistant! We have plenty of delicious dishes in the menu today!")).toBe("en");
    expect(greetingLanguage("أهلاً بك! كيف يمكنني مساعدتك؟")).toBe("ar");
    expect(greetingLanguage("Bienvenue ! Nous avons de bons plats aujourd'hui.")).toBe("fr");
    expect(greetingLanguage("Comment puis-je vous aider ?")).toBe("fr");
  });

  it("reads an older single greeting as the language it's written in", () => {
    const agent = { greeting: "Welcome to our cafe!" };
    expect(savedGreetings(agent)).toEqual({ en: "Welcome to our cafe!" });
    expect(greetingFor(agent, "en")).toBe("Welcome to our cafe!");
    // Picking Arabic or French never speaks the English text: the built-in greeting in that language is used.
    expect(greetingFor(agent, "ar")).toBeNull();
    expect(greetingFor(agent, "fr")).toBeNull();
  });

  it("uses the greeting saved for each language", () => {
    const agent = { greeting: "Welcome!", greetings: { en: "Welcome!", ar: "أهلاً وسهلاً!", fr: "  " } };
    expect(greetingFor(agent, "en")).toBe("Welcome!");
    expect(greetingFor(agent, "ar")).toBe("أهلاً وسهلاً!");
    expect(greetingFor(agent, "fr")).toBeNull();
    expect(savedGreetings(agent)).toEqual({ en: "Welcome!", ar: "أهلاً وسهلاً!" });
  });

  it("a business that cleared every greeting gets the built-in ones", () => {
    expect(greetingFor({ greeting: null, greetings: {} }, "en")).toBeNull();
    expect(greetingFor(null, "ar")).toBeNull();
    expect(greetingFor({ greeting: "Hi" }, "de")).toBeNull();
  });

  it("a greeting typed by a customer is answered in the customer's language", () => {
    const snapshot: BrainSnapshot = {
      locale: "en",
      assistantName: "Doudi",
      greeting: "Welcome!",
      greetings: { en: "Welcome!", ar: "أهلاً وسهلاً!" },
      currency: "USD",
      currencyExponent: 2,
      products: [],
      defaultBranch: null,
      notes: {},
      faqs: [],
      returningCustomer: null,
    };
    expect(matchDeterministic("hello", snapshot)?.reply).toBe("Welcome!");
    expect(matchDeterministic("مرحبا", snapshot)?.reply).toBe("أهلاً وسهلاً!");
    // No French greeting saved: the built-in French hello, not the English text.
    expect(matchDeterministic("bonjour", snapshot)?.reply).not.toBe("Welcome!");
  });
});
