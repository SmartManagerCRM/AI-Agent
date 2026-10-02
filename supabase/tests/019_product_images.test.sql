-- pgTAP: product photos — columns, own-folder rule, and that only the business's own staff can point a product at a photo.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e0a1', 'img-owner@test.local'),
  ('00000000-0000-4000-8000-00000000e0a2', 'img-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-00000000e0b1', 'img-a', '{"en":"Img A"}', 'restaurant', 'active', 'SAR'),
  ('00000000-0000-4000-8000-00000000e0b2', 'img-b', '{"en":"Img B"}', 'restaurant', 'active', 'SAR');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0a1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000e0b2', '00000000-0000-4000-8000-00000000e0a2', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.products (id, tenant_id, name, price_minor, status) values
  ('00000000-0000-4000-8000-00000000e0d1', '00000000-0000-4000-8000-00000000e0b1', '{"en":"Latte"}', 1800, 'active');
set constraints all immediate;

select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'image_path'), 'text', 'products.image_path');
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'image_source_url'), 'text', 'products.image_source_url');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e0a1","role":"authenticated"}';
update public.products set image_path = '00000000-0000-4000-8000-00000000e0b1/00000000-0000-4000-8000-00000000e0d1-abc.webp'
  where id = '00000000-0000-4000-8000-00000000e0d1';
select is((select image_path from public.products where id = '00000000-0000-4000-8000-00000000e0d1'),
  '00000000-0000-4000-8000-00000000e0b1/00000000-0000-4000-8000-00000000e0d1-abc.webp', 'the owner can set the photo of their product');
select throws_ok($$ update public.products set image_path = '00000000-0000-4000-8000-00000000e0b2/x.webp' where id = '00000000-0000-4000-8000-00000000e0d1' $$,
  '23514', null, 'a photo path outside the business''s own folder is refused');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e0a2","role":"authenticated"}';
update public.products set image_path = null where id = '00000000-0000-4000-8000-00000000e0d1';
reset role;
select ok(exists(select 1 from public.products where id = '00000000-0000-4000-8000-00000000e0d1' and image_path is not null),
  'another business cannot remove or change the photo');

set local role anon;
update public.products set image_path = null where id = '00000000-0000-4000-8000-00000000e0d1';
reset role;
select ok(exists(select 1 from public.products where id = '00000000-0000-4000-8000-00000000e0d1' and image_path is not null),
  'anonymous visitors cannot change it either');

select * from finish();
rollback;
