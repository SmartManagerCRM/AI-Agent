-- pgTAP: emails to the subscriber about their subscription (queued by the database).
--   A  a new business's trial; a real payment (never a test one), once per payment
--   B  upgrade / downgrade of a paid plan (not the first payment from the trial)
--   C  cancellation scheduled / withdrawn, ended; Paddle paused vs a failed renewal
--   D  the sender: claims due emails with the owner's address and language; only the service role
begin;
select plan(21);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000c0aa1', 'mail-owner@test.local');
insert into public.profiles (id, full_name, email, preferred_language) values ('00000000-0000-4000-8000-0000000c0aa1', 'Mona Owner', 'mail-owner@test.local', 'ar')
  on conflict (id) do update set email = excluded.email, preferred_language = excluded.preferred_language, full_name = excluded.full_name;
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone, default_language) values
  ('00000000-0000-4000-8000-0000000c0bb1', 'mail-a', '{"en":"Mail A"}', 'restaurant', 'active', 'USD', 'UTC', 'en');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000c0bb1', '00000000-0000-4000-8000-0000000c0aa1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.subscription_plans (key, name, price_minor, currency, billing_interval, is_active, sort_order) values
  ('mail_small', '{"en":"Small"}', 7900, 'USD', 'month', true, 95),
  ('mail_big', '{"en":"Big"}', 24900, 'USD', 'month', true, 96),
  ('mail_year', '{"en":"Yearly"}', 120000, 'USD', 'year', true, 97);
delete from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000c0bb1';
delete from public.subscription_emails where tenant_id = '00000000-0000-4000-8000-0000000c0bb1';
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role';
    execute 'grant execute on all functions in schema tap to authenticated, service_role';
  end if;
end $$;
create temp view mails as
  select kind, details from public.subscription_emails
   where tenant_id = '00000000-0000-4000-8000-0000000c0bb1' and kind <> 'new_subscriber_admin' order by id;
grant select on mails to authenticated, service_role;

-- ── A ───────────────────────────────────────────────────────────────────
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at)
values ('00000000-0000-4000-8000-0000000c0bb1', 'mail_small', 'trialing', '2026-10-20T00:00:00Z');
select is((select string_agg(kind, ',') from mails), 'trial_started', 'a new trial queues a "trial started" email');
select is((select details ->> 'plan_key' from mails where kind = 'trial_started'), 'mail_small', '… naming the plan');

insert into public.subscription_payments (tenant_id, plan_key, provider, status, amount_minor, currency)
values ('00000000-0000-4000-8000-0000000c0bb1', 'mail_small', 'mock', 'succeeded', 7900, 'USD');
select is((select count(*)::int from mails where kind = 'payment_received'), 0, 'a test-checkout payment sends nothing');

insert into public.subscription_payments (id, tenant_id, plan_key, provider, provider_intent_id, status, amount_minor, currency)
values ('00000000-0000-4000-8000-0000000c0dd1', '00000000-0000-4000-8000-0000000c0bb1', 'mail_small', 'paddle', 'txn_mail_1', 'pending', 7900, 'USD');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_paddle_payment('evt_mail_1', 'txn_mail_1', 'sub_mail', 'ctm_mail', 'mail_small', 7900, 'USD', 7900, now(), now() + interval '1 month', '{}');
reset role;
select is((select details ->> 'amount_minor' || ' ' || (details ->> 'currency') from mails where kind = 'payment_received'), '7900 USD',
  'a Paddle payment queues a "payment received" email with its amount');
update public.subscription_payments set raw_verification = '{"again":true}', status = 'succeeded' where id = '00000000-0000-4000-8000-0000000c0dd1';
select is((select count(*)::int from mails where kind = 'payment_received'), 1, '… once per payment');
select is((select count(*)::int from mails where kind in ('upgraded', 'downgraded')), 0, 'the first payment from the trial is not a plan change');

