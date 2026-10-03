import { after } from "next/server";
import { z } from "zod";

import { LOCALES } from "@/i18n/locales";
import { resolvePublicTenant, resolveWidgetTenant } from "@/server/agent-public/tenant";
import { isRateLimited } from "@/server/shared/rate-limit";
import { activeVoiceProfile, greetingSentences, messageSentences, tenantVoiceGender, voiceDeps } from "@/server/voice";
import { greetingProfile, sentenceAudio } from "@/server/voice/service";

/**
 * The Agent's premium voice: one sentence of audio per request, streamed
 * as it is generated (or straight from the cache). The client asks for
 * sentence 0, learns how many there are from `X-Voice-Sentences`, and
 * fetches the next one while the current one plays — so a customer hears
 * the Agent almost at once, and an interrupted reply generates nothing
 * more.
 *
 * Only text the Agent itself says can be spoken: the business's greeting,
 * or an assistant message from the caller's own conversation. A JSON
 * answer with `fallback: true` tells the page to use the device voice
 * instead (premium voice not configured, plan limit reached, provider
 * down).
 */
const body = z.object({
  slug: z.string().trim().min(1).max(60),
  surface: z.enum(["external_agent", "website_widget"]).default("external_agent"),
  locale: z.enum(LOCALES).default("en"),
  source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("greeting") }), z.object({ kind: z.literal("message"), id: z.uuid() })]),
  sentence: z.number().int().min(0).max(60).default(0),
});

const fallback = (status: number, reason: string) =>
  Response.json({ fallback: true, reason }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fallback(400, "bad_request");
  const { slug, surface, locale, source, sentence } = parsed.data;

  const tenant = await (surface === "website_widget" ? resolveWidgetTenant(slug) : resolvePublicTenant(slug));
  if (!tenant) return fallback(404, "not_found");

  // A customer's Agent speaks a few sentences per reply; this stops a script from draining the voice budget.
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (isRateLimited(`voice:${tenant.id}:${caller}`, 60_000, 90)) return fallback(429, "rate_limited");

  const profile = await activeVoiceProfile(await tenantVoiceGender(tenant.id));
  const deps = profile ? voiceDeps(profile) : null;
  if (!profile || !deps) return fallback(503, "not_configured");

  const sentences = source.kind === "greeting" ? await greetingSentences(tenant, locale) : await messageSentences(tenant, source.id, locale);
  if (!sentences || sentences.length === 0) return fallback(404, "nothing_to_say");
  const target = sentences[sentence];
  if (!target) return fallback(416, "no_such_sentence");

  // The welcome greeting is spoken in the voice's warmer greeting delivery.
  const speaker = source.kind === "greeting" ? greetingProfile(profile) : profile;
  const result = await sentenceAudio(deps, { tenantId: tenant.id, profile: speaker, language: target.language, text: target.text });
  if (!result.ok) return fallback(result.reason === "limit" ? 402 : 502, result.reason);
  // Storing a fresh sentence in the cache (and recording its cost) finishes after the response.
  after(() => result.done);

  return new Response(result.audio, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "private, no-store",
      "x-voice-sentences": String(sentences.length),
      "x-voice-cache": result.cached ? "hit" : "miss",
    },
  });
}
