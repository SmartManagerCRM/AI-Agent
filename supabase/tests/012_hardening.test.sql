-- pgTAP: Phase 11 structural checks (spec §98 Hardening — final phase).
-- Covers the performance-advisor migration's own new state: `(select
-- auth.uid())`-wrapped policies (auth_rls_initplan), the split
-- ai_model_configs write policies (multiple_permissive_policies), and the
-- curated FK indexes. Application-layer changes (rate limiting, nonce CSP)
-- have no structural DB state to assert here — they're covered by
-- tests/unit/rate-limit.test.ts and the live curl verification recorded in
-- ARCHITECTURE_ASSESSMENT.md.
begin;
select plan(9);

-- `auth.uid()` is wrapped in a subselect in every policy this migration
-- touched, so Postgres evaluates it once per query instead of once per row.
select ok(
  (select qual like '%( SELECT auth.uid() AS uid)%' from pg_policies
   where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'),
  'profiles_select wraps auth.uid() in a subselect'
);
select ok(
  (select qual like '%( SELECT auth.uid() AS uid)%' from pg_policies
   where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'),
  'profiles_update wraps auth.uid() in a subselect'
);
select ok(
  (select qual like '%( SELECT auth.uid() AS uid)%' from pg_policies
   where schemaname = 'public' and tablename = 'tenant_members' and cmd = 'SELECT'),
  'tenant_members_select wraps auth.uid() in a subselect'
);

-- The old single `for all` policy on ai_model_configs is gone, replaced by
-- three narrower ones sitting alongside the pre-existing select policy —
-- clearing the multiple_permissive_policies advisor without changing who
-- can do what (still Super-Admin-only for every write).
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'ai_model_configs' and cmd = 'ALL'),
  0,
  'ai_model_configs no longer has a single for-all write policy'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'ai_model_configs' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  3,
  'ai_model_configs has separate insert/update/delete policies instead'
);

-- Curated FK indexes (spec §65) — a targeted subset of the advisor's
-- flagged unindexed foreign keys, not all of them (see
-- ARCHITECTURE_ASSESSMENT.md §21 for which were deliberately left out and
-- why).
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and indexname in (
    'cart_items_product_idx', 'order_items_product_idx', 'orders_branch_idx',
    'orders_cart_idx', 'orders_conversation_idx', 'tenant_members_role_idx',
    'payments_tenant_idx', 'conversation_messages_tenant_idx', 'carts_branch_idx'
  )),
  9,
  'all 9 curated FK indexes exist'
);

-- RLS is still enabled+forced everywhere this migration touched — a policy
-- rewrite is not a policy removal.
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
   where relnamespace = 'public'::regnamespace and relname = 'ai_model_configs'),
  'ai_model_configs still has RLS enabled and forced'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
   where relnamespace = 'public'::regnamespace and relname = 'profiles'),
  'profiles still has RLS enabled and forced'
);

select * from finish();
rollback;
