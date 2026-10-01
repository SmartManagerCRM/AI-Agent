-- pgTAP: subscription usage control + AI cost governance.
--   A–C  conversation limits per plan (999 / 1000 / 1001 …), grace period
--   D    AI cost hard cap per plan ($14.99 allowed / $15 blocked …)
--   E    billing-period reset (from the payment, not created_at)
--   F–G  per-subscriber overrides, plan-default changes, reset to defaults
--   H    subscribers never see AI dollar figures; only Super Admin edits
--   I    trial accounts are not governed by the paid-plan limits
--   J    reservations: in-flight calls count against the cap
-- (Parallel-session concurrency: supabase/tests/concurrency/reserve_ai_cost.sh.)
begin;
select plan(99);

-- ── Fixtures ────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'usage-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'usage-admin@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'usage-trial-owner@test.local');
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000000a2');

insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-0000000000b1', 'usage-paid', '{"en":"Usage Paid"}', 'restaurant', 'active', 'USD'),
  ('00000000-0000-4000-8000-0000000000b2', 'usage-other', '{"en":"Usage Other"}', 'restaurant', 'active', 'USD'),
  ('00000000-0000-4000-8000-0000000000b3', 'usage-trial', '{"en":"Usage Trial"}', 'restaurant', 'active', 'USD');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', id from public.roles where key = 'business_owner';
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a3', id from public.roles where key = 'business_owner';

-- Paid this billing period (started yesterday).
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at, current_period_start, current_period_end) values
  ('00000000-0000-4000-8000-0000000000b1', 'starter', 'active', now() - interval '20 days', now() - interval '1 day', now() - interval '1 day' + interval '1 month'),
  ('00000000-0000-4000-8000-0000000000b2', 'starter', 'active', now() - interval '20 days', now() - interval '1 day', now() - interval '1 day' + interval '1 month'),
  ('00000000-0000-4000-8000-0000000000b3', 'starter', 'trialing', now() + interval '5 days', null, null);

create function pg_temp.add_conversations(p_tenant uuid, p_count int, p_at timestamptz default now() - interval '1 hour')
returns void language sql as $$
  insert into public.conversations (tenant_id, session_token_hash, last_message_at)
  select p_tenant, md5(random()::text || g::text), p_at from generate_series(1, p_count) g;
$$;
create function pg_temp.snap(p_tenant uuid) returns jsonb language sql as $$
  select public.ai_usage_check(p_tenant);
$$;
create function pg_temp.set_ai_spend(p_tenant uuid, p_usd numeric) returns void language sql as $$
  delete from public.ai_cost_reservations where tenant_id = p_tenant;
  insert into public.ai_usage_periods (tenant_id, period_start, ai_cost_usd)
  values (p_tenant, (pg_temp.snap(p_tenant) ->> 'period_start')::timestamptz, p_usd)
  on conflict (tenant_id, period_start) do update set ai_cost_usd = excluded.ai_cost_usd;
$$;

-- ── Plan defaults are data, not code ────────────────────────────────────
select is((select conversation_limit from public.subscription_plans where key = 'starter'), 1000, 'Starter: 1,000 conversations');
select is((select conversation_limit from public.subscription_plans where key = 'growth'), 5000, 'Growth: 5,000 conversations');
select is((select conversation_limit from public.subscription_plans where key = 'pro'), 10000, 'Pro: 10,000 conversations');
select is((select limit_usd from public.ai_cost_limits where plan_key = 'starter'), 15.00, 'Starter: $15 AI cap');
select is((select limit_usd from public.ai_cost_limits where plan_key = 'growth'), 30.00, 'Growth: $30 AI cap');
select is((select limit_usd from public.ai_cost_limits where plan_key = 'pro'), 60.00, 'Pro: $60 AI cap');
select is((select grace_period_hours from public.subscription_plans where key = 'starter'), 24, 'grace period defaults to 24 hours');

