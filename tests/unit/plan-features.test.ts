import { describe, expect, it } from "vitest";

import { featureLines, matchLines, syncFeatureLists } from "@/lib/plan-features";

const LANGS = ["en", "ar", "fr"] as const;
const aligned = {
  en: "AI Agent 24/7\nOnline ordering\nPriority support",
  ar: "وكيل ذكاء اصطناعي\nالطلب عبر الإنترنت\nدعم ذو أولوية",
  fr: "Agent IA 24h/24\nCommandes en ligne\nSupport prioritaire",
};

describe("plan feature lists in every language", () => {
  it("a new line is translated into the other languages at the same place; the rest is kept", () => {
    const after = featureLines("AI Agent 24/7\nQR ordering\nOnline ordering\nPriority support");
    const { lists, translate } = syncFeatureLists(aligned, "en", after, LANGS);
    expect(lists.ar).toEqual(["وكيل ذكاء اصطناعي", null, "الطلب عبر الإنترنت", "دعم ذو أولوية"]);
    expect(lists.fr).toEqual(["Agent IA 24h/24", null, "Commandes en ligne", "Support prioritaire"]);
    expect(translate).toEqual([
      { lang: "ar", index: 1, text: "QR ordering" },
      { lang: "fr", index: 1, text: "QR ordering" },
    ]);
  });

  it("a removed line goes from every language", () => {
    const { lists, translate } = syncFeatureLists(aligned, "en", ["AI Agent 24/7", "Priority support"], LANGS);
    expect(lists.ar).toEqual(["وكيل ذكاء اصطناعي", "دعم ذو أولوية"]);
    expect(lists.fr).toEqual(["Agent IA 24h/24", "Support prioritaire"]);
    expect(translate).toEqual([]);
  });

  it("correcting a translation in place changes that language only", () => {
    const after = ["وكيل ذكاء اصطناعي", "الطلب والحجز عبر الإنترنت", "دعم ذو أولوية"];
    const { lists, translate } = syncFeatureLists(aligned, "ar", after, LANGS);
    expect(lists.en).toEqual(["AI Agent 24/7", "Online ordering", "Priority support"]);
    expect(lists.fr).toEqual(["Agent IA 24h/24", "Commandes en ligne", "Support prioritaire"]);
    expect(translate).toEqual([]);
  });

  it("a line changed in place changes in that language only, however different the wording", () => {
    const after = ["وكيل ذكاء اصطناعي", "اطلب واحجز من أي مكان", "دعم ذو أولوية"];
    const { lists, translate } = syncFeatureLists(aligned, "ar", after, LANGS);
    expect(lists.en).toEqual(["AI Agent 24/7", "Online ordering", "Priority support"]);
    expect(translate).toEqual([]);
  });

  it("removing a line and adding another elsewhere: removed everywhere, the new one translated", () => {
    const { lists, translate } = syncFeatureLists(aligned, "en", ["AI Agent 24/7", "Priority support", "Dedicated account manager"], LANGS);
    expect(lists.fr).toEqual(["Agent IA 24h/24", "Support prioritaire", null]);
    expect(translate.map((t) => t.index)).toEqual([2, 2]);
  });

  it("a language whose list doesn't line up (written separately) is rebuilt from the saved one", () => {
    const current = { en: "A\nB\nC", ar: "أ\nب", fr: "" };
    const { lists, translate } = syncFeatureLists(current, "en", ["A", "B", "C", "D"], LANGS);
    expect(lists.ar).toEqual([null, null, null, null]);
    expect(lists.fr).toEqual([null, null, null, null]);
    expect(translate).toHaveLength(8);
  });

  it("matches unchanged and reworded lines, leaves new ones", () => {
    expect(matchLines(["One", "Two", "Three"], ["Zero", "One", "Two!", "Three"])).toEqual([null, 0, 1, 2]);
    expect(matchLines(["One", "Two"], ["One", "Deux", "Three"])).toEqual([0, 1, null]);
    expect(featureLines(" a \n\n b\r\n")).toEqual(["a", "b"]);
  });
});

describe("pricing card: branch limit after the AI Agent 24/7 line", () => {
  it("goes right after it in any language, first when there is none, nowhere without a limit", async () => {
    const { withBranches } = await import("@/components/site/landing/pricing-cards");
    expect(withBranches(["Up to 1,000 customers", "AI Agent 24/7", "QR ordering"], "Up to 2 branches").map((l) => l.text)).toEqual([
      "Up to 1,000 customers",
      "AI Agent 24/7",
      "Up to 2 branches",
      "QR ordering",
    ]);
    expect(withBranches(["وكيل ذكاء اصطناعي على مدار الساعة", "دعم"], "فرعان").map((l) => l.text)).toEqual(["وكيل ذكاء اصطناعي على مدار الساعة", "فرعان", "دعم"]);
    expect(withBranches(["Agent IA 24h/24, 7j/7", "Support"], "2 succursales")[1]).toEqual({ text: "2 succursales", branches: true });
    expect(withBranches(["QR ordering"], "Up to 2 branches").map((l) => l.text)).toEqual(["Up to 2 branches", "QR ordering"]);
    expect(withBranches(["AI Agent 24/7"], null)).toEqual([{ text: "AI Agent 24/7" }]);
  });
});
