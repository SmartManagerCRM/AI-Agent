-- Super Admin → Subscribers: which new subscribers a Super Admin has not
-- checked yet (the number on "Subscribers" in the sidebar).
--
-- Kept in its own table, readable and writable by Super Admins only — not a
-- column on tenants, which a business's own members may update. A
-- subscriber counts as checked once a Super Admin opens its page (or uses
-- "Mark all as checked"). Subscribers that already exist are recorded as
-- checked, so only new signups are counted from now on.

create table public.platform_subscriber_checks (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  checked_at timestamptz not null default now(),
  checked_by uuid references auth.users(id) on delete set null
);
alter table public.platform_subscriber_checks enable row level security;
alter table public.platform_subscriber_checks force row level security;
create policy platform_subscriber_checks_select on public.platform_subscriber_checks
  for select using (app.is_super_admin());
revoke all on public.platform_subscriber_checks from anon, authenticated;
grant select on public.platform_subscriber_checks to authenticated;

insert into public.platform_subscriber_checks (tenant_id, checked_at)
select id, now() from public.tenants
on conflict (tenant_id) do nothing;

-- New subscribers not yet checked, newest first (Super Admin only).
create or replace function public.unchecked_subscribers()
returns table (tenant_id uuid, slug text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: super admin only' using errcode = '42501';
  end if;
  return query
    select t.id, t.slug::text, t.created_at
      from public.tenants t
     where not exists (select 1 from public.platform_subscriber_checks c where c.tenant_id = t.id)
     order by t.created_at desc;
end;
$$;
revoke all on function public.unchecked_subscribers() from public, anon;
grant execute on function public.unchecked_subscribers() to authenticated;

-- Marks subscribers as checked: the given ones, or every one when null. Returns how many were newly checked.
create or replace function public.mark_subscribers_checked(p_tenant_ids uuid[] default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: super admin only' using errcode = '42501';
  end if;
  insert into public.platform_subscriber_checks (tenant_id, checked_by)
  select t.id, auth.uid() from public.tenants t
   where p_tenant_ids is null or t.id = any(p_tenant_ids)
  on conflict (tenant_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_subscribers_checked(uuid[]) from public, anon;
grant execute on function public.mark_subscribers_checked(uuid[]) to authenticated;

-- The sidebar counts on Orders and Bookings filter on status; keep them index-backed.
create index if not exists orders_tenant_open_idx on public.orders (tenant_id) where status in ('paid', 'confirmed', 'preparing', 'ready');
create index if not exists bookings_tenant_open_idx on public.bookings (tenant_id) where status in ('pending', 'confirmed');
