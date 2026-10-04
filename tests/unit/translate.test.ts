import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { configuredServices, translateTexts } from "@/server/translate/engine";
import { GLOSSARY_ENTRIES, glossaryTranslate } from "@/server/translate/glossary";
import { fromHtml, parseKeepWords, protect, splitBilingual, termFromName } from "@/server/translate/keep";
import { planRow, sourceHash, TRANSLATABLE } from "@/server/translate/queue";
import { azureTranslate, deeplTranslate } from "@/server/translate/services";
import type { ServiceOutcome } from "@/server/translate/types";

describe("built-in word list", () => {
  it("translates every entry between all three languages", () => {
    for (const [en, ar, fr] of GLOSSARY_ENTRIES) {
      // A language that maps to several entries takes the first; check from English, which is unique.
      expect(glossaryTranslate(en, "en", "ar")).toBe(GLOSSARY_ENTRIES.find((e) => e[0].toLowerCase() === en.toLowerCase())![1]);
      expect(glossaryTranslate(en, "en", "fr")).toBe(GLOSSARY_ENTRIES.find((e) => e[0].toLowerCase() === en.toLowerCase())![2]);
      expect(glossaryTranslate(ar, "ar", "en")).not.toBeNull();
      expect(glossaryTranslate(fr, "fr", "en")).not.toBeNull();
    }
  });

  it("ignores case, spacing and Arabic spelling variants, and matches whole texts only", () => {
    expect(glossaryTranslate("  iced   LATTE ", "en", "ar")).toBe("آيس لاتيه");
    expect(glossaryTranslate("Hot-Drinks", "en", "fr")).toBe("Boissons chaudes");
    expect(glossaryTranslate("ارز", "ar", "en")).toBe("Rice"); // أرز without the hamza
    expect(glossaryTranslate("شوربة اليوم", "ar", "fr")).toBe("Soupe du jour");
    expect(glossaryTranslate("شوربه اليوم", "ar", "en")).toBe("Soup of the Day"); // ة written as ه
    expect(glossaryTranslate("Khayal Special Platter", "en", "ar")).toBeNull();
    expect(glossaryTranslate("Latte with oat milk", "en", "ar")).toBeNull();
  });
});

describe("what a row needs translated", () => {
  const products = TRANSLATABLE.products;
  const meta = (field: string, lang: string, value: string, from: "en" | "ar" | "fr", source: string) => ({
    field,
    lang,
    value,
    source_lang: from,
    source_hash: sourceHash(from, source),
  });

  it("fills the empty languages from the typed one", () => {
    const plan = planRow(products, { id: "p1", name: { ar: "شوربة عدس" }, description: {} }, []);
    expect(plan.map((p) => `${p.field}:${p.from}>${p.to}:${p.expected}`).sort()).toEqual(["name:ar>en:null", "name:ar>fr:null"]);
    expect(plan[0].text).toBe("شوربة عدس");
  });

  it("never touches a language someone typed, and prefers English as the source", () => {
    const plan = planRow(products, { id: "p1", name: { en: "Iced Latte", ar: "لاتيه بارد" }, description: { en: "Cold milk and espresso." } }, []);
    expect(plan.map((p) => `${p.field}:${p.from}>${p.to}`).sort()).toEqual(["description:en>ar", "description:en>fr", "name:en>fr"]);
  });

  it("leaves an automatic translation alone while its source is unchanged, and redoes it when the source changes", () => {
    const row = { id: "p1", name: { en: "Latte", ar: "لاتيه", fr: "Latte" }, description: null };
    const metas = [meta("name", "ar", "لاتيه", "en", "Latte"), meta("name", "fr", "Latte", "en", "Latte")];
    expect(planRow(products, row, metas)).toEqual([]);
    const changed = { ...row, name: { ...row.name, en: "Iced Latte" } };
    const plan = planRow(products, changed, metas);
    expect(plan.map((p) => `${p.to}:${p.text}:${p.expected}`).sort()).toEqual(["ar:Iced Latte:لاتيه", "fr:Iced Latte:Latte"]);
  });

  it("an automatic translation someone corrected counts as typed from then on", () => {
    const row = { id: "p1", name: { en: "Latte", ar: "لاتيه بالحليب" }, description: null };
    const plan = planRow(products, row, [meta("name", "ar", "لاتيه", "en", "Latte")]);
    expect(plan.map((p) => p.to)).toEqual(["fr"]);
  });

  it("doesn't translate from a language whose text is in another script", () => {
    expect(planRow(products, { id: "p1", name: { en: "شاي" }, description: null }, [])).toEqual([]);
  });

  it("announcements: the message in its own language is the source", () => {
    const plan = planRow(TRANSLATABLE.platform_announcements, { id: "a1", message: "Maintenance tonight.", message_locale: "en", message_translations: {} }, []);
    expect(plan.map((p) => `${p.field}:${p.from}>${p.to}`).sort()).toEqual(["message_translations:en>ar", "message_translations:en>fr"]);
  });
});

