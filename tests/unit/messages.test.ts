import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * The console, Super Admin and Agent show every text from messages/{en,ar,fr}.json:
 * the three languages must hold the same messages, each one valid ICU, and every
 * key the code asks for must exist — otherwise a user who picks Arabic or French
 * sees a raw key or English.
 */
type Tree = { [key: string]: string | Tree };
const LANGS = { en, ar, fr } as Record<string, Tree>;

function flatten(tree: Tree, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else flatten(value, path, out);
  }
  return out;
}

const flat = Object.fromEntries(Object.entries(LANGS).map(([lang, tree]) => [lang, flatten(tree)]));
const hasPath = (path: string) => flat.en.has(path) || [...flat.en.keys()].some((k) => k.startsWith(`${path}.`));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("messages", () => {
  it("English, Arabic and French have exactly the same keys", () => {
    for (const lang of ["ar", "fr"]) {
      const missing = [...flat.en.keys()].filter((k) => !flat[lang].has(k));
      const extra = [...flat[lang].keys()].filter((k) => !flat.en.has(k));
      expect({ lang, missing, extra }).toEqual({ lang, missing: [], extra: [] });
    }
  });

  it("no message is empty, and Arabic / French are not left in English", () => {
    for (const [lang, messages] of Object.entries(flat)) {
      const empty = [...messages].filter(([, v]) => !v.trim()).map(([k]) => k);
      expect({ lang, empty }).toEqual({ lang, empty: [] });
    }
    // Long English sentences copied as-is into Arabic would be untranslated text.
    const untranslatedAr = [...flat.ar].filter(([k, v]) => v === flat.en.get(k) && /[a-z]{3,} [a-z]{3,} [a-z]{3,}/i.test(v)).map(([k]) => k);
    expect(untranslatedAr).toEqual([]);
  });

  it("every message is valid ICU in its own language", () => {
    const broken: string[] = [];
    for (const [lang, messages] of Object.entries(flat)) {
      for (const [key, message] of messages) {
        try {
          new IntlMessageFormat(message, lang, undefined, { ignoreTag: false });
        } catch (error) {
          broken.push(`${lang} ${key}: ${(error as Error).message}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("the three languages use the same placeholders in each message", () => {
    // Argument names from the parsed message (plural / select branches and tags included).
    const args = (message: string) => {
      const names = new Set<string>();
      const walk = (nodes: MessageFormatElement[]) => {
        for (const node of nodes) {
          if ("value" in node && node.type !== TYPE.literal && node.type !== TYPE.pound) names.add(String(node.value));
          if ("options" in node) for (const option of Object.values(node.options)) walk(option.value);
          if ("children" in node) walk(node.children);
        }
      };
      walk(parse(message));
      return [...names].sort();
    };
    const differ: string[] = [];
    for (const [key, message] of flat.en) {
      const want = args(message).join(",");
      for (const lang of ["ar", "fr"]) {
        const got = args(flat[lang].get(key) ?? "").join(",");
        if (got !== want) differ.push(`${lang} ${key}: ${got} ≠ ${want}`);
      }
    }
    expect(differ).toEqual([]);
  });

  it("the Agent's messages only use what its small formatter understands (plain {name} and plural)", () => {
    const unsupported = [...flat.en, ...flat.ar, ...flat.fr]
      .filter(([k, v]) => k.startsWith("agent.") && (/,\s*(select|selectordinal|number|date|time)\s*[,}]/.test(v) || /<\w+>/.test(v)))
      .map(([k]) => k);
    expect(unsupported).toEqual([]);
  });

  it("every literal key the code asks for exists", () => {
    const missing: string[] = [];
    const decl =
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([\w.]*)"|\{[^}]*namespace:\s*"([\w.]+)"[^}]*\})?\s*\)|const\s+(\w+)\s*=\s*await\s+actionT\(|const\s+(\w+)\s*=\s*useAgentT\(\)/g;
    for (const file of sourceFiles(join(__dirname, "../../src"))) {
      const source = readFileSync(file, "utf8");
      const scopes: { name: string; ns: string; at: number }[] = [];
      for (const m of source.matchAll(decl)) {
        if (m[1]) scopes.push({ name: m[1], ns: m[2] ?? m[3] ?? "", at: m.index });
        else if (m[4]) scopes.push({ name: m[4], ns: "actions", at: m.index });
        else if (m[5]) scopes.push({ name: m[5], ns: "agent", at: m.index });
      }
      for (const { name } of scopes) {
        for (const call of source.matchAll(new RegExp(`\\b${name}(?:\\.rich|\\.markup)?\\(\\s*"([\\w.]+)"`, "g"))) {
          // The nearest declaration of this name above the call decides its namespace.
          const scope = scopes.filter((s) => s.name === name && s.at < call.index).at(-1);
          if (!scope) continue;
          const path = scope.ns ? `${scope.ns}.${call[1]}` : call[1];
          if (!hasPath(path)) missing.push(`${file.split("/src/")[1]}: ${path}`);
        }
      }
      for (const m of source.matchAll(/<(?:Rich)?Msg\s+id="([\w.]+)"/g)) {
        if (!hasPath(m[1])) missing.push(`${file.split("/src/")[1]}: ${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
