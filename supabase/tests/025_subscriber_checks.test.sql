-- pgTAP: Super Admin → Subscribers: new subscribers not yet checked.
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000e0aa1', 'chk-admin@test.local'),
  ('00000000-0000-4000-8000-0000000e0aa2', 'chk-owner@test.local');
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000e0aa1');
-- Two businesses sign up after the feature exists: nobody has checked them yet.
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-0000000e0bb1', 'chk-new-a', '{"en":"New A"}', 'restaurant', 'active', 'USD'),
  ('00000000-0000-4000-8000-0000000e0bb2', 'chk-new-b', '{"en":"New B"}', 'restaurant', 'active', 'USD');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000e0bb1', '00000000-0000-4000-8000-0000000e0aa2', id from public.roles where key = 'business_owner' and tenant_id is null;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select ok((select count(*) from public.unchecked_subscribers() where slug like 'chk-new-%') = 2, 'new subscribers are unchecked');
select is(public.mark_subscribers_checked(array['00000000-0000-4000-8000-0000000e0bb1'::uuid]), 1, 'opening one marks it checked');
select is(public.mark_subscribers_checked(array['00000000-0000-4000-8000-0000000e0bb1'::uuid]), 0, '… once');
select is((select array_agg(slug) from public.unchecked_subscribers() where slug like 'chk-new-%'), array['chk-new-b'], 'the other is still unchecked');
select is((select checked_by from public.platform_subscriber_checks where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'),
  '00000000-0000-4000-8000-0000000e0aa1'::uuid, 'who checked it is recorded');

-- A business owner can't see or change the Super Admin's checks.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa2","role":"authenticated"}';
select throws_ok($$ select * from public.unchecked_subscribers() $$, '42501', null, 'owners cannot list unchecked subscribers');
select throws_ok($$ select public.mark_subscribers_checked(null) $$, '42501', null, 'owners cannot mark themselves checked');
select is((select count(*)::int from public.platform_subscriber_checks), 0, 'owners see none of the checks');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select ok(public.mark_subscribers_checked(null) >= 1, '"Mark all as checked" checks the rest');
select ok(not exists (select 1 from public.unchecked_subscribers()), '… and the list is empty');
reset role;

select * from finish();
rollback;