-- ── A. Starter: 999 / 1000 / 1001 conversations ─────────────────────────
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 999);
-- Last period's conversations never count in this one.
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 50, now() - interval '3 days');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversations_used', '999', 'A: counts only this period''s conversations');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'ok', 'A: 999 / 1000 → AI still available');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_warning_level', '95', 'A: 999 / 1000 → 95% warning');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'usage_state', 'CONVERSATION_WARNING', 'A: state CONVERSATION_WARNING');
select ok((public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.001) ->> 'allowed')::boolean, 'A: 999 → LLM call allowed');

select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 1);
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'grace', 'A: 1000 / 1000 → grace period starts');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'usage_state', 'CONVERSATION_GRACE_PERIOD', 'A: state CONVERSATION_GRACE_PERIOD');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_warning_level', '100', 'A: 1000 / 1000 → 100% warning');
select is((select conversation_limit_grace_until - conversation_limit_reached_at from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000b1'),
  interval '24 hours', 'A: grace period stored server-side (24h)');
select is((select count(*)::int from public.audit_logs where tenant_id = '00000000-0000-4000-8000-0000000000b1' and action = 'usage.conversation_limit_reached'),
  1, 'A: limit reached is audited once');
select ok((public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.001) ->> 'allowed')::boolean, 'A: during the grace period the LLM still answers');

select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 1);
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversations_used', '1001', 'A: 1001 conversations counted');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'grace', 'A: 1001 within grace → still grace (grace start unchanged)');

-- Grace over.
update public.subscriptions set conversation_limit_reached_at = now() - interval '2 hours', conversation_limit_grace_until = now() - interval '1 hour'
  where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'blocked', 'A: after the grace period → LLM blocked');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'usage_state', 'CONVERSATION_LIMIT_REACHED', 'A: state CONVERSATION_LIMIT_REACHED');
select is(public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.001) ->> 'reason', 'conversation_limit', 'A: reserve refused: conversation_limit');
select is((select status from public.tenants where id = '00000000-0000-4000-8000-0000000000b1'), 'active', 'A: the tenant itself is never disabled');

-- ── B. Growth: 4999 / 5000 / 5001 ──────────────────────────────────────
update public.subscriptions set plan_key = 'growth' where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 4999 - 1001);
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'ok', 'B: 4999 / 5000 → allowed (old stamps cleared)');
select is((select conversation_limit_reached_at from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000b1'), null, 'B: grace stamps cleared under the limit');
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 1);
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'grace', 'B: 5000 / 5000 → grace');
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 1);
update public.subscriptions set conversation_limit_grace_until = now() - interval '1 second' where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'blocked', 'B: 5001 after grace → blocked');

-- ── C. Pro: 9999 / 10000 / 10001 ───────────────────────────────────────
update public.subscriptions set plan_key = 'pro' where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 9999 - 5001);
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'ok', 'C: 9999 / 10000 → allowed');
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 1);
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'grace', 'C: 10000 / 10000 → grace');
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 1);
update public.subscriptions set conversation_limit_grace_until = now() - interval '1 second' where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_state', 'blocked', 'C: 10001 after grace → blocked');

-- ── D. AI cost hard cap ($14.99 / $15, $29.99 / $30, $59.99 / $60) ─────
delete from public.conversations where tenant_id = '00000000-0000-4000-8000-0000000000b1';
update public.subscriptions set plan_key = 'starter' where tenant_id = '00000000-0000-4000-8000-0000000000b1';

select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 14.99);
select ok((public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.002) ->> 'allowed')::boolean, 'D: Starter $14.99 → allowed');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'usage_state', 'AI_COST_WARNING', 'D: $14.99 / $15 → AI_COST_WARNING');
select ok(not (public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.02) ->> 'allowed')::boolean, 'D: a call that could overshoot $15 is refused');
select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 15.00);
select is(public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.0001) ->> 'reason', 'ai_cost_limit', 'D: Starter $15.00 → AI_COST_LIMIT_REACHED');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'usage_state', 'AI_COST_LIMIT_REACHED', 'D: state AI_COST_LIMIT_REACHED (conversations under the limit)');

