-- The business owner chose "Chris - Charming, Down-to-Earth" as the male
-- Agent voice: Eric sounded too sharp and formal. Chris is an ElevenLabs
-- built-in (premade) voice, so every plan may use it through the API.
-- Model, settings and price are unchanged; the audio cache key includes the
-- voice id, so Chris's sentences are new files and Eric's are never reused.
update public.voice_profiles
   set voice_id = 'iP95p4xoKVk53GoZ742B',
       voice_name = 'Chris - Charming, Down-to-Earth',
       notes = 'ElevenLabs built-in voice (every plan): natural, warm, friendly, down-to-earth.'
 where gender = 'male'
   and provider = 'elevenlabs';
