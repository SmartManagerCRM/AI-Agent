"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

/**
 * Minimal client-side translations for the Customer Agent. The Agent's
 * messages (`messages/<locale>.json` → `agent`) only use `{name}`
 * placeholders and `{count, plural, …}` blocks, so instead of shipping a
 * full ICU parser to every customer's phone this formats them with the
 * browser's own `Intl.PluralRules`. The console keeps using next-intl.
 */
type Messages = Record<string, unknown>;
type Values = Record<string, string | number>;

const AgentI18nContext = createContext<{ locale: string; messages: Messages } | null>(null);

export function AgentI18nProvider({ locale, messages, children }: { locale: string; messages: Messages; children: ReactNode }) {
  return <AgentI18nContext.Provider value={{ locale, messages }}>{children}</AgentI18nContext.Provider>;
}

export function useAgentT() {
  const ctx = useContext(AgentI18nContext);
  if (!ctx) throw new Error("useAgentT must be used inside AgentI18nProvider");
  const { locale, messages } = ctx;
  return useCallback(
    (key: string, values?: Values) => {
      const template = key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Messages)[part] : undefined), messages);
      return typeof template === "string" ? formatMessage(template, values ?? {}, locale) : key;
    },
    [locale, messages],
  );
}

/** Formats `{name}` placeholders and `{n, plural, =0 {…} one {…} other {…}}` blocks (with `#` = the number). */
export function formatMessage(template: string, values: Values, locale: string): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const end = matchingBrace(template, i);
    if (end < 0) {
      out += template.slice(i);
      break;
    }
    out += formatArgument(template.slice(i + 1, end), values, locale);
    i = end + 1;
  }
  return out;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function formatArgument(body: string, values: Values, locale: string): string {
  const plural = /^\s*(\w+)\s*,\s*plural\s*,/.exec(body);
  if (!plural) {
    const value = values[body.trim()];
    return value === undefined ? `{${body}}` : String(value);
  }
  const count = Number(values[plural[1]] ?? 0);
  const options = new Map<string, string>();
  let rest = body.slice(plural[0].length);
  while (rest.trim()) {
    const selector = /^\s*(=\d+|\w+)\s*\{/.exec(rest);
    if (!selector) break;
    const open = selector[0].length - 1;
    const close = matchingBrace(rest, open);
    if (close < 0) break;
    options.set(selector[1], rest.slice(open + 1, close));
    rest = rest.slice(close + 1);
  }
  const category = new Intl.PluralRules(locale).select(count);
  const chosen = options.get(`=${count}`) ?? options.get(category) ?? options.get("other") ?? "";
  const number = new Intl.NumberFormat(locale).format(count);
  return formatMessage(chosen.replace(/#/g, number), values, locale);
}
