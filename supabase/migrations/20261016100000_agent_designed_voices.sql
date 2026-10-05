-- The Agent's voices are now two voices the business owner designed in
-- ElevenLabs Voice Design: "Mishou" (female) and "Doodi" (male). Designed
-- voices belong to the account, so the API can use them on its plan; the
-- library voices Lyan and Jesse (20261015100000) were refused with HTTP 402.
-- Model, settings, greeting settings and price are unchanged; the audio
-- cache key includes the voice id, so the new voices' sentences are new
-- files and earlier voices' audio is never reused.
update public.voice_profiles
   set voice_id = 'Xo0p3YbDJXjgKedyeN21',
       voice_name = 'Mishou',
       notes = 'ElevenLabs designed voice owned by the account: young adult woman, warm, welcoming, friendly, upbeat; English, Arabic and French.'
 where gender = 'female'
   and provider = 'elevenlabs';

update public.voice_profiles
   set voice_id = 'SNju0r7EjQKmJVbqKfzc',
       voice_name = 'Doodi',
       notes = 'ElevenLabs designed voice owned by the account: man in his thirties, warm, welcoming, confident, trustworthy; English, Arabic and French.'
 where gender = 'male'
   and provider = 'elevenlabs';
