-- A warmer welcome: the greeting a customer hears when they open the Agent
-- or a conversation is spoken with a livelier delivery than replies — the
-- same voice, more expression (lower stability), more style, a touch
-- brighter pace. Replies keep the calm, steady settings. Data, not code:
-- change either per voice here. The audio cache key includes the
-- settings, so the greeting is generated once more in this delivery.
alter table public.voice_profiles add column greeting_settings jsonb;

update public.voice_profiles
   set greeting_settings = '{"stability": 0.35, "similarity_boost": 0.8, "style": 0.45, "use_speaker_boost": true, "speed": 1.02}'::jsonb
 where provider = 'elevenlabs';