update public.subscriptions set plan_key = 'growth' where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 29.99);
select ok((public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.002) ->> 'allowed')::boolean, 'D: Growth $29.99 → allowed');
select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 30.00);
select is(public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.0001) ->> 'reason', 'ai_cost_limit', 'D: Growth $30.00 → blocked');

update public.subscriptions set plan_key = 'pro' where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 59.99);
select ok((public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.002) ->> 'allowed')::boolean, 'D: Pro $59.99 → allowed');
select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 60.00);
select is(public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.0001) ->> 'reason', 'ai_cost_limit', 'D: Pro $60.00 → blocked');

-- Both limits at once.
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 10000);
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'usage_state', 'BOTH_LIMITS_REACHED', 'D: conversation + AI cost limits → BOTH_LIMITS_REACHED');
delete from public.conversations where tenant_id = '00000000-0000-4000-8000-0000000000b1';

-- Settling records the actual cost; Business Brain cost is never part of it.
update public.subscriptions set plan_key = 'starter' where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 1.00);
select public.settle_ai_cost('00000000-0000-4000-8000-0000000000b1',
  (public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.01) ->> 'reservation_id')::uuid, 0.004);
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'ai_cost_used')::numeric, 1.004, 'D: settle adds the actual cost');
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'ai_cost_reserved')::numeric, 0::numeric, 'D: settle releases the reservation');
insert into public.agent_interactions (tenant_id, request_type, handled_by, success, estimated_cost_usd, provider, model)
values ('00000000-0000-4000-8000-0000000000b1', 'brain_ingestion', 'ai', true, 5, 'gemini', 'test-model');
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'ai_cost_used')::numeric, 1.004, 'D: Business Brain cost does not count against the cap');

-- ── E. Billing period reset (from the payment) ─────────────────────────
-- Paid Oct 17 → period Oct 17 … Nov 16, resets Nov 17.
update public.subscriptions set current_period_start = '2026-10-17T00:00:00Z', current_period_end = '2026-11-17T00:00:00Z'
  where tenant_id = '00000000-0000-4000-8000-0000000000b2';
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b2', 3, '2026-10-16T23:59:00Z');
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b2', 5, '2026-10-17T00:00:00Z');
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b2', 7, '2026-11-16T23:59:00Z');
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b2', 11, '2026-11-17T00:00:00Z');
select is((app.usage_snapshot('00000000-0000-4000-8000-0000000000b2', false) ->> 'conversations_used')::int, 12, 'E: Oct 17 → Nov 16 counts only that period');
select is((app.usage_snapshot('00000000-0000-4000-8000-0000000000b2', false) ->> 'period_start')::timestamptz, '2026-10-17T00:00:00Z'::timestamptz, 'E: period starts at the payment date');
select is((app.usage_snapshot('00000000-0000-4000-8000-0000000000b2', false) ->> 'period_end')::timestamptz, '2026-11-17T00:00:00Z'::timestamptz, 'E: usage resets Nov 17');

-- Renewal payment: new period from the payment, usage back to zero.
update public.subscriptions set current_period_start = now() - interval '40 days', current_period_end = now() - interval '10 days',
  conversation_limit_reached_at = now() - interval '11 days', conversation_limit_grace_until = now() - interval '10 days'
  where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b1', 20, now() - interval '20 days');
