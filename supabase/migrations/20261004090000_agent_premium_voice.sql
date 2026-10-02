-- Premium Agent voice (ElevenLabs), behind a provider-neutral voice service.
--
--   voice_profiles   one active profile per voice gender: which provider
--                    voice speaks for the Agent, with which model, voice
--                    settings and per-character price. Data, not code: a
--                    platform operator changes voices or prices here,
--                    never in the application (the same rule as
--                    ai_model_configs for models).
--   agent-voice      private Storage bucket: the audio cache. Every spoken
--                    sentence is stored once per business, voice and text
--                    ("<tenant_id>/<sha256>.mp3"), so repeated phrases —
--                    the greeting, "Your order has been confirmed." — are
--                    generated (and paid for) once. Read and written only
--                    by the server with the service role; customers get
--                    audio through the Agent's own endpoint, never a
--                    public URL.
--
-- The provider's API key lives in the server environment
-- (ELEVENLABS_API_KEY) and never reaches a browser. Spending goes through
-- the existing AI usage guard and interaction ledger (request_type
-- 'voice_tts'), so voice counts toward the same plan limits as AI replies.

create table public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  gender text not null check (gender in ('male', 'female')),
  provider text not null check (provider in ('elevenlabs')),
  voice_id text not null check (length(voice_id) between 1 and 100),
  voice_name text,
  model text not null check (length(model) between 1 and 100),
  -- USD per one million characters of text sent for speech (the provider bills by character).
  price_per_million_chars_usd numeric(10, 4) not null check (price_per_million_chars_usd >= 0),
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.voice_profiles
  for each row execute function app.set_updated_at();
-- One active voice per gender.
create unique index voice_profiles_active_gender_uidx on public.voice_profiles (gender) where is_active;

alter table public.voice_profiles enable row level security;
alter table public.voice_profiles force row level security;
-- Only Super Admin manages voices; the server reads them with the service role.
create policy voice_profiles_super_admin on public.voice_profiles
  for all to authenticated using (app.is_super_admin()) with check (app.is_super_admin());
revoke all on public.voice_profiles from anon;

-- Starting voices, chosen for the Agent spec (warm, confident,
-- professional, calm, natural — never robotic) and checked to work on the
-- platform's current ElevenLabs plan (some library voices need the Creator
-- plan). Replace either by updating its row.
-- Flash v2.5: the low-latency, lower-cost model; speaks English, Arabic and
-- French. List price at setup: $0.05 per 1,000 characters — verify against
-- elevenlabs.io/pricing and update here if the plan differs.
insert into public.voice_profiles (gender, provider, voice_id, voice_name, model, price_per_million_chars_usd, settings, notes) values
  ('male', 'elevenlabs', 'aUJKIGFNQrEc4LgAMxMR', 'Rick - Conversational AI', 'eleven_flash_v2_5', 50,
   '{"stability": 0.5, "similarity_boost": 0.75, "style": 0.15, "use_speaker_boost": true, "speed": 0.97}',
   'Warm, confident, approachable and professional; built for AI assistants.'),
  ('female', 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Sarah - Mature, Reassuring, Confident', 'eleven_flash_v2_5', 50,
   '{"stability": 0.5, "similarity_boost": 0.75, "style": 0.15, "use_speaker_boost": true, "speed": 0.97}',
   'ElevenLabs built-in voice (every plan): warm, confident, reassuring, professional.');

-- The interaction ledger records voice generations too (request_type
-- 'voice_tts', characters in input_tokens), so it must accept the voice
-- provider.
alter table public.agent_interactions drop constraint agent_interactions_provider_check;
alter table public.agent_interactions add constraint agent_interactions_provider_check
  check (provider = any (array['gemini', 'anthropic', 'elevenlabs']));

do $bucket$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('agent-voice', 'agent-voice', false, 5242880, array['audio/mpeg'])
    on conflict (id) do nothing;
  end if;
end
$bucket$;
