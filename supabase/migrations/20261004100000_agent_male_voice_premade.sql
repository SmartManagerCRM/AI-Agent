-- The male Agent voice "Rick - Conversational AI" is a Voice Library voice:
-- ElevenLabs refuses library voices through the API on the platform's
-- current plan (HTTP 402 Payment Required), so every male sentence fell
-- back to the device voice. Switch the male profile to a built-in
-- (premade) voice, which every plan may use through the API:
-- "Eric - Smooth, Trustworthy" — a smooth, warm tenor ElevenLabs describes
-- as made for agentic use cases. Model, settings and price are unchanged.
-- Earlier cached audio needs no clean-up: the cache key includes the voice
-- id, so Eric's sentences are new files.
update public.voice_profiles
   set voice_id = 'cjVigY5qzO86Huf0OWal',
       voice_name = 'Eric - Smooth, Trustworthy',
       notes = 'ElevenLabs built-in voice (every plan): smooth, warm, trustworthy; made for AI agents.'
 where gender = 'male'
   and provider = 'elevenlabs'
   and voice_id = 'aUJKIGFNQrEc4LgAMxMR';
