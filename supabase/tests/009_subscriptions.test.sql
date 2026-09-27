-- pgTAP: Phase 7 structural checks (spec §98 Trial & Subscription).
begin;
select plan(11);

select has_table('public', 'subscription_plans', 'subscription_plans table exists');
select has_table('public', 'subscriptions', 'subscriptions table exists');
select has_table('public', 'subscription_payments', 'subscription_payments table exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.subscriptions'::regclass),
  'RLS is enabled and forced on subscriptions'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.subscription_payments'::regclass),
  'RLS is enabled and forced on subscription_payments'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'subscriptions' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'subscriptions has no direct insert/update/delete policy'
);

select is(
  (select count(*)::int from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('create_subscription_payment_attempt', 'record_subscription_payment_provider_intent',
                           'mark_subscription_payment_succeeded', 'mark_subscription_payment_failed')),
  4,
  'all four subscription-payment-writing functions exist'
);

-- Unlike payments_order_active_uidx (Phase 6), only a *pending* attempt is
-- exclusive here — a subscription is paid again every period, so a past
-- success must never block a future one.
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'subscription_payments_tenant_pending_uidx') like '%WHERE (status = ''pending''::text)%',
  true,
  'subscription_payments_tenant_pending_uidx only excludes pending, not succeeded, rows'
);

-- Exactly one default plan (create_business relies on this).
select is(
  (select count(*)::int from public.subscription_plans where is_default and is_active),
  1,
  'exactly one active default plan is seeded'
);

select has_column('public', 'subscriptions', 'trial_ends_at', 'subscriptions.trial_ends_at exists');
select is(
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'subscription_payments_provider_intent_uidx'),
  1::bigint,
  'subscription payment provider intents have a unique index (partial, non-null only)'
);

select * from finish();
rollback;
