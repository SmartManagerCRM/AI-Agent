-- pgTAP: Phase 8 structural checks (spec §98 Subscriber Admin).
begin;
select plan(9);

select has_table('public', 'staff_invites', 'staff_invites table exists');
select has_column('public', 'profiles', 'email', 'profiles.email exists (denormalized from auth.users)');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.staff_invites'::regclass),
  'RLS is enabled and forced on staff_invites'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'staff_invites' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'staff_invites has no direct insert/update/delete policy'
);

select is(
  (select count(*)::int from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('create_staff_invite', 'accept_staff_invite', 'revoke_staff_invite',
                           'update_staff_member_role', 'set_staff_member_status')),
  5,
  'all five staff-admin functions exist'
);

select col_is_unique('public', 'staff_invites', array['token_hash'], 'invite tokens are stored only as a unique hash');

-- The one gap this phase closed: never letting an invite/role-change
-- function touch the business_owner's own membership.
select ok(
  (select prosrc like '%business_owner%' from pg_proc where proname = 'set_staff_member_status'),
  'set_staff_member_status guards against disabling the business owner'
);
select ok(
  (select prosrc like '%business_owner%' from pg_proc where proname = 'update_staff_member_role'),
  'update_staff_member_role guards against changing the business owner''s role'
);

select has_column('public', 'staff_invites', 'expires_at', 'staff_invites.expires_at exists');

select * from finish();
rollback;
