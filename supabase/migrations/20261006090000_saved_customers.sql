-- Customers the business adds itself (Customers → Add customer): walk-ins,
-- regulars, people who phone in — not only those who ordered through the Agent.
--
-- Until now the Customers page was derived from orders alone (orders carry
-- the customer's name / email / phone). A saved customer joins that list:
-- their orders are matched to them by email (case-insensitive) or phone
-- (digits only), so a regular's order history shows under their saved
-- profile; a saved customer with no orders yet shows with none.
--
-- Members of a business see and change only that business's customers (RLS).

insert into public.permissions (key, module, description) values
  ('customers.read', 'customers', 'View saved customers'),
  ('customers.write', 'customers', 'Add, edit and delete saved customers')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p
where r.tenant_id is null and r.key in ('business_owner', 'business_admin') and p.key in ('customers.read', 'customers.write')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'customers.read' from public.roles r
where r.tenant_id is null and r.key = 'staff'
on conflict do nothing;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  phone text check (phone is null or length(btrim(phone)) between 1 and 40),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+$')),
  birthday date,
  notes text check (notes is null or length(notes) <= 1000),
  -- How orders are matched to this customer.
  email_key text generated always as (lower(btrim(email))) stored,
  phone_key text generated always as (nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')) stored,
  -- Who added them: always the signed-in member (not writable by the client).
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.customers
  for each row execute function app.set_updated_at();
-- One saved customer per email and per phone number in a business.
create unique index customers_tenant_email_key on public.customers (tenant_id, email_key) where email_key is not null;
create unique index customers_tenant_phone_key on public.customers (tenant_id, phone_key) where phone_key is not null;
create index customers_tenant_created_idx on public.customers (tenant_id, created_at desc);

alter table public.customers enable row level security;
alter table public.customers force row level security;
create policy customers_select on public.customers
  for select using (app.has_permission(tenant_id, 'customers.read'));
create policy customers_insert on public.customers
  for insert with check (app.has_permission(tenant_id, 'customers.write'));
create policy customers_update on public.customers
  for update using (app.has_permission(tenant_id, 'customers.write'))
  with check (app.has_permission(tenant_id, 'customers.write'));
create policy customers_delete on public.customers
  for delete using (app.has_permission(tenant_id, 'customers.write'));
revoke all on public.customers from anon;
-- Members write only the customer's details; the match keys and created_by are set by the database.
revoke insert, update on public.customers from authenticated;
grant insert (tenant_id, name, phone, email, birthday, notes) on public.customers to authenticated;
grant update (name, phone, email, birthday, notes) on public.customers to authenticated;

-- The Customers page: saved customers and customers from orders, one row
-- each. Orders match a saved customer by email or phone; other orders group
-- as before (email, else phone, else name — now case-insensitive).
-- SECURITY INVOKER: the caller's own RLS on orders and customers applies.
create or replace function public.tenant_customer_summary(
  p_tenant_id uuid,
  p_search text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with fx as (
    -- Orders placed in an earlier currency, expressed in today's (see public.order_fx_factor).
    select c.currency, public.order_fx_factor(p_tenant_id, c.currency::text) as f
    from (select distinct currency from public.orders where tenant_id = p_tenant_id) c
  ),
  saved as (
    select s.id, s.name, s.email, s.phone, s.birthday, s.notes, s.email_key, s.phone_key, s.created_at
    from public.customers s
    where s.tenant_id = p_tenant_id
  ),
  o as (
    select
      coalesce(
        'saved:' || m.id::text,
        lower(coalesce(ord.customer_email::text, ord.customer_phone, ord.customer_name, 'unknown'))
      ) as customer_key,
      ord.customer_name,
      ord.customer_email::text as customer_email,
      ord.customer_phone,
      round(ord.total_minor * coalesce(fx.f, 1))::bigint as total_minor,
      ord.created_at
    from public.orders ord
    left join fx on fx.currency = ord.currency
    left join lateral (
      select s.id
      from saved s
      where (s.email_key is not null and s.email_key = lower(btrim(ord.customer_email::text)))
         or (s.phone_key is not null and s.phone_key = nullif(regexp_replace(coalesce(ord.customer_phone, ''), '[^0-9]', '', 'g'), ''))
      -- An email match wins over a phone match.
      order by (s.email_key is not distinct from lower(btrim(ord.customer_email::text))) desc, s.created_at
      limit 1
    ) m on true
    where ord.tenant_id = p_tenant_id
  ),
  g as (
    select
      customer_key,
      (array_agg(coalesce(customer_name, '—') order by created_at desc))[1] as name,
      (array_agg(customer_email order by created_at desc))[1] as email,
      (array_agg(customer_phone order by created_at desc))[1] as phone,
      count(*) as order_count,
      sum(total_minor) as total_spent_minor,
      max(created_at) as last_order_at
    from o
    group by customer_key
  ),
  merged as (
    select
      coalesce(g.customer_key, 'saved:' || s.id::text) as customer_key,
      s.id as customer_id,
      coalesce(s.name, g.name) as name,
      coalesce(s.email, g.email) as email,
      coalesce(s.phone, g.phone) as phone,
      s.birthday,
      s.notes,
      coalesce(g.order_count, 0) as order_count,
      coalesce(g.total_spent_minor, 0) as total_spent_minor,
      g.last_order_at,
      s.created_at as saved_at
    from g
    full join saved s on g.customer_key = 'saved:' || s.id::text
  ),
  f as (
    select * from merged
    where coalesce(p_search, '') = ''
       or strpos(lower(merged.name), lower(p_search)) > 0
       or strpos(lower(coalesce(merged.email, '')), lower(p_search)) > 0
       or strpos(coalesce(merged.phone, ''), p_search) > 0
  )
  select jsonb_build_object(
    'customers', (select count(*) from merged),
    'repeat_customers', (select count(*) from merged where order_count > 1),
    'total_spent_minor', coalesce((select sum(total_spent_minor) from merged), 0),
    'filtered_count', (select count(*) from f),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', r.customer_key,
          'customer_id', r.customer_id,
          'name', r.name,
          'email', r.email,
          'phone', r.phone,
          'birthday', r.birthday,
          'notes', r.notes,
          'order_count', r.order_count,
          'total_spent_minor', r.total_spent_minor,
          'last_order_at', r.last_order_at,
          'saved_at', r.saved_at
        )
        order by r.total_spent_minor desc, r.last_order_at desc nulls last, r.saved_at desc nulls last, r.customer_key
      )
      from (
        select * from f
        order by total_spent_minor desc, last_order_at desc nulls last, saved_at desc nulls last, customer_key
        limit greatest(p_limit, 0) offset greatest(p_offset, 0)
      ) r
    ), '[]'::jsonb)
  );
$$;
