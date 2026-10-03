-- pgTAP: the plan's AI cost cap covers the AI Agent only — premium voice is reported apart.
begin;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000f0aa2', 'voicecap-admin@test.local');
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000f0aa2');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-0000000f0bb1', 'voicecap', '{"en":"Voice Cap"}', 'restaurant', 'active', 'USD');
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at, current_period_start, current_period_end) values
  ('00000000-0000-4000-8000-0000000f0bb1', 'starter', 'active', now() - interval '20 days', now() - interval '1 day', now() - interval '1 day' + interval '1 month');

-- This period: two AI replies ($0.30) and a lot of premium voice ($9.00 at paid rates).
insert into public.agent_interactions (tenant_id, request_type, handled_by, provider, model, input_tokens, output_tokens, estimated_cost_usd, latency_ms, success)
values
  ('00000000-0000-4000-8000-0000000f0bb1', 'external_agent', 'ai', 'gemini', 'g', 100, 50, 0.10, 100, true),
  ('00000000-0000-4000-8000-0000000f0bb1', 'external_agent', 'ai', 'gemini', 'g', 100, 50, 0.20, 100, true),
  ('00000000-0000-4000-8000-0000000f0bb1', 'voice_tts', 'ai', 'elevenlabs', 'eleven_flash_v2_5', 60000, 0, 9.00, 100, true);

select is((public.ai_usage_check('00000000-0000-4000-8000-0000000f0bb1') ->> 'ai_state'), 'ok', 'voice does not use up the AI cost cap');
select is(round((select ai_cost_usd from public.ai_usage_periods where tenant_id = '00000000-0000-4000-8000-0000000f0bb1')::numeric, 2), 0.30,
  'the period''s AI spend is the AI Agent''s alone');
select is((select ai_calls from public.ai_usage_periods where tenant_id = '00000000-0000-4000-8000-0000000f0bb1'), 2, '… and its AI calls');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa2","role":"authenticated"}';
select is(round(((select r from jsonb_array_elements(public.platform_usage_overview('00000000-0000-4000-8000-0000000f0bb1')) r) ->> 'agent_voice_cost')::numeric, 2), 9.00,
  'Super Admin still sees the voice on its own');
select is(round(((select r from jsonb_array_elements(public.platform_usage_overview('00000000-0000-4000-8000-0000000f0bb1')) r) ->> 'ai_cost_used')::numeric, 2), 0.30,
  '… next to the AI Agent cost the cap counts');
reset role;

select * from finish();
rollback;
