-- pgTAP: the subscriber's AI allowance as a share only (tenant_usage_summary.ai_usage_percent).
begin;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000f35a1', 'ai-share-owner@test.local'),
  ('00000000-0000-4000-8000-0000000f35a2', 'ai-share-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-0000000f35b1', 'ai-share-a', '{"en":"AI Share A"}', 'restaurant', 'active', 'USD', 'UTC'),
  ('00000000-0000-4000-8000-0000000f35b2', 'ai-share-b', '{"en":"AI Share B"}', 'restaurant', 'active', 'USD', 'UTC');
insert into public.tenant_settings (tenant_id) values ('00000000-0000-4000-8000-0000000f35b1'), ('00000000-0000-4000-8000-0000000f35b2')
  on conflict (tenant_id) do nothing;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000f35b1', '00000000-0000-4000-8000-0000000f35a1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000f35b2', '00000000-0000-4000-8000-0000000f35a2', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.subscription_plans (key, name, price_minor, currency, billing_interval, is_active, is_public, sort_order) values
  ('c35_capped', '{"en":"Capped"}', 7900, 'USD', 'month', true, false, 96),
  ('c35_open', '{"en":"Open"}', 9900, 'USD', 'month', true, false, 97);
insert into public.ai_cost_limits (plan_key, limit_usd) values ('c35_capped', 10);
delete from public.subscriptions where tenant_id in ('00000000-0000-4000-8000-0000000f35b1', '00000000-0000-4000-8000-0000000f35b2');
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at, current_period_start, current_period_end) values
  ('00000000-0000-4000-8000-0000000f35b1', 'c35_capped', 'active', now() - interval '20 days', now() - interval '10 days', now() + interval '20 days'),
  ('00000000-0000-4000-8000-0000000f35b2', 'c35_open', 'active', now() - interval '20 days', now() - interval '10 days', now() + interval '20 days');
-- $3.79 of the $10 cap spent this period.
insert into public.agent_interactions (tenant_id, request_type, handled_by, provider, model, success, estimated_cost_usd)
values ('00000000-0000-4000-8000-0000000f35b1', 'customer_message', 'ai', 'gemini', 'c35-model', true, 3.79);
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role, anon';
    execute 'grant execute on all functions in schema tap to authenticated, service_role, anon';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f35a1","role":"authenticated"}';
select is((public.tenant_usage_summary('00000000-0000-4000-8000-0000000f35b1') ->> 'ai_usage_percent')::int, 37,
  'the subscriber sees the share of the AI allowance used, rounded down (37%)');
select ok(
  (select not (s ? 'ai_cost_used') and not (s ? 'ai_cost_limit') and not (s ? 'ai_cost_reserved') and not (s ? 'ai_cost_percent') and not (s ? 'ai_calls')
     from public.tenant_usage_summary('00000000-0000-4000-8000-0000000f35b1') s),
  '… never the amount spent, the cap, reservations or calls');
select ok(not (public.tenant_usage_summary('00000000-0000-4000-8000-0000000f35b1')::text ~ '3\.79|10\.00'),
  '… and no cost figure anywhere in what they receive');
select throws_ok($$ select public.tenant_usage_summary('00000000-0000-4000-8000-0000000f35b2') $$, '42501', null,
  'another business''s usage stays private');
reset role;

-- Over the cap: 100%, never more.
insert into public.agent_interactions (tenant_id, request_type, handled_by, provider, model, success, estimated_cost_usd)
values ('00000000-0000-4000-8000-0000000f35b1', 'customer_message', 'ai', 'gemini', 'c35-model', true, 9);
delete from public.ai_usage_periods where tenant_id = '00000000-0000-4000-8000-0000000f35b1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f35a1","role":"authenticated"}';
select is((public.tenant_usage_summary('00000000-0000-4000-8000-0000000f35b1') ->> 'ai_usage_percent')::int, 100, 'over the cap: 100%, never more');
reset role;

-- No cap: no share.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f35a2","role":"authenticated"}';
select ok(public.tenant_usage_summary('00000000-0000-4000-8000-0000000f35b2') ->> 'ai_usage_percent' is null, 'a plan without an AI cap shows no share');
select ok(public.tenant_usage_summary('00000000-0000-4000-8000-0000000f35b2') ? 'conversations_used', 'conversations are still there');
reset role;

select * from finish();
rollback;
