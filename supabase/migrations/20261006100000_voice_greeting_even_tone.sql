-- One professional, friendly tone for the whole welcome greeting.
-- The livelier greeting delivery (stability 0.35, style 0.45) let the voice
-- swing — a bright, high "Hi! I'm …" and then a lower rest of the message.
-- Steadier settings keep one even tone: more stability, a little warmth
-- (style 0.2, a touch above replies' 0.15), natural pace. The app now also
-- speaks the whole greeting as a single recording per language. The audio
-- cache key includes the settings, so each greeting is generated once more.
update public.voice_profiles
   set greeting_settings = '{"stability": 0.6, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": true, "speed": 1.0}'::jsonb
 where provider = 'elevenlabs';