select ok(not (pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'is_paid')::boolean, 'E: an expired period is not a paid subscription');
insert into public.subscription_payments (id, tenant_id, plan_key, amount_minor, currency)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'starter', 7900, 'USD');
select public.mark_subscription_payment_succeeded('00000000-0000-4000-8000-0000000000c1', 'evt-usage-test-1', '{}'::jsonb);
select is((select current_period_start from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000b1'), now(), 'E: renewal sets the period start to the payment time');
select is((select current_period_end from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000b1'), now() + interval '1 month', 'E: … and the end one month later');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversations_used', '0', 'E: conversations reset to 0 in the new period');
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'ai_cost_used')::numeric, 0::numeric, 'E: AI spend reset to 0 in the new period');
select is((select conversation_limit_reached_at from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000b1'), null, 'E: grace stamps cleared on renewal');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'usage_state', 'ACTIVE', 'E: state back to ACTIVE');

-- ── F. Per-subscriber overrides (Super Admin) ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.set_subscription_usage_overrides('00000000-0000-4000-8000-0000000000b1', 1200, 20) $$, 'F: Super Admin sets overrides');
select lives_ok($$ select public.set_plan_usage_limits('starter', 1100, 16, 24) $$, 'F: Super Admin changes the Starter plan defaults');
reset role;
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_limit')::int, 1200, 'F: override wins over the plan default (conversations)');
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'ai_cost_limit')::numeric, 20.00, 'F: override wins over the plan default (AI cost)');
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b2') ->> 'conversation_limit')::int, 1100, 'F: subscriber without override uses the new plan default');
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b2') ->> 'ai_cost_limit')::numeric, 16.00, 'F: … for AI cost too');
select is((select conversation_limit_override from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000b1'), 1200, 'F: changing the plan default kept the override');
select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 19.99);
select ok((public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.002) ->> 'allowed')::boolean, 'F: $19.99 under a $20 override → allowed');
select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 20);
select ok(not (public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.0001) ->> 'allowed')::boolean, 'F: $20 under a $20 override → blocked');

-- ── G. Reset to plan defaults ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.set_subscription_usage_overrides('00000000-0000-4000-8000-0000000000b1', null, null) $$, 'G: Reset to Plan Defaults');
reset role;
select is((select conversation_limit_override from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000b1'), null, 'G: conversation override is NULL');
select is((select count(*)::int from public.ai_cost_limits where tenant_id = '00000000-0000-4000-8000-0000000000b1'), 0, 'G: AI cost override removed');
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'conversation_limit')::int, 1100, 'G: effective conversation limit = plan default');
select is((pg_temp.snap('00000000-0000-4000-8000-0000000000b1') ->> 'ai_cost_limit')::numeric, 16.00, 'G: effective AI cost limit = plan default');

-- ── H. Security: subscribers never see AI dollar figures ───────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.ai_cost_limits), 0, 'H: subscriber reads no AI cost limits');
select is((select count(*)::int from public.ai_usage_periods), 0, 'H: subscriber reads no AI spend');
select is((select count(*)::int from public.usage_settings), 0, 'H: subscriber reads no governance settings');
select throws_ok($$ select count(*) from public.ai_cost_reservations $$, '42501', null, 'H: reservations are not readable');
select throws_ok($$ select ai_monthly_budget_usd from public.tenant_settings $$, '42501', null, 'H: tenant AI budget column is hidden');
select throws_ok($$ select default_ai_monthly_budget_usd from public.platform_settings $$, '42501', null, 'H: platform AI budget column is hidden');
select throws_ok($$ update public.tenant_settings set ai_monthly_budget_usd = 1000 $$, '42501', null, 'H: subscriber cannot write the AI budget');
select ok(not (public.tenant_usage_summary('00000000-0000-4000-8000-0000000000b1') ?| array['ai_cost_limit', 'ai_cost_used', 'ai_cost_reserved', 'ai_cost_percent', 'ai_calls', 'ai_state', 'usage_state', 'conversation_limit_default', 'conversation_limit_override']),
  'H: the subscriber summary carries no AI cost fields');
select ok(not exists (select 1 from jsonb_object_keys(public.tenant_usage_summary('00000000-0000-4000-8000-0000000000b1')) k where k ~ 'cost|usd|budget'),
  'H: no cost/usd/budget key at all');
