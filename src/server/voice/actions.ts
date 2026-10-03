"use server";

import { z } from "zod";

import { isRateLimited } from "@/server/shared/rate-limit";
import { requireTenantMember } from "@/server/tenant/context";

import { LOCALES } from "@/i18n/locales";
import { actionT } from "@/server/i18n/action-messages";

import { activeVoiceProfile, previewGreetingSentences, voiceDeps } from "./index";
import { notePremiumVoiceExhausted, premiumVoiceExhausted } from "./availability";
import { greetingProfile, sentenceAudio } from "./service";

const previewInput = z.object({
  locale: z.string(),
  slug: z.string().min(1),
  gender: z.enum(["male", "female"]),
  name: z.string().trim().max(80),
  greeting: z.string().trim().max(300),
  /** The language of the greeting being previewed (one field per language in Agent settings). */
  language: z.enum(LOCALES).default("en"),
});

export type VoicePreview = { ok: true; audio: string; voiceName: string | null } | { ok: false; message: string };

/**
 * Agent settings → "Preview voice" with the premium voice: the name and
 * greeting as typed, in the chosen voice. Same cache and usage limits as
 * the Agent itself — previewing the same greeting twice costs nothing.
 */
export async function previewAgentVoiceAction(raw: z.input<typeof previewInput>): Promise<VoicePreview> {
  const t = await actionT(raw.locale);
  const parsed = previewInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: t("reload") };
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  if (isRateLimited(`voice-preview:${tenant.id}`, 60_000, 6)) {
    return { ok: false, message: t("voice.wait") };
  }
  const profile = await activeVoiceProfile(parsed.data.gender);
  const deps = profile ? voiceDeps(profile) : null;
  if (!profile || !deps) return { ok: false, message: t("voice.unavailable") };
  if (await premiumVoiceExhausted()) {
    return { ok: false, message: t("voice.usedUp") };
  }

  const sentences = await previewGreetingSentences(parsed.data.language, parsed.data.name || t("voice.yourAssistant"), parsed.data.greeting);
  const parts: Uint8Array[] = [];
  for (const sentence of sentences) {
    const result = await sentenceAudio(deps, { tenantId: tenant.id, profile: greetingProfile(profile), language: sentence.language, text: sentence.text });
    if (!result.ok) {
      if (result.reason === "quota") notePremiumVoiceExhausted();
      return {
        ok: false,
        message:
          result.reason === "limit" ? t("voice.paused") : result.reason === "quota" ? t("voice.usedUp") : t("voice.noAnswer"),
      };
    }
    const bytes = new Uint8Array(await new Response(result.audio).arrayBuffer());
    await result.done;
    parts.push(bytes);
  }
  // MP3 frames follow one another, so the sentences join into one clip.
  return { ok: true, audio: Buffer.concat(parts).toString("base64"), voiceName: profile.voiceName };
}
