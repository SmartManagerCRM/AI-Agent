-- The business owner chose two ElevenLabs voices saved in the account for
-- the Agent: "Lyan - Female Genuine Casual Ads" (female, replaces Sarah) and
-- "Jesse - Confident, Warm, Expressive Male" (male, replaces Chris).
-- Both are ElevenLabs library (professional) voices: the account's API key
-- can use them because they are saved to its voices on a paid plan.
-- Model, settings, greeting settings and price are unchanged; the audio
-- cache key includes the voice id, so the new voices' sentences are new
-- files and the old voices' audio is never reused.
update public.voice_profiles
   set voice_id = 'PStJ2DzQnh8zxG5PDf1s',
       voice_name = 'Lyan - Female Genuine Casual Ads',
       notes = 'ElevenLabs library voice saved in the account: warm, conversational, casual, upbeat, approachable.'
 where gender = 'female'
   and provider = 'elevenlabs';

update public.voice_profiles
   set voice_id = 'sXcl1NoQHcU7NRh6Na5D',
       voice_name = 'Jesse - Confident, Warm, Expressive Male',
       notes = 'ElevenLabs library voice saved in the account: confident, friendly, warm, relatable, trustworthy.'
 where gender = 'male'
   and provider = 'elevenlabs';
