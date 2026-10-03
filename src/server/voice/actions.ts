"use server";

import { z } from "zod";

import { speechSentences } from "@/components/agent-public/voice";
import { isRateLimited } from "@/server/shared/rate-limit";
import { requireTenantMember } from "@/server/tenant/context";

import { activeVoiceProfile, voiceDeps } from "./index";
import { greetingProfile, sentenceAudio } from "./service";

const previewInput = z.object({
  locale: z.string(),
  slug: z.string().min(1),
  gender: z.enum(["male", "female"]),
  name: z.string().trim().max(80),
  greeting: z.string().trim().max(300),
});

export type VoicePreview = { ok: true; audio: string; voiceName: string | null } | { ok: false; message: string };

/**
 * Agent settings → "Preview voice" with the premium voice: the name and
 * greeting as typed, in the chosen voice. Same cache and usage limits as
 * the Agent itself — previewing the same greeting twice costs nothing.
 */
export async function previewAgentVoiceAction(raw: z.input<typeof previewInput>): Promise<VoicePreview> {
  const parsed = previewInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Something went wrong — please reload the page." };
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  if (isRateLimited(`voice-preview:${tenant.id}`, 60_000, 6)) {
    return { ok: false, message: "Please wait a moment before previewing again." };
  }
  const profile = await activeVoiceProfile(parsed.data.gender);
  const deps = profile ? voiceDeps(profile) : null;
  if (!profile || !deps) return { ok: false, message: "Premium voice isn't available right now." };

  const sentences = speechSentences(
    [`Hi! I'm ${parsed.data.name || "your assistant"}.`, parsed.data.greeting || "How can I help you today?"],
    parsed.data.locale,
  );
  const parts: Uint8Array[] = [];
  for (const sentence of sentences) {
    const result = await sentenceAudio(deps, { tenantId: tenant.id, profile: greetingProfile(profile), language: sentence.language, text: sentence.text });
    if (!result.ok) {
      return {
        ok: false,
        message: result.reason === "limit" ? "Your plan's AI allowance is used up, so the premium voice is paused." : "The premium voice didn't answer — please try again.",
      };
    }
    const bytes = new Uint8Array(await new Response(result.audio).arrayBuffer());
    await result.done;
    parts.push(bytes);
  }
  // MP3 frames follow one another, so the sentences join into one clip.
  return { ok: true, audio: Buffer.concat(parts).toString("base64"), voiceName: profile.voiceName };
}