-- ── B ───────────────────────────────────────────────────────────────────
update public.subscriptions set plan_key = 'mail_big' where tenant_id = '00000000-0000-4000-8000-0000000c0bb1';
select is((select details ->> 'from_plan' || '>' || (details ->> 'plan_key') from mails where kind = 'upgraded'), 'mail_small>mail_big',
  'moving to a higher-priced plan is an upgrade');
update public.subscriptions set plan_key = 'mail_year' where tenant_id = '00000000-0000-4000-8000-0000000c0bb1';
select is((select count(*)::int from mails where kind = 'downgraded'), 1, 'a yearly plan cheaper per month than the current one is a downgrade');

-- ── C ───────────────────────────────────────────────────────────────────
update public.subscriptions set cancel_at = '2026-11-04T00:00:00Z' where tenant_id = '00000000-0000-4000-8000-0000000c0bb1';
select is((select details ->> 'cancel_at' from mails where kind = 'cancel_scheduled')::date, '2026-11-04'::date, 'a scheduled cancellation, with its date');
update public.subscriptions set cancel_at = null where tenant_id = '00000000-0000-4000-8000-0000000c0bb1';
select is((select count(*)::int from mails where kind = 'renewal_resumed'), 1, 'withdrawing it: the subscription renews again');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_paddle_subscription_event('evt_mail_2', now() + interval '1 minute', 'sub_mail', null, null, 'past_due', null, null, '{}');
reset role;
select is((select count(*)::int from mails where kind = 'payment_failed'), 1, 'a failed renewal (past due)');
update public.subscriptions set status = 'active' where tenant_id = '00000000-0000-4000-8000-0000000c0bb1';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_paddle_subscription_event('evt_mail_3', now() + interval '2 minutes', 'sub_mail', null, null, 'paused', null, null, '{}');
reset role;
select is((select count(*)::int from mails where kind = 'paused'), 1, 'Paddle pausing it is a "paused" email, not a payment failure');
select is((select count(*)::int from mails where kind = 'payment_failed'), 1, '… (still one payment failure)');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_paddle_subscription_event('evt_mail_4', now() + interval '3 minutes', 'sub_mail', null, null, 'canceled', null, null, '{}');
reset role;
select is((select count(*)::int from mails where kind = 'canceled'), 1, 'the subscription ended');
select is((select string_agg(kind, ',') from mails),
  'trial_started,payment_received,upgraded,downgraded,cancel_scheduled,renewal_resumed,payment_failed,paused,canceled', 'one email per change, in order');

-- ── D: the sender ───────────────────────────────────────────────────────
-- (The Super Admins' "new subscriber" email is tested in 032.)
update public.subscription_emails set status = 'skipped' where kind = 'new_subscriber_admin';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000c0aa1","role":"authenticated"}';
select is((select count(*)::int from public.subscription_emails), 0, 'a subscriber cannot read the email queue');
select throws_ok($$ select * from public.claim_subscription_emails(5) $$, '42501', null, '… nor take emails to send');
reset role;
update public.subscription_emails set next_attempt_at = now() + interval '1 day' where tenant_id <> '00000000-0000-4000-8000-0000000c0bb1' and status = 'pending';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
create temp table claimed as select * from public.claim_subscription_emails(3);
reset role;
select is((select string_agg(kind, ',' order by id) from claimed), 'trial_started,payment_received,upgraded', 'the sender takes the oldest due emails');
select is((select distinct owner_email || '|' || owner_language || '|' || (plans -> 'mail_year' ->> 'billing_interval') from claimed),
  'mail-owner@test.local|ar|year', '… with the owner''s address and language, and the plans (monthly or yearly)');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.finish_subscription_email((select min(id) from claimed), 'sent');
select public.finish_subscription_email((select max(id) from claimed), 'retry', 'timeout', 60);
reset role;
select is((select string_agg(status, ',' order by id) from public.subscription_emails where id in (select id from claimed)), 'sent,sending,pending',
  'sent once delivered; a failed send is retried later');
select is((select count(*)::int from public.claim_subscription_emails(10) c where c.id in (select id from claimed)), 0,
  'an email being sent or waiting for its retry is not taken twice');

select * from finish();
rollback;
