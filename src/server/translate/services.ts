import "server-only";

import type { ContentLang, ServiceOutcome } from "./types";

/**
 * Machine-translation services (no AI): Microsoft Azure Translator and DeepL.
 * Keys are server-side only (environment) and are never logged or sent
 * anywhere but the service itself; only the texts to translate leave.
 */

const TIMEOUT_MS = 20_000;

/** Azure Translator v3. `region` is required for regional / multi-service resources. */
export async function azureTranslate(
  credentials: { key: string; region?: string },
  texts: string[],
  from: ContentLang,
  to: ContentLang,
): Promise<ServiceOutcome> {
  const headers: Record<string, string> = { "Ocp-Apim-Subscription-Key": credentials.key, "Content-Type": "application/json" };
  if (credentials.region) headers["Ocp-Apim-Subscription-Region"] = credentials.region;
  let res: Response;
  try {
    res = await fetch(`https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${from}&to=${to}&textType=plain`, {
      method: "POST",
      headers,
      body: JSON.stringify(texts.map((text) => ({ Text: text }))),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (!res.ok) {
    // 403001: the free tier's monthly characters are used up. 401: bad key / wrong region.
    const body = (await res.json().catch(() => null)) as { error?: { code?: number } } | null;
    if (res.status === 403 && body?.error?.code === 403001) return { ok: false, reason: "quota" };
    return { ok: false, reason: res.status === 401 || res.status === 403 ? "unavailable" : "failed" };
  }
  const data = (await res.json().catch(() => null)) as { translations?: { text?: string }[] }[] | null;
  const out = Array.isArray(data) ? data.map((d) => d.translations?.[0]?.text ?? "") : [];
  return out.length === texts.length && out.every((t) => t.trim()) ? { ok: true, texts: out } : { ok: false, reason: "failed" };
}

const DEEPL_SOURCE: Record<ContentLang, string> = { en: "EN", ar: "AR", fr: "FR" };
const DEEPL_TARGET: Record<ContentLang, string> = { en: "EN-US", ar: "AR", fr: "FR" };

/** DeepL API (Free keys end in ":fx" and use the free endpoint). */
export async function deeplTranslate(key: string, texts: string[], from: ContentLang, to: ContentLang): Promise<ServiceOutcome> {
  const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  let res: Response;
  try {
    res = await fetch(`${host}/v2/translate`, {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: texts, source_lang: DEEPL_SOURCE[from], target_lang: DEEPL_TARGET[to] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "failed" };
  }
  // 456: the account's characters are used up.
  if (res.status === 456) return { ok: false, reason: "quota" };
  if (!res.ok) return { ok: false, reason: res.status === 401 || res.status === 403 ? "unavailable" : "failed" };
  const data = (await res.json().catch(() => null)) as { translations?: { text?: string }[] } | null;
  const out = (data?.translations ?? []).map((t) => t.text ?? "");
  return out.length === texts.length && out.every((t) => t.trim()) ? { ok: true, texts: out } : { ok: false, reason: "failed" };
}