/** A database stand-in for the monthly character counters. */
function fakeDb(limits: Record<string, number> = {}) {
  const used: Record<string, number> = {};
  const exhausted = new Set<string>();
  const calls: string[] = [];
  const db = {
    used,
    exhausted,
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      const provider = String(args.p_provider);
      if (name === "reserve_translation_characters") {
        const limit = (args.p_limit as number | null) ?? limits[provider] ?? null;
        const n = Number(args.p_characters);
        if (exhausted.has(provider) || (limit !== null && (used[provider] ?? 0) + n > limit)) return { data: false, error: null };
        used[provider] = (used[provider] ?? 0) + n;
        return { data: true, error: null };
      }
      if (name === "settle_translation_characters") {
        used[provider] = Math.max(0, (used[provider] ?? 0) - Number(args.p_refund));
        if (args.p_exhausted) exhausted.add(provider);
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return db;
}

function service(provider: "azure_free" | "deepl_free" | "azure_paid" | "local", limit: number | null, answer: (texts: string[]) => ServiceOutcome, calls: string[]) {
  return {
    provider,
    limit,
    markup: provider !== "local",
    translate: async (texts: string[], _from: string, _to: string, html: boolean) => {
      calls.push(`${provider}${html ? "(html)" : ""}:${texts.join("|")}`);
      return answer(texts);
    },
  };
}

describe("the translation chain", () => {
  const ok = (texts: string[]) => ({ ok: true as const, texts: texts.map((t) => `[${t}]`) });

  it("word list and text without letters first — no service is called", async () => {
    const db = fakeDb();
    const calls: string[] = [];
    const out = await translateTexts(db as never, [
      { text: "Hot Drinks", from: "en", to: "ar" },
      { text: "7", from: "en", to: "fr" },
    ], [service("azure_free", 2_000_000, ok, calls)]);
    expect(out).toEqual([{ text: "مشروبات ساخنة", provider: "glossary" }, { text: "7", provider: "copy" }]);
    expect(calls).toEqual([]);
    expect(db.used).toEqual({});
  });

  it("Azure free first; DeepL when Azure says its allowance is used up; then the paid tier; then the local models", async () => {
    const db = fakeDb();
    const calls: string[] = [];
    const chain = [
      service("azure_free", 2_000_000, () => ({ ok: false, reason: "quota" }), calls),
      service("deepl_free", 500_000, () => ({ ok: false, reason: "quota" }), calls),
      service("azure_paid", null, ok, calls),
      service("local", null, ok, calls),
    ];
    const out = await translateTexts(db as never, [{ text: "Khayal platter", from: "en", to: "ar" }], chain);
    expect(out[0]).toEqual({ text: "[Khayal platter]", provider: "azure_paid" });
    expect(calls).toEqual(["azure_free:Khayal platter", "deepl_free:Khayal platter", "azure_paid:Khayal platter"]);
    // The refused requests gave their characters back, and the two free services are skipped for the rest of the month.
    expect(db.used).toEqual({ azure_free: 0, deepl_free: 0, azure_paid: 14 });
    expect([...db.exhausted].sort()).toEqual(["azure_free", "deepl_free"]);
  });

  it("never goes over a free allowance: a batch that doesn't fit goes to the next service", async () => {
    const db = fakeDb();
    db.used.azure_free = 1_999_990;
    const calls: string[] = [];
    const out = await translateTexts(db as never, [{ text: "Khayal platter", from: "en", to: "fr" }], [
      service("azure_free", 2_000_000, ok, calls),
      service("deepl_free", 500_000, ok, calls),
    ]);
    expect(out[0]?.provider).toBe("deepl_free");
    expect(db.used.azure_free).toBe(1_999_990);
  });

  it("without paid tier or keys, the local models translate; when nothing can, the text is left for later", async () => {
    const calls: string[] = [];
    expect((await translateTexts(fakeDb() as never, [{ text: "Khayal platter", from: "en", to: "fr" }], [service("local", null, ok, calls)]))[0]?.provider).toBe("local");
    const none = await translateTexts(fakeDb() as never, [{ text: "Khayal platter", from: "en", to: "fr" }], [
      service("local", null, () => ({ ok: false, reason: "unavailable" }), calls),
    ]);
    expect(none).toEqual([null]);
  });

  it("is configured from the environment: services without a key are left out, local models last", () => {
    expect(configuredServices({} as NodeJS.ProcessEnv).map((s) => s.provider)).toEqual(["local"]);
    const all = configuredServices({
      AZURE_TRANSLATOR_KEY: "a",
      DEEPL_API_KEY: "d:fx",
      AZURE_TRANSLATOR_PAID_KEY: "p",
      AZURE_TRANSLATOR_PAID_MONTHLY_LIMIT: "1000000",
    } as unknown as NodeJS.ProcessEnv);
    expect(all.map((s) => [s.provider, s.limit])).toEqual([
      ["azure_free", 2_000_000],
      ["deepl_free", 500_000],
      ["azure_paid", 1_000_000],
      ["local", null],
    ]);
  });
});

describe("translation services", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Azure: sends the key and region, reads the translations, and recognises the free tier's quota answer", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { Text: string }[];
      return new Response(JSON.stringify(body.map((b) => ({ translations: [{ text: `ar:${b.Text}`, to: "ar" }] }))), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await azureTranslate({ key: "k", region: "westeurope" }, ["Latte", "Tea"], "en", "ar")).toEqual({ ok: true, texts: ["ar:Latte", "ar:Tea"] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("from=en&to=ar");
    expect((init.headers as Record<string, string>)["Ocp-Apim-Subscription-Region"]).toBe("westeurope");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 403001 } }), { status: 403 })));
    expect(await azureTranslate({ key: "k" }, ["Latte"], "en", "ar")).toEqual({ ok: false, reason: "quota" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    expect(await azureTranslate({ key: "bad" }, ["Latte"], "en", "ar")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("DeepL: free keys use the free endpoint; 456 means the characters are used up", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { text: string[]; target_lang: string };
      return new Response(JSON.stringify({ translations: body.text.map((t) => ({ text: `${body.target_lang}:${t}` })) }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await deeplTranslate("abc:fx", ["Latte"], "ar", "en")).toEqual({ ok: true, texts: ["EN-US:Latte"] });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api-free.deepl.com/v2/translate");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 456 })));
    expect(await deeplTranslate("abc:fx", ["Latte"], "en", "fr")).toEqual({ ok: false, reason: "quota" });
  });
});

describe("names already written in two languages", () => {
  it("are split into their Arabic and Latin halves", () => {
    expect(splitBilingual("مقبلات باردة / COLD APPETIZERS")).toEqual({ ar: "مقبلات باردة", latin: "COLD APPETIZERS" });
    expect(splitBilingual("Breakfast | فطور")).toEqual({ ar: "فطور", latin: "Breakfast" });
    expect(splitBilingual("Iced Latte - Large")).toBeNull();
    expect(splitBilingual("شاي / قهوة")).toBeNull();
  });

  it("each language gets its own half; French is translated from the English half", () => {
    const plan = planRow(TRANSLATABLE.categories, { id: "c1", name: { ar: "مقبلات باردة / COLD APPETIZERS" } }, []);
    expect(plan.map((p) => `${p.to}:${p.from}:${p.text}:${p.preset ?? "-"}`).sort()).toEqual([
      "en:ar:COLD APPETIZERS:COLD APPETIZERS",
      "fr:en:COLD APPETIZERS:-",
    ]);
  });
});

describe("words kept as written", () => {
  const khayal = parseKeepWords(["خيال = Khayal"]);

  it("parses one term per line, with a spelling per script", () => {
    expect(khayal).toEqual([{ forms: { ar: "خيال", en: "Khayal", fr: "Khayal" } }]);
    expect(parseKeepWords(["Kunafa Nabulsia", "  ", "قهوة = Coffee = Café"])).toEqual([
      { forms: { en: "Kunafa Nabulsia", fr: "Kunafa Nabulsia" } },
      { forms: { ar: "قهوة", en: "Coffee", fr: "Café" } },
    ]);
    expect(termFromName({ en: "Khayal Restaurant", ar: "مطعم خيال" })).toEqual({ forms: { en: "Khayal Restaurant", ar: "مطعم خيال" } });
  });

  it("puts the target spelling in place, marked so the services leave it alone", () => {
    const p = protect("شوربة خيال", "en", khayal);
    expect(p.plain).toBe("شوربة Khayal");
    expect(p.html).toBe('شوربة <span translate="no" class="notranslate">Khayal</span>');
    expect(fromHtml('Khayal <span translate="no">Soup</span> &amp; bread')).toBe("Khayal Soup & bread");
    // Whole words only: "خيالي" (imaginary) is not the name.
    expect(protect("طبق خيالي", "en", khayal).plain).toBe("طبق خيالي");
  });

  it("a row whose text holds a kept word is redone when the list changes", () => {
    const row = { id: "p1", name: { ar: "شوربة خيال" }, description: null };
    const before = planRow(TRANSLATABLE.products, row, [])[0];
    const after = planRow(TRANSLATABLE.products, row, [], khayal)[0];
    expect(after.keep).toEqual(khayal);
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });

  it("services get HTML with the word marked; the local models get it already in place; a name that is only the word needs no service", async () => {
    const calls: string[] = [];
    const answer = (texts: string[]) => ({ ok: true as const, texts: texts.map(() => '<span translate="no" class="notranslate">Khayal</span> Soup') });
    const out = await translateTexts(fakeDb() as never, [
      { text: "شوربة خيال", from: "ar", to: "en", keep: khayal },
      { text: "خيال", from: "ar", to: "fr", keep: khayal },
    ], [service("azure_free", 2_000_000, answer, calls)]);
    expect(out).toEqual([{ text: "Khayal Soup", provider: "azure_free" }, { text: "Khayal", provider: "glossary" }]);
    expect(calls).toEqual(['azure_free(html):شوربة <span translate="no" class="notranslate">Khayal</span>']);
    const local: string[] = [];
    await translateTexts(fakeDb() as never, [{ text: "شوربة خيال", from: "ar", to: "en", keep: khayal }], [service("local", null, ok2, local)]);
    expect(local).toEqual(["local:شوربة Khayal"]);
  });
});

const ok2 = (texts: string[]) => ({ ok: true as const, texts });
