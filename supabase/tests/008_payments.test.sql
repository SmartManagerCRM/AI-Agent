-- pgTAP: Phase 6 structural checks (spec §17, §63, §64).
begin;
select plan(9);

select has_table('public', 'payments', 'payments table exists');
select has_table('public', 'payment_webhook_events', 'payment_webhook_events table exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.payments'::regclass),
  'RLS is enabled and forced on payments'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.payment_webhook_events'::regclass),
  'RLS is enabled and forced on payment_webhook_events'
);

-- No direct write policy anywhere on payments — every write is one of the
-- four SECURITY DEFINER functions below.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'payments' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'payments has no direct insert/update/delete policy'
);

select is(
  (select count(*)::int from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('create_payment_attempt', 'record_payment_provider_intent', 'mark_payment_succeeded', 'mark_payment_failed')),
  4,
  'all four payment-writing functions exist'
);

-- The idempotency guarantee create_payment_attempt/initiatePayment rely on:
-- at most one pending-or-succeeded payment per order.
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'payments_order_active_uidx') is not null,
  true,
  'payments has a unique index enforcing one active attempt per order'
);

-- The webhook idempotency guarantee mark_payment_succeeded/mark_payment_failed rely on.
select col_is_unique('public', 'payment_webhook_events', array['provider', 'event_id'], 'webhook events are unique per provider');

select has_column('public', 'payments', 'status', 'payments.status exists');

select * from finish();
rollback;