select is((public.tenant_usage_summary('00000000-0000-4000-8000-0000000000b1') ->> 'ai_limited')::boolean, true, 'H: the subscriber only learns "AI is limited" ($20 spent ≥ $16)');
select throws_ok($$ select public.tenant_usage_summary('00000000-0000-4000-8000-0000000000b2') $$, '42501', null, 'H: another business''s usage is refused');
select throws_ok($$ select public.ai_usage_check('00000000-0000-4000-8000-0000000000b1') $$, '42501', null, 'H: guard snapshot is server-only');
select throws_ok($$ select public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0) $$, '42501', null, 'H: reserve is server-only');
select throws_ok($$ select public.settle_ai_cost('00000000-0000-4000-8000-0000000000b1', null, 0) $$, '42501', null, 'H: settle is server-only');
select throws_ok($$ select public.set_subscription_usage_overrides('00000000-0000-4000-8000-0000000000b1', 999999, 9999) $$, '42501', null, 'H: subscriber cannot raise their own limits');
select throws_ok($$ select public.set_plan_usage_limits('starter', 999999, 9999, 24) $$, '42501', null, 'H: subscriber cannot change plan limits');
select throws_ok($$ select public.platform_usage_overview() $$, '42501', null, 'H: platform analytics are Super Admin only');
select throws_ok($$ insert into public.ai_cost_limits (tenant_id, limit_usd) values ('00000000-0000-4000-8000-0000000000b1', 9999) $$, '42501', null, 'H: subscriber cannot insert an AI cost limit');
reset role;
set local role anon;
select throws_ok($$ select public.tenant_usage_summary('00000000-0000-4000-8000-0000000000b1') $$, '42501', null, 'H: anonymous callers get nothing');
reset role;
select is((select count(*)::int from information_schema.columns
  where table_schema = 'public' and table_name in ('subscription_plans', 'subscriptions') and column_name ~ 'cost|usd|budget'), 0,
  'H: no AI dollar column on the subscriber-readable plan/subscription tables');

-- Super Admin sees it all.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select ok(jsonb_array_length(public.platform_usage_overview()) >= 3, 'H: Super Admin gets the platform usage overview');
select is((select (r ->> 'brain_ai_cost')::numeric from jsonb_array_elements(public.platform_usage_overview()) r where r ->> 'slug' = 'usage-paid'),
  5::numeric, 'H: Business Brain cost is reported separately');
reset role;

-- ── I. Trial unchanged ─────────────────────────────────────────────────
select pg_temp.add_conversations('00000000-0000-4000-8000-0000000000b3', 1500);
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b3') ->> 'usage_state', 'TRIAL', 'I: trial is reported as TRIAL');
select is(pg_temp.snap('00000000-0000-4000-8000-0000000000b3') ->> 'conversation_state', 'ok', 'I: paid-plan conversation limit not applied to a trial');
insert into public.ai_usage_periods (tenant_id, period_start, ai_cost_usd)
values ('00000000-0000-4000-8000-0000000000b3', (pg_temp.snap('00000000-0000-4000-8000-0000000000b3') ->> 'period_start')::timestamptz, 100);
select is(public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b3', 0.01), '{"allowed": true, "governed": false, "reservation_id": null}'::jsonb,
  'I: trial is not governed by the paid AI cost caps (existing trial rules apply)');
select is((select trial_ends_at from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000b3'), now() + interval '5 days', 'I: trial end date untouched');
select is((select conversation_limit_reached_at from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000b3'), null, 'I: no grace period started on a trial');

-- ── J. In-flight reservations count against the cap ────────────────────
select pg_temp.set_ai_spend('00000000-0000-4000-8000-0000000000b1', 15.95);
select ok((public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.02) ->> 'allowed')::boolean, 'J: first in-flight call reserved ($15.97 of $16)');
select ok((public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.02) ->> 'allowed')::boolean, 'J: second in-flight call reserved ($15.99 of $16)');
select ok(not (public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.02) ->> 'allowed')::boolean, 'J: third call refused — reservations would overshoot');
update public.ai_cost_reservations set expires_at = now() - interval '1 second' where tenant_id = '00000000-0000-4000-8000-0000000000b1';
select ok((public.reserve_ai_cost('00000000-0000-4000-8000-0000000000b1', 0.02) ->> 'allowed')::boolean, 'J: abandoned reservations expire and free the budget');

select * from finish();
rollback;
