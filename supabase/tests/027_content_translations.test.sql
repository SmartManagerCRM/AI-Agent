-- pgTAP: automatic translation — queueing, never overwriting typed text, monthly allowances, access.
begin;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000f1aa1', 'tr-admin@test.local'),
  ('00000000-0000-4000-8000-0000000f1aa2', 'tr-owner@test.local'),
  ('00000000-0000-4000-8000-0000000f1aa3', 'tr-other@test.local');
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000f1aa1');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-0000000f1bb1', 'tr-one', '{"en":"One"}', 'restaurant', 'active', 'USD'),
  ('00000000-0000-4000-8000-0000000f1bb2', 'tr-two', '{"en":"Two"}', 'restaurant', 'active', 'USD');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000f1bb1', '00000000-0000-4000-8000-0000000f1aa2', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000f1bb2', '00000000-0000-4000-8000-0000000f1aa3', id from public.roles where key = 'business_owner' and tenant_id is null;

-- A new product is queued for translation.
insert into public.products (id, tenant_id, name, price_minor, status) values
  ('00000000-0000-4000-8000-0000000f1cc1', '00000000-0000-4000-8000-0000000f1bb1', '{"en":"Iced Latte"}', 1500, 'active'),
  ('00000000-0000-4000-8000-0000000f1cc2', '00000000-0000-4000-8000-0000000f1bb2', '{"en":"Mocha"}', 1500, 'active');
select ok(exists (select 1 from public.translation_queue where table_name = 'products' and row_key = '00000000-0000-4000-8000-0000000f1cc1'
  and tenant_id = '00000000-0000-4000-8000-0000000f1bb1'), 'a new product is queued, with its business');

-- A change that doesn't touch a text doesn't queue it again.
delete from public.translation_queue;
update public.products set price_minor = 1600 where id = '00000000-0000-4000-8000-0000000f1cc1';
select ok(not exists (select 1 from public.translation_queue), 'a price change is not queued');
update public.products set name = '{"en":"Iced Latte XL"}' where id = '00000000-0000-4000-8000-0000000f1cc1';
select ok(exists (select 1 from public.translation_queue where row_key = '00000000-0000-4000-8000-0000000f1cc1'), 'a name change is queued');

-- Claiming and writing a translation (the worker, as the service role; results noted, then checked).
create temp table r (k text primary key, v text);
grant all on r to service_role;
set local role service_role;
insert into r select 'claim1', count(*)::text from public.claim_translation_jobs(10);
insert into r select 'claim2', count(*)::text from public.claim_translation_jobs(10);
insert into r values ('apply1', public.apply_content_translation('products', '00000000-0000-4000-8000-0000000f1cc1', 'name', 'ar', 'آيس لاتيه XL', null, 'en', 'h1', 'glossary')::text);
reset role;
select is((select v from r where k = 'claim1'), '1', 'the worker claims the due row');
select is((select v from r where k = 'claim2'), '0', '… and nobody else gets them meanwhile');
select is((select v from r where k = 'apply1'), 'true', 'an empty language is filled in');
select is((select name ->> 'ar' from public.products where id = '00000000-0000-4000-8000-0000000f1cc1'), 'آيس لاتيه XL', '… into the product');
select ok((select provider = 'glossary' and source_lang = 'en' from public.content_translations where row_key = '00000000-0000-4000-8000-0000000f1cc1' and lang = 'ar'),
  '… and recorded as automatic');
select ok(exists (select 1 from public.translation_queue where row_key = '00000000-0000-4000-8000-0000000f1cc1' and locked_until is not null),
  'writing a translation does not queue the row again');

-- Someone types their own Arabic: the translator can no longer replace it.
update public.products set name = name || '{"ar":"لاتيه مثلج كبير"}' where id = '00000000-0000-4000-8000-0000000f1cc1';
set local role service_role;
insert into r values ('apply2', public.apply_content_translation('products', '00000000-0000-4000-8000-0000000f1cc1', 'name', 'ar', 'آيس لاتيه', 'آيس لاتيه XL', 'en', 'h2', 'azure_free')::text);
reset role;
select is((select v from r where k = 'apply2'), 'false', 'a typed translation is never overwritten');
select is((select name ->> 'ar' from public.products where id = '00000000-0000-4000-8000-0000000f1cc1'), 'لاتيه مثلج كبير', '… it stays as typed');
select throws_ok($$ select public.apply_content_translation('products', 'x', 'price_minor', 'ar', 'x', null, 'en', 'h', 'local') $$,
  'P0001', null, 'only translatable texts can be written');

-- Monthly allowances.
set local role service_role;
insert into r values ('res1', public.reserve_translation_characters('deepl_free', 400000, 500000)::text);
insert into r values ('res2', public.reserve_translation_characters('deepl_free', 200000, 500000)::text);
select public.settle_translation_characters('deepl_free', 0, true);
insert into r values ('res3', public.reserve_translation_characters('deepl_free', 10, 500000)::text);
select public.finish_translation_job('products', '00000000-0000-4000-8000-0000000f1cc1', (select queued_at from public.translation_queue where row_key = '00000000-0000-4000-8000-0000000f1cc1'), null);
reset role;
select is((select v from r where k = 'res1'), 'true', 'characters within the allowance are reserved');
select is((select v from r where k = 'res2'), 'false', '… a request that would go over it is refused');
select is((select v from r where k = 'res3'), 'false', 'a service that said "used up" is skipped for the month');
select ok(not exists (select 1 from public.translation_queue where row_key = '00000000-0000-4000-8000-0000000f1cc1'), 'a finished row leaves the queue');

-- Access: owners see their own business's automatic translations only; nobody but the server runs the worker.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f1aa3","role":"authenticated"}';
select is((select count(*)::int from public.content_translations), 0, 'another business sees none of these translations');
select throws_ok($$ select * from public.claim_translation_jobs(10) $$, '42501', null, 'owners cannot run the worker');
select throws_ok($$ select public.queue_all_translations() $$, '42501', null, 'owners cannot queue everything');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f1aa2","role":"authenticated"}';
select is((select count(*)::int from public.content_translations), 1, 'the owner sees their own');
reset role;

select * from finish();
rollback;
