-- Multi-branch businesses.
--
--   • Staff work at branches. Owners and admins see the whole business; a
--     member with the Staff role sees only the orders, bookings and alerts of
--     the branches they are assigned to — enforced here, in the database
--     (row rules and every order/booking function), not just on screen.
--     Orders or bookings with no branch belong to the main branch.
--   • Staff can no longer open the Business Brain (and never had Billing or
--     Staff); they can now take and update orders and bookings — of their own
--     branches only. Admins can invite and manage staff.
--   • Each branch says whether it delivers. Customers choose the branch for
--     pickup, delivery and bookings among those open right now; a business with
--     branches never gets a pickup or delivery order without one.
--   • Bookings belong to a branch: its opening hours and its capacity.

-- ── 1. Who works where ────────────────────────────────────────────────────
create table public.tenant_member_branches (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.tenant_members(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, branch_id)
);
create index tenant_member_branches_branch_idx on public.tenant_member_branches (branch_id);
create index tenant_member_branches_tenant_idx on public.tenant_member_branches (tenant_id);

create or replace function app.check_member_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tenant_members m where m.id = new.member_id and m.tenant_id = new.tenant_id)
     or not exists (select 1 from public.branches b where b.id = new.branch_id and b.tenant_id = new.tenant_id) then
    raise exception 'VALIDATION_ERROR: that branch or member belongs to another business' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_member_branch before insert or update on public.tenant_member_branches
  for each row execute function app.check_member_branch();

alter table public.tenant_member_branches enable row level security;
alter table public.tenant_member_branches force row level security;
create policy tenant_member_branches_select on public.tenant_member_branches
  for select using (
    app.has_permission(tenant_id, 'staff.read')
    or exists (select 1 from public.tenant_members m where m.id = member_id and m.user_id = auth.uid())
  );
-- No write policy: set_staff_member_branches() and accepting an invite write it.

-- ── 3. Bookings and branches ──────────────────────────────────────────────
alter table public.bookings add column branch_id uuid references public.branches(id) on delete set null;
create index bookings_branch_idx on public.bookings (branch_id);
create index if not exists orders_tenant_branch_idx on public.orders (tenant_id, branch_id);

alter table public.branches add column offers_delivery boolean not null default true;

-- ── 2. Branch access ──────────────────────────────────────────────────────
-- Is the signed-in member limited to their branches (the Staff role)?
create or replace function app.branch_restricted(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not app.is_super_admin() and exists (
    select 1 from public.tenant_members tm join public.roles r on r.id = tm.role_id
     where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid() and tm.status = 'active' and r.key = 'staff'
  );
$$;

-- May the signed-in user see/handle this branch's work? Everyone but branch
-- staff may; branch staff only for their branches (in a business without
-- branches, everything). No branch = the main branch.
create or replace function app.can_access_branch(p_tenant_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not app.branch_restricted(p_tenant_id)
    or not exists (select 1 from public.branches b where b.tenant_id = p_tenant_id)
    or exists (
    select 1 from public.tenant_member_branches mb
      join public.tenant_members tm on tm.id = mb.member_id
     where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid() and tm.status = 'active'
       and mb.branch_id = coalesce(
         p_branch_id,
         (select b.id from public.branches b where b.tenant_id = p_tenant_id and b.is_default)
       )
  );
$$;

create or replace function app.can_access_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_access_branch(o.tenant_id, o.branch_id) from public.orders o where o.id = p_order_id), false);
$$;

create or replace function app.can_access_cart(p_cart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_access_branch(c.tenant_id, c.branch_id) from public.carts c where c.id = p_cart_id), false);
$$;

create or replace function app.can_access_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_access_branch(b.tenant_id, b.branch_id) from public.bookings b where b.id = p_booking_id), false);
$$;
revoke all on function app.branch_restricted(uuid), app.can_access_branch(uuid, uuid), app.can_access_order(uuid),
  app.can_access_cart(uuid), app.can_access_booking(uuid) from public, anon;
grant execute on function app.branch_restricted(uuid), app.can_access_branch(uuid, uuid), app.can_access_order(uuid),
  app.can_access_cart(uuid), app.can_access_booking(uuid) to authenticated, service_role;

-- The branches the signed-in member works at (null: all of them).
create or replace function public.my_branch_ids(p_tenant_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.branch_restricted(p_tenant_id) then coalesce((
    select array_agg(mb.branch_id order by mb.branch_id) from public.tenant_member_branches mb
      join public.tenant_members tm on tm.id = mb.member_id
     where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid() and tm.status = 'active'
  ), '{}') end;
$$;
revoke all on function public.my_branch_ids(uuid) from public, anon;
grant execute on function public.my_branch_ids(uuid) to authenticated;

-- ── 4. Row rules: branch staff see only their branches ────────────────────
alter policy orders_select on public.orders
  using ((app.has_permission(tenant_id, 'orders.read') and app.can_access_branch(tenant_id, branch_id)) or app.is_super_admin());
alter policy order_items_select on public.order_items
  using ((app.has_permission(tenant_id, 'orders.read') and app.can_access_order(order_id)) or app.is_super_admin());
alter policy order_status_history_select on public.order_status_history
  using ((app.has_permission(tenant_id, 'orders.read') and app.can_access_order(order_id)) or app.is_super_admin());
alter policy order_receipts_select on public.order_receipts
  using ((app.has_permission(tenant_id, 'orders.read') and app.can_access_order(order_id)) or app.is_super_admin());
alter policy payments_select on public.payments
  using ((app.has_permission(tenant_id, 'orders.read') and app.can_access_order(order_id)) or app.is_super_admin());
alter policy carts_select on public.carts
  using ((app.has_permission(tenant_id, 'orders.read') and app.can_access_branch(tenant_id, branch_id)) or app.is_super_admin());
alter policy cart_items_select on public.cart_items
  using ((app.has_permission(tenant_id, 'orders.read') and app.can_access_cart(cart_id)) or app.is_super_admin());
alter policy bookings_select on public.bookings
  using (app.has_permission(tenant_id, 'bookings.read') and app.can_access_branch(tenant_id, branch_id));
alter policy bookings_update on public.bookings
  using (app.has_permission(tenant_id, 'bookings.write') and app.can_access_branch(tenant_id, branch_id))
  with check (app.has_permission(tenant_id, 'bookings.write') and app.can_access_branch(tenant_id, branch_id));
alter policy bookings_delete on public.bookings
  using (app.has_permission(tenant_id, 'bookings.write') and app.can_access_branch(tenant_id, branch_id));
alter policy notification_events_select on public.notification_events
  using (
    (audience = 'tenant' and kind = 'new_order_received' and app.has_permission(tenant_id, 'orders.read') and app.can_access_order(entity_id))
    or (audience = 'tenant' and kind = 'brain_analysis_finished' and app.has_permission(tenant_id, 'brain.read'))
    or (audience = 'tenant' and kind = 'booking_requested' and app.has_permission(tenant_id, 'bookings.read') and app.can_access_booking(entity_id))
    or (audience = 'platform' and app.is_super_admin())
  );

-- ── 5. What each role may do ──────────────────────────────────────────────
-- Staff: no Business Brain; take and update orders and bookings (their branches').
delete from public.role_permissions rp using public.roles r
 where rp.role_id = r.id and r.tenant_id is null and r.key = 'staff' and rp.permission_key = 'brain.read';
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join (values ('orders.write'), ('bookings.write')) p(key)
 where r.tenant_id is null and r.key = 'staff'
on conflict do nothing;
-- Admins invite and manage staff.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'staff.write' from public.roles r where r.tenant_id is null and r.key = 'business_admin'
on conflict do nothing;

-- ── 6. A pickup or delivery order always has a branch when the business has some
create or replace function app.guard_order_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.branch_id is not null then
    if not exists (select 1 from public.branches b where b.id = new.branch_id and b.tenant_id = new.tenant_id) then
      raise exception 'VALIDATION_ERROR: that branch belongs to another business' using errcode = '23514';
    end if;
  elsif new.fulfillment_type in ('pickup', 'delivery')
        and exists (select 1 from public.branches b where b.tenant_id = new.tenant_id and b.is_active) then
    raise exception 'VALIDATION_ERROR: choose the branch for this order' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_order_branch before insert on public.orders
  for each row execute function app.guard_order_branch();

create or replace function app.guard_booking_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.branch_id is not null
     and not exists (select 1 from public.branches b where b.id = new.branch_id and b.tenant_id = new.tenant_id) then
    raise exception 'VALIDATION_ERROR: that branch belongs to another business' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_booking_branch before insert or update of branch_id on public.bookings
  for each row execute function app.guard_booking_branch();

-- ── 7. Opening hours per branch ───────────────────────────────────────────
create or replace function app.branch_opening_windows(p_branch_id uuid, p_date date)
returns table (opens_at timestamptz, closes_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_hours jsonb;
  v_tenant uuid;
  v_key text := (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from p_date)::int];
  w jsonb;
  v_open time;
  v_close time;
begin
  select b.opening_hours, b.tenant_id into v_hours, v_tenant from public.branches b where b.id = p_branch_id and b.is_active;
  if v_hours is null or v_hours = '{}'::jsonb then
    return;
  end if;
  v_tz := app.tenant_time_zone(v_tenant);
  for w in select * from jsonb_array_elements(coalesce(v_hours -> v_key, '[]'::jsonb)) loop
    begin
      v_open := (w ->> 'open')::time;
      v_close := (w ->> 'close')::time;
    exception when others then
      continue;
    end;
    opens_at := (p_date + v_open) at time zone v_tz;
    closes_at := (p_date + v_close + case when v_close <= v_open then interval '1 day' else interval '0' end) at time zone v_tz;
    return next;
  end loop;
end;
$$;
revoke all on function app.branch_opening_windows(uuid, date) from public, anon, authenticated;

-- The business's own (main branch's) hours, as before.
create or replace function app.opening_windows(p_tenant_id uuid, p_date date)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select w.opens_at, w.closes_at
    from public.branches b, app.branch_opening_windows(b.id, p_date) w
   where b.tenant_id = p_tenant_id and b.is_default and b.is_active;
$$;

-- Is the branch open at this moment? Active, and inside today's (or last
-- night's) hours — a branch whose hours aren't set yet counts as open.
create or replace function app.branch_open_at(p_branch_id uuid, p_at timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hours jsonb;
  v_tz text;
  v_tenant uuid;
  v_day date;
begin
  select b.opening_hours, b.tenant_id into v_hours, v_tenant from public.branches b where b.id = p_branch_id and b.is_active;
  if not found then
    return false;
  end if;
  if v_hours is null or v_hours = '{}'::jsonb then
    return true;
  end if;
  v_tz := app.tenant_time_zone(v_tenant);
  v_day := (p_at at time zone v_tz)::date;
  return exists (
    select 1 from (
      select * from app.branch_opening_windows(p_branch_id, v_day)
      union all
      select * from app.branch_opening_windows(p_branch_id, v_day - 1)
    ) w
    where p_at >= w.opens_at and p_at < w.closes_at
  );
end;
$$;
revoke all on function app.branch_open_at(uuid, timestamptz) from public, anon;
grant execute on function app.branch_open_at(uuid, timestamptz) to authenticated, service_role;

-- For the Agent: the branches a customer may choose right now — open, and for
-- delivery, delivering. Main branch first.
create or replace function public.open_branches(p_tenant_id uuid, p_purpose text)
returns table (id uuid, name jsonb, address jsonb, phone text, is_default boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.name, b.address, b.phone, b.is_default
    from public.branches b
   where b.tenant_id = p_tenant_id and b.is_active
     and p_purpose in ('pickup', 'delivery', 'booking')
     and (p_purpose <> 'delivery' or b.offers_delivery)
     and app.branch_open_at(b.id, now())
   order by b.is_default desc, b.created_at;
$$;
revoke all on function public.open_branches(uuid, text) from public, anon, authenticated;
grant execute on function public.open_branches(uuid, text) to service_role;

-- Does the business have branches at all (so the customer must choose one)?
create or replace function public.has_active_branches(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.branches b where b.tenant_id = p_tenant_id and b.is_active);
$$;
revoke all on function public.has_active_branches(uuid) from public, anon, authenticated;
grant execute on function public.has_active_branches(uuid) to service_role;

-- ── 8. Bookings at a branch: its hours, its capacity ──────────────────────
-- The branch a booking is for: the one given (an active branch of the
-- business), else — in the console — the member's only branch or, for
-- owners/admins, the main branch. Null when the business has no branches.
create or replace function app.booking_branch(p_tenant_id uuid, p_branch_id uuid, p_source text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
begin
  if not exists (select 1 from public.branches b where b.tenant_id = p_tenant_id and b.is_active) then
    return null;
  end if;
  if p_branch_id is not null then
    select b.id into v_branch from public.branches b where b.id = p_branch_id and b.tenant_id = p_tenant_id and b.is_active;
    if v_branch is null then
      raise exception 'VALIDATION_ERROR: that branch is not available' using errcode = '23514';
    end if;
    return v_branch;
  end if;
  if p_source <> 'console' then
    -- A business with a single branch: that one. Otherwise the customer chooses.
    select case when count(*) = 1 then (array_agg(b.id))[1] end into v_branch
      from public.branches b where b.tenant_id = p_tenant_id and b.is_active;
    if v_branch is null then
      raise exception 'VALIDATION_ERROR: choose the branch for this booking' using errcode = '23514';
    end if;
    return v_branch;
  end if;
  if app.branch_restricted(p_tenant_id) then
    select case when count(*) = 1 then (array_agg(mb.branch_id))[1] end into v_branch
      from public.tenant_member_branches mb
      join public.tenant_members tm on tm.id = mb.member_id
      join public.branches b on b.id = mb.branch_id and b.is_active
     where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid() and tm.status = 'active';
    if v_branch is null then
      raise exception 'VALIDATION_ERROR: choose the branch for this booking' using errcode = '23514';
    end if;
    return v_branch;
  end if;
  select b.id into v_branch from public.branches b where b.tenant_id = p_tenant_id and b.is_default and b.is_active;
  return v_branch;
end;
$$;
revoke all on function app.booking_branch(uuid, uuid, text) from public, anon, authenticated;

-- Bookings (confirmed or waiting) at the same branch over any part of this time.
create or replace function app.booked_party(p_service_id uuid, p_tenant_id uuid, p_branch_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_duration integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(b.party_size), 0)::integer
    from public.bookings b
   where b.service_id = p_service_id
     and b.status in ('confirmed', 'pending')
     and coalesce(b.branch_id, (select d.id from public.branches d where d.tenant_id = p_tenant_id and d.is_default))
         is not distinct from coalesce(p_branch_id, (select d.id from public.branches d where d.tenant_id = p_tenant_id and d.is_default))
     and b.starts_at < app.booking_hold_end(p_starts_at, p_ends_at, p_duration)
     and app.booking_hold_end(b.starts_at, b.ends_at, p_duration) > p_starts_at;
$$;
revoke all on function app.booked_party(uuid, uuid, uuid, timestamptz, timestamptz, integer) from public, anon, authenticated;

drop function public.book_service_at(uuid, uuid, timestamptz, timestamptz, integer, text, text, text, text, text, uuid);
create function public.book_service_at(
  p_tenant_id uuid, p_service_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_party_size integer,
  p_customer_name text, p_customer_phone text, p_customer_email text, p_notes text, p_source text,
  p_conversation_id uuid default null, p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.bookable_services%rowtype;
  v_ends timestamptz := p_ends_at;
  v_party integer := coalesce(p_party_size, 1);
  v_taken integer;
  v_branch uuid;
  v_hours_branch uuid;
  v_has_hours boolean;
  v_inside boolean;
  v_tz text;
  v_id uuid;
  v_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if not app.has_permission(p_tenant_id, 'bookings.write') then
      raise exception 'PERMISSION_ERROR: bookings.write required' using errcode = '42501';
    end if;
    if p_source <> 'console' then
      raise exception 'PERMISSION_ERROR: console bookings only' using errcode = '42501';
    end if;
  end if;
  if p_source not in ('agent_chat', 'agent_form', 'console') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- The branch: chosen by the customer (the Agent offers the ones open right now); in the console, one of the member's.
  begin
    v_branch := app.booking_branch(p_tenant_id, p_branch_id, p_source);
  exception when sqlstate '23514' then
    return jsonb_build_object('ok', false, 'reason', 'branch');
  end;
  if v_branch is not null then
    if p_source = 'console' and not app.can_access_branch(p_tenant_id, v_branch) then
      raise exception 'PERMISSION_ERROR: you can only add bookings for your own branches' using errcode = '42501';
    end if;
  end if;

  -- One booking at a time per service: capacity is checked and taken atomically.
  select * into v_service from public.bookable_services s
   where s.id = p_service_id and s.tenant_id = p_tenant_id
   for update;
  if not found or v_service.archived_at is not null or not v_service.is_active then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
  if p_source = 'agent_form' and not v_service.online_booking then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
  if v_party < 1 or v_party > v_service.capacity then
    return jsonb_build_object('ok', false, 'reason', 'party_size', 'capacity', v_service.capacity);
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'past');
  end if;
  if p_starts_at > now() + interval '366 days' then
    return jsonb_build_object('ok', false, 'reason', 'too_far');
  end if;

  -- Time out: chosen by the customer only where the service allows it; otherwise the service's duration.
  if not v_service.customer_sets_end and v_service.duration_minutes is not null then
    v_ends := p_starts_at + make_interval(mins => v_service.duration_minutes);
  elsif v_ends is null and v_service.duration_minutes is not null then
    v_ends := p_starts_at + make_interval(mins => v_service.duration_minutes);
  end if;
  if v_ends is not null and (v_ends <= p_starts_at or v_ends > p_starts_at + interval '24 hours') then
    return jsonb_build_object('ok', false, 'reason', 'bad_time_out');
  end if;

  -- Opening hours: the branch's own (else the main branch's), in the business's time zone, when set.
  v_tz := app.tenant_time_zone(p_tenant_id);
  v_hours_branch := coalesce(v_branch, (select b.id from public.branches b where b.tenant_id = p_tenant_id and b.is_default and b.is_active));
  select exists (
    select 1 from public.branches b where b.id = v_hours_branch and b.opening_hours <> '{}'::jsonb
  ) into v_has_hours;
  if v_has_hours then
    select exists (
      select 1 from (
        select * from app.branch_opening_windows(v_hours_branch, (p_starts_at at time zone v_tz)::date)
        union all
        -- a window opened the evening before and still running after midnight
        select * from app.branch_opening_windows(v_hours_branch, (p_starts_at at time zone v_tz)::date - 1)
      ) w
      where p_starts_at >= w.opens_at and coalesce(v_ends, p_starts_at) <= w.closes_at
    ) into v_inside;
    if not v_inside then
      return jsonb_build_object('ok', false, 'reason', 'closed');
    end if;
  end if;

  -- Capacity: people already booked at this branch over any part of this time.
  v_taken := app.booked_party(p_service_id, p_tenant_id, v_branch, p_starts_at, v_ends, v_service.duration_minutes);
  if v_taken + v_party > v_service.capacity then
    return jsonb_build_object('ok', false, 'reason', 'full', 'spots_left', greatest(v_service.capacity - v_taken, 0));
  end if;

  v_status := case when p_source <> 'console' and v_service.requires_approval then 'pending' else 'confirmed' end;
  insert into public.bookings (
    tenant_id, service_id, conversation_id, branch_id, customer_name, customer_phone, customer_email,
    starts_at, ends_at, party_size, notes, source, status
  ) values (
    p_tenant_id, p_service_id, p_conversation_id, v_branch,
    nullif(left(btrim(coalesce(p_customer_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_customer_phone, '')), 40), ''),
    nullif(left(btrim(coalesce(p_customer_email, '')), 200), ''),
    p_starts_at, v_ends, v_party,
    nullif(left(btrim(coalesce(p_notes, '')), 1000), ''),
    p_source, v_status
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'booking_id', v_id, 'status', v_status, 'starts_at', p_starts_at, 'ends_at', v_ends, 'branch_id', v_branch);
end;
$$;
revoke all on function public.book_service_at(uuid, uuid, timestamptz, timestamptz, integer, text, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.book_service_at(uuid, uuid, timestamptz, timestamptz, integer, text, text, text, text, text, uuid, uuid) to authenticated, service_role;

-- The date + time-in form of it (the Agent's form, the console): the branch passes through.
drop function public.book_service(uuid, uuid, date, time, time, integer, integer, text, text, text, text, text, uuid);
create function public.book_service(
  p_tenant_id uuid, p_service_id uuid, p_date date, p_time_in time, p_time_out time, p_duration_minutes integer,
  p_party_size integer, p_customer_name text, p_customer_phone text, p_customer_email text, p_notes text, p_source text,
  p_conversation_id uuid default null, p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_date is null or p_time_in is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_tz := app.tenant_time_zone(p_tenant_id);
  v_start := (p_date + p_time_in) at time zone v_tz;
  if p_time_out is not null then
    v_end := (p_date + p_time_out + case when p_time_out <= p_time_in then interval '1 day' else interval '0' end) at time zone v_tz;
  elsif p_duration_minutes is not null then
    if p_duration_minutes < 1 or p_duration_minutes > 1440 then
      return jsonb_build_object('ok', false, 'reason', 'bad_time_out');
    end if;
    v_end := v_start + make_interval(mins => p_duration_minutes);
  end if;
  return public.book_service_at(p_tenant_id, p_service_id, v_start, v_end, p_party_size, p_customer_name,
    p_customer_phone, p_customer_email, p_notes, p_source, p_conversation_id, p_branch_id);
end;
$$;
revoke all on function public.book_service(uuid, uuid, date, time, time, integer, integer, text, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.book_service(uuid, uuid, date, time, time, integer, integer, text, text, text, text, text, uuid, uuid) to authenticated, service_role;

drop function public.service_slots(uuid, uuid, date);
create function public.service_slots(p_tenant_id uuid, p_service_id uuid, p_date date, p_branch_id uuid default null)
returns table (starts_at timestamptz, ends_at timestamptz, local_time text, spots_left integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_service public.bookable_services%rowtype;
  v_branch uuid;
  v_tz text;
  v_step interval;
  w record;
  v_cursor timestamptz;
  v_end timestamptz;
  v_taken integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not app.has_permission(p_tenant_id, 'bookings.read') then
    raise exception 'PERMISSION_ERROR: bookings.read required' using errcode = '42501';
  end if;
  select * into v_service from public.bookable_services s
   where s.id = p_service_id and s.tenant_id = p_tenant_id and s.is_active and s.archived_at is null;
  if not found then
    return;
  end if;
  -- The branch's hours (else the main branch's).
  select b.id into v_branch from public.branches b
   where b.tenant_id = p_tenant_id and b.is_active and (b.id = p_branch_id or (p_branch_id is null and b.is_default));
  if v_branch is null then
    return;
  end if;
  v_tz := app.tenant_time_zone(p_tenant_id);
  v_step := make_interval(mins => coalesce(v_service.duration_minutes, 30));
  for w in select * from app.branch_opening_windows(v_branch, p_date) order by 1 loop
    v_cursor := w.opens_at;
    loop
      v_end := case when v_service.duration_minutes is null then null else v_cursor + v_step end;
      exit when coalesce(v_end, v_cursor + interval '1 minute') > w.closes_at;
      if v_cursor > now() then
        v_taken := app.booked_party(p_service_id, p_tenant_id, v_branch, v_cursor, v_end, v_service.duration_minutes);
        if v_taken < v_service.capacity then
          starts_at := v_cursor;
          ends_at := v_end;
          local_time := to_char(v_cursor at time zone v_tz, 'HH24:MI');
          spots_left := v_service.capacity - v_taken;
          return next;
        end if;
      end if;
      v_cursor := v_cursor + v_step;
    end loop;
  end loop;
end;
$$;
revoke all on function public.service_slots(uuid, uuid, date, uuid) from public, anon;
grant execute on function public.service_slots(uuid, uuid, date, uuid) to authenticated, service_role;

-- ── 9. Staff invites carry the branches; admins can manage staff ──────────
alter table public.staff_invites add column branch_ids uuid[] not null default '{}';

-- The given branches, checked: active branches of this business, at least one
-- for the Staff role when the business has branches. Empty for admins.
create or replace function app.staff_branches(p_tenant_id uuid, p_role_key text, p_branch_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_role_key <> 'staff' then
    return '{}';
  end if;
  select coalesce(array_agg(distinct b.id), '{}') into v_ids
    from public.branches b where b.tenant_id = p_tenant_id and b.is_active and b.id = any(coalesce(p_branch_ids, '{}'));
  if cardinality(v_ids) <> cardinality(array(select distinct unnest(coalesce(p_branch_ids, '{}')))) then
    raise exception 'VALIDATION_ERROR: a branch is not one of yours';
  end if;
  if cardinality(v_ids) = 0 and exists (select 1 from public.branches b where b.tenant_id = p_tenant_id and b.is_active) then
    raise exception 'VALIDATION_ERROR: choose at least one branch for this staff member';
  end if;
  return v_ids;
end;
$$;
revoke all on function app.staff_branches(uuid, text, uuid[]) from public, anon, authenticated;

drop function public.create_staff_invite(uuid, citext, text);
create function public.create_staff_invite(p_tenant_id uuid, p_email citext, p_role_key text, p_branch_ids uuid[] default '{}')
returns table (invite_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_invite_id uuid;
  v_branches uuid[];
begin
  if not (app.has_permission(p_tenant_id, 'staff.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: staff.write required' using errcode = '42501';
  end if;
  if p_role_key not in ('business_admin', 'staff') then
    raise exception 'VALIDATION_ERROR: cannot invite someone as %', p_role_key;
  end if;
  v_branches := app.staff_branches(p_tenant_id, p_role_key, p_branch_ids);

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.staff_invites (tenant_id, email, role_key, token_hash, invited_by, expires_at, branch_ids)
  values (p_tenant_id, p_email, p_role_key, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), now() + interval '7 days', v_branches)
  returning id into v_invite_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (p_tenant_id, auth.uid(), 'staff.invited', 'staff_invite', v_invite_id);

  return query select v_invite_id, v_token;
end;
$$;
revoke all on function public.create_staff_invite(uuid, citext, text, uuid[]) from public;
grant execute on function public.create_staff_invite(uuid, citext, text, uuid[]) to authenticated;

create or replace function public.accept_staff_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.staff_invites%rowtype;
  v_user_email extensions.citext;
  v_role_id uuid;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_ERROR: sign in required' using errcode = '28000';
  end if;

  select * into v_invite from public.staff_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and status = 'pending' and expires_at > now();
  if not found then
    raise exception 'NOT_FOUND: this invite is invalid or has expired';
  end if;

  select email into v_user_email from auth.users where id = auth.uid();
  if v_user_email is distinct from v_invite.email then
    raise exception 'VALIDATION_ERROR: this invite was sent to a different email address';
  end if;

  select id into v_role_id from public.roles where tenant_id is null and key = v_invite.role_key;
  if v_role_id is null then
    raise exception 'CONFIG_ERROR: system role % is not seeded', v_invite.role_key;
  end if;

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_invite.tenant_id, auth.uid(), v_role_id, 'active')
  on conflict (tenant_id, user_id) do update set role_id = excluded.role_id, status = 'active'
  returning id into v_member_id;

  -- Their branches: the invite's (those still open for business).
  delete from public.tenant_member_branches where member_id = v_member_id;
  insert into public.tenant_member_branches (tenant_id, member_id, branch_id)
  select v_invite.tenant_id, v_member_id, b.id from public.branches b
   where b.tenant_id = v_invite.tenant_id and b.id = any(v_invite.branch_ids)
  on conflict do nothing;

  update public.staff_invites set status = 'accepted', accepted_at = now() where id = v_invite.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_invite.tenant_id, auth.uid(), 'staff.invite_accepted', 'staff_invite', v_invite.id);

  return v_invite.tenant_id;
end;
$$;

-- Set a staff member's branches (owner/admin). Admins and the owner have none: they see everything.
create or replace function public.set_staff_member_branches(p_member_id uuid, p_branch_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.tenant_members%rowtype;
  v_role_key text;
  v_branches uuid[];
begin
  select * into v_member from public.tenant_members where id = p_member_id;
  if not found then
    raise exception 'NOT_FOUND: staff member does not exist';
  end if;
  if not (app.has_permission(v_member.tenant_id, 'staff.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: staff.write required' using errcode = '42501';
  end if;
  select key into v_role_key from public.roles where id = v_member.role_id;
  v_branches := app.staff_branches(v_member.tenant_id, v_role_key, p_branch_ids);

  delete from public.tenant_member_branches where member_id = p_member_id and branch_id <> all(v_branches);
  insert into public.tenant_member_branches (tenant_id, member_id, branch_id)
  select v_member.tenant_id, p_member_id, unnest(v_branches)
  on conflict do nothing;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_member.tenant_id, auth.uid(), 'staff.branches_changed', 'tenant_member', p_member_id, jsonb_build_object('branches', to_jsonb(v_branches)));
end;
$$;
revoke all on function public.set_staff_member_branches(uuid, uuid[]) from public;
grant execute on function public.set_staff_member_branches(uuid, uuid[]) to authenticated;

-- ── 10. Every order and booking function checks the branch too ────────────
create or replace function public.update_order_status(p_order_id uuid, p_new_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.orders%rowtype;
  v_allowed text[];
begin
  select * into v_row from public.orders where id = p_order_id;
  if not found then
    raise exception 'NOT_FOUND: order does not exist';
  end if;
  if not app.has_permission(v_row.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if not app.can_access_branch(v_row.tenant_id, v_row.branch_id) then
    raise exception 'PERMISSION_ERROR: this order belongs to another branch' using errcode = '42501';
  end if;

  v_allowed := case v_row.status
    when 'draft' then array['pending_payment', 'cancelled']
    when 'pending_payment' then array['paid', 'cancelled']
    when 'paid' then array['confirmed', 'refunded']
    when 'confirmed' then array['preparing', 'cancelled']
    when 'preparing' then array['ready', 'cancelled']
    when 'ready' then array['completed', 'cancelled']
    else array[]::text[]
  end;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'VALIDATION_ERROR: % cannot move to % directly', v_row.status, p_new_status;
  end if;

  update public.orders
    set status = p_new_status, completed_at = case when p_new_status = 'completed' then now() else completed_at end
    where id = p_order_id;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, actor, note)
  values (v_row.tenant_id, p_order_id, v_row.status, p_new_status, 'staff', p_note);

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_row.tenant_id, auth.uid(), 'order.status_changed', 'order', p_order_id,
    jsonb_build_object('from', v_row.status, 'to', p_new_status));
end;
$function$;

create or replace function public.update_order_details(p_order_id uuid, p_customer_name text, p_customer_phone text, p_customer_email text, p_delivery_address text, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'NOT_FOUND: order does not exist';
  end if;
  if not app.has_permission(v_order.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if not app.can_access_branch(v_order.tenant_id, v_order.branch_id) then
    raise exception 'PERMISSION_ERROR: this order belongs to another branch' using errcode = '42501';
  end if;
  if length(coalesce(p_customer_name, '')) > 120 or length(coalesce(p_customer_phone, '')) > 40
     or length(coalesce(p_customer_email, '')) > 200 or length(coalesce(p_delivery_address, '')) > 500 or length(coalesce(p_notes, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: a detail is too long';
  end if;
  if v_order.fulfillment_type = 'delivery' and nullif(trim(p_delivery_address), '') is null then
    raise exception 'VALIDATION_ERROR: a delivery order needs a delivery address';
  end if;
  update public.orders
     set customer_name = nullif(trim(p_customer_name), ''),
         customer_phone = nullif(trim(p_customer_phone), ''),
         customer_email = nullif(trim(p_customer_email), ''),
         delivery_address = case
           when nullif(trim(p_delivery_address), '') is null then null
           else coalesce(delivery_address, '{}'::jsonb) || jsonb_build_object('formatted', trim(p_delivery_address))
         end,
         notes = nullif(trim(p_notes), '')
   where id = p_order_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_order.tenant_id, auth.uid(), 'order.details_updated', 'order', p_order_id, '{}'::jsonb);
end;
$function$;

create or replace function public.delete_order(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'NOT_FOUND: order does not exist';
  end if;
  if not app.has_permission(v_order.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if not app.can_access_branch(v_order.tenant_id, v_order.branch_id) then
    raise exception 'PERMISSION_ERROR: this order belongs to another branch' using errcode = '42501';
  end if;
  if exists (select 1 from public.payments p where p.order_id = p_order_id and p.status = 'succeeded') then
    raise exception 'VALIDATION_ERROR: a paid order cannot be deleted';
  end if;
  delete from public.orders where id = p_order_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_order.tenant_id, auth.uid(), 'order.deleted', 'order', p_order_id,
          jsonb_build_object('order_number', v_order.order_number, 'total_minor', v_order.total_minor, 'currency', v_order.currency));
end;
$function$;

create or replace function public.mark_cash_payment_collected(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'NOT_FOUND: payment does not exist';
  end if;
  if not app.has_permission(v_payment.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if not app.can_access_order(v_payment.order_id) then
    raise exception 'PERMISSION_ERROR: this order belongs to another branch' using errcode = '42501';
  end if;
  if v_payment.provider not in ('cash_on_delivery', 'pay_on_table') then
    raise exception 'VALIDATION_ERROR: this payment is not collected in person';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'VALIDATION_ERROR: payment % is already %', p_payment_id, v_payment.status;
  end if;

  update public.payments set status = 'succeeded' where id = p_payment_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_payment.tenant_id, auth.uid(), 'payment.cash_collected', 'payment', p_payment_id);
end;
$function$;

create or replace function public.order_receipt(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_receipt public.order_receipts%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'NOT_FOUND: order does not exist';
  end if;
  if not (app.has_permission(v_order.tenant_id, 'orders.read') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: orders.read required' using errcode = '42501';
  end if;
  if not app.can_access_branch(v_order.tenant_id, v_order.branch_id) then
    raise exception 'PERMISSION_ERROR: this order belongs to another branch' using errcode = '42501';
  end if;
  insert into public.order_receipts (tenant_id, order_id, receipt_number, details)
  values (v_order.tenant_id, v_order.id, 'R-' || lpad(v_order.order_number::text, 6, '0'), app.order_receipt_details(v_order.id))
  on conflict (order_id) do nothing;
  select * into v_receipt from public.order_receipts where order_id = p_order_id;
  return jsonb_build_object(
    'id', v_receipt.id,
    'order_id', v_receipt.order_id,
    'order_status', v_order.status,
    'receipt_number', v_receipt.receipt_number,
    'token', v_receipt.token,
    'issued_at', v_receipt.issued_at,
    'details', v_receipt.details,
    'auto_printed_at', v_receipt.auto_printed_at,
    'print_count', v_receipt.print_count
  );
end;
$function$;

create or replace function public.record_receipt_print(p_order_id uuid, p_auto boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.order_receipts where order_id = p_order_id;
  if v_tenant is null then
    return false;
  end if;
  if not (app.has_permission(v_tenant, 'orders.read') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: orders.read required' using errcode = '42501';
  end if;
  if not app.can_access_order(p_order_id) then
    raise exception 'PERMISSION_ERROR: this order belongs to another branch' using errcode = '42501';
  end if;
  if p_auto then
    update public.order_receipts
       set auto_printed_at = now(), print_count = print_count + 1, last_printed_at = now()
     where order_id = p_order_id and auto_printed_at is null;
  else
    update public.order_receipts
       set print_count = print_count + 1, last_printed_at = now()
     where order_id = p_order_id;
  end if;
  return found;
end;
$function$;

create or replace function public.create_payment_attempt(p_order_id uuid)
 RETURNS TABLE(payment_id uuid, provider text, order_number integer, amount_minor bigint, currency text, reused boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_provider text;
  v_existing public.payments%rowtype;
  v_payment_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'NOT_FOUND: order does not exist';
  end if;
  if auth.uid() is not null and not app.has_permission(v_order.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if auth.uid() is not null and not app.can_access_branch(v_order.tenant_id, v_order.branch_id) then
    raise exception 'PERMISSION_ERROR: this order belongs to another branch' using errcode = '42501';
  end if;

  select c.payment_method into v_provider from public.carts c where c.id = v_order.cart_id;
  if v_provider is null then
    raise exception 'VALIDATION_ERROR: order has no payment method on record';
  end if;

  if v_provider in ('cash_on_delivery', 'pay_on_table') then
    if v_order.status <> 'confirmed' then
      raise exception 'VALIDATION_ERROR: order is not awaiting a cash payment record';
    end if;
  else
    if v_order.status <> 'pending_payment' then
      raise exception 'VALIDATION_ERROR: order is not awaiting payment';
    end if;
  end if;

  select * into v_existing from public.payments
    where order_id = p_order_id and status in ('pending', 'succeeded')
    order by created_at desc limit 1;
  if found then
    return query select v_existing.id, v_existing.provider, v_order.order_number, v_existing.amount_minor, v_existing.currency::text, true;
    return;
  end if;

  insert into public.payments (tenant_id, order_id, provider, amount_minor, currency, status)
  values (v_order.tenant_id, p_order_id, v_provider, v_order.total_minor, v_order.currency, 'pending')
  returning id into v_payment_id;

  return query select v_payment_id, v_provider, v_order.order_number, v_order.total_minor, v_order.currency::text, false;
end;
$function$;

create or replace function public.create_order_from_cart(p_cart_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cart public.carts%rowtype;
  v_settings jsonb;
  v_order_id uuid;
  v_order_number int;
  v_subtotal bigint := 0;
  v_delivery_fee bigint := 0;
  v_tax bigint := 0;
  v_tax_rate_bps int;
  v_tax_included boolean;
  v_currency char(3);
  v_item record;
  v_initial_status text;
  v_coupon_id uuid;
  v_discount bigint := 0;
  v_coupon_valid boolean;
  v_coupon_message text;
begin
  select * into v_cart from public.carts where id = p_cart_id;
  if not found then
    raise exception 'NOT_FOUND: cart does not exist';
  end if;
  if auth.uid() is not null and not app.has_permission(v_cart.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if auth.uid() is not null and not app.can_access_branch(v_cart.tenant_id, v_cart.branch_id) then
    raise exception 'PERMISSION_ERROR: this order belongs to another branch' using errcode = '42501';
  end if;
  if v_cart.status <> 'active' then
    raise exception 'VALIDATION_ERROR: this cart is no longer active';
  end if;
  if v_cart.fulfillment_type is null then
    raise exception 'VALIDATION_ERROR: choose pickup, delivery, or dine-in before placing the order';
  end if;
  if v_cart.payment_method is null then
    raise exception 'VALIDATION_ERROR: choose a payment method before placing the order';
  end if;
  if not exists (
    select 1 from public.tenant_payment_config
    where tenant_id = v_cart.tenant_id and v_cart.payment_method = any(enabled_methods)
  ) then
    raise exception 'VALIDATION_ERROR: % is not an available payment method for this business', v_cart.payment_method;
  end if;
  if not exists (select 1 from public.cart_items where cart_id = p_cart_id) then
    raise exception 'VALIDATION_ERROR: the cart is empty';
  end if;

  select ts.checkout, t.currency into strict v_settings, v_currency
  from public.tenant_settings ts join public.tenants t on t.id = ts.tenant_id
  where ts.tenant_id = v_cart.tenant_id;

  -- Live prices, re-read now — never trusted from anywhere the cart came from.
  for v_item in
    select ci.product_id, ci.quantity, p.price_minor
    from public.cart_items ci
    join public.products p on p.id = ci.product_id and p.tenant_id = v_cart.tenant_id
    where ci.cart_id = p_cart_id
  loop
    v_subtotal := v_subtotal + (v_item.price_minor * v_item.quantity);
  end loop;

  if v_cart.coupon_code is not null then
    select valid, message, coupon_id, discount_minor
      into v_coupon_valid, v_coupon_message, v_coupon_id, v_discount
      from public.validate_coupon(v_cart.tenant_id, v_cart.coupon_code, v_subtotal);
    if not v_coupon_valid then
      raise exception 'VALIDATION_ERROR: %', v_coupon_message;
    end if;
  end if;

  if v_cart.fulfillment_type = 'delivery' then
    v_delivery_fee := coalesce((v_settings ->> 'delivery_fee_minor')::bigint, 0);
  end if;

  v_tax_rate_bps := coalesce((v_settings ->> 'tax_rate_bps')::int, 0);
  v_tax_included := coalesce((v_settings ->> 'tax_included')::boolean, false);
  if v_tax_rate_bps > 0 and not v_tax_included then
    v_tax := (((v_subtotal - v_discount) + v_delivery_fee) * v_tax_rate_bps) / 10000;
  end if;

  update public.tenant_counters set next_order_number = next_order_number + 1
    where tenant_id = v_cart.tenant_id
    returning next_order_number - 1 into v_order_number;
  if v_order_number is null then
    insert into public.tenant_counters (tenant_id, next_order_number) values (v_cart.tenant_id, 1001)
      on conflict (tenant_id) do nothing;
    v_order_number := 1000;
  end if;

  -- Cash on Delivery / Pay on Table: no online payment step at all — the
  -- order is confirmed immediately and goes straight to the admin panel;
  -- the customer pays in person later (spec: current request).
  v_initial_status := case
    when v_cart.payment_method in ('cash_on_delivery', 'pay_on_table') then 'confirmed'
    else 'pending_payment'
  end;

  insert into public.orders (
    tenant_id, order_number, conversation_id, cart_id, status, fulfillment_type, branch_id, table_id,
    customer_name, customer_phone, customer_email, delivery_address, notes,
    currency, subtotal_minor, delivery_fee_minor, tax_minor, total_minor, coupon_id, discount_minor
  ) values (
    v_cart.tenant_id, v_order_number, v_cart.conversation_id, v_cart.id, v_initial_status, v_cart.fulfillment_type,
    v_cart.branch_id, v_cart.table_id, v_cart.customer_name, v_cart.customer_phone, v_cart.customer_email, v_cart.delivery_address,
    v_cart.notes, v_currency, v_subtotal, v_delivery_fee, v_tax, (v_subtotal - v_discount) + v_delivery_fee + v_tax,
    v_coupon_id, v_discount
  )
  returning id into v_order_id;

  insert into public.order_items (tenant_id, order_id, product_id, product_name, unit_price_minor, quantity, total_minor)
  select v_cart.tenant_id, v_order_id, p.id, p.name, p.price_minor, ci.quantity, p.price_minor * ci.quantity
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = p_cart_id;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, actor, note)
  values (
    v_cart.tenant_id, v_order_id, null, v_initial_status,
    case when auth.uid() is null then 'customer' else 'staff' end,
    case when v_initial_status = 'confirmed' then 'pay via ' || v_cart.payment_method else null end
  );

  if v_coupon_id is not null then
    update public.coupons set times_used = times_used + 1 where id = v_coupon_id;
  end if;

  update public.carts set status = 'converted' where id = p_cart_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_cart.tenant_id, auth.uid(), 'order.created', 'order', v_order_id);

  return v_order_id;
end;
$function$;

create or replace function public.decide_booking(p_tenant_id uuid, p_booking_id uuid, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status text;
begin
  if not app.has_permission(p_tenant_id, 'bookings.write') then
    raise exception 'PERMISSION_ERROR: bookings.write required' using errcode = '42501';
  end if;
  if p_decision not in ('confirm', 'decline') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select b.status into v_status from public.bookings b
   where b.id = p_booking_id and b.tenant_id = p_tenant_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not app.can_access_branch(p_tenant_id, (select b.branch_id from public.bookings b where b.id = p_booking_id)) then
    raise exception 'PERMISSION_ERROR: this booking belongs to another branch' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_answered', 'status', v_status);
  end if;
  update public.bookings
     set status = case p_decision when 'confirm' then 'confirmed' else 'declined' end,
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_booking_id
  returning status into v_status;
  return jsonb_build_object('ok', true, 'status', v_status);
end;
$function$;

create or replace function public.create_manual_orders(p_tenant_id uuid, p_orders jsonb, p_created_via text DEFAULT 'manual'::text)
 RETURNS TABLE(order_id uuid, order_number integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_needs_price boolean;
  v_settings jsonb;
  v_currency char(3);
  v_rate int;
  v_included boolean;
  v_order jsonb;
  v_item jsonb;
  v_idx int := 0;
  v_count int;
  v_label text;
  v_fulfillment text;
  v_name text;
  v_phone text;
  v_notes text;
  v_address text;
  v_paid boolean;
  v_qty int;
  v_price bigint;
  v_status text;
  v_subtotal bigint;
  v_delivery bigint;
  v_tax bigint;
  v_total bigint;
  v_number int;
  v_id uuid;
  v_branch uuid;
  v_has_branches boolean;
begin
  if not app.has_permission(p_tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if p_created_via not in ('manual', 'bulk_import') then
    raise exception 'VALIDATION_ERROR: invalid order source';
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'VALIDATION_ERROR: there are no orders to add';
  end if;
  v_count := jsonb_array_length(p_orders);
  if v_count > 200 then
    raise exception 'VALIDATION_ERROR: add at most 200 orders at a time';
  end if;

  select ts.checkout, t.currency into v_settings, v_currency
  from public.tenant_settings ts join public.tenants t on t.id = ts.tenant_id
  where ts.tenant_id = p_tenant_id;
  if not found then
    raise exception 'NOT_FOUND: business does not exist';
  end if;
  v_has_branches := exists (select 1 from public.branches b where b.tenant_id = p_tenant_id and b.is_active);
  v_rate := coalesce((v_settings ->> 'tax_rate_bps')::int, 0);
  v_included := coalesce((v_settings ->> 'tax_included')::boolean, false);

  for v_order in select value from jsonb_array_elements(p_orders) loop
    v_idx := v_idx + 1;
    v_label := case when v_count > 1 then 'order ' || coalesce(nullif(btrim(v_order ->> 'ref'), ''), v_idx::text) || ': ' else '' end;

    v_fulfillment := coalesce(nullif(btrim(v_order ->> 'fulfillment_type'), ''), 'pickup');
    if v_fulfillment not in ('pickup', 'delivery', 'dine_in') then
      raise exception 'VALIDATION_ERROR: %fulfillment must be pickup, delivery or dine-in', v_label;
    end if;
    v_name := nullif(btrim(v_order ->> 'customer_name'), '');
    v_phone := nullif(btrim(v_order ->> 'customer_phone'), '');
    v_notes := nullif(btrim(v_order ->> 'notes'), '');
    v_address := nullif(btrim(v_order ->> 'delivery_address'), '');
    if length(v_name) > 120 or length(v_phone) > 40 or length(v_notes) > 1000 or length(v_address) > 500 then
      raise exception 'VALIDATION_ERROR: %a customer detail is too long', v_label;
    end if;
    if v_fulfillment = 'delivery' and v_address is null then
      raise exception 'VALIDATION_ERROR: %a delivery order needs a delivery address', v_label;
    end if;
    v_paid := coalesce(v_order ->> 'paid', 'false') in ('true', 't', '1', 'yes');

    -- The branch the order is for: the one given, else the member's only branch, else the main branch.
    v_branch := null;
    if v_has_branches then
      if coalesce(v_order ->> 'branch_id', '') ~ '^[0-9a-fA-F-]{36}$' then
        select b.id into v_branch from public.branches b
         where b.id = (v_order ->> 'branch_id')::uuid and b.tenant_id = p_tenant_id and b.is_active;
        if v_branch is null then
          raise exception 'VALIDATION_ERROR: %that branch is not one of yours', v_label;
        end if;
      elsif app.branch_restricted(p_tenant_id) then
        select case when count(*) = 1 then (array_agg(mb.branch_id))[1] end into v_branch
          from public.tenant_member_branches mb
          join public.tenant_members tm on tm.id = mb.member_id
          join public.branches b on b.id = mb.branch_id and b.is_active
         where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid() and tm.status = 'active';
        if v_branch is null then
          raise exception 'VALIDATION_ERROR: %choose the branch for this order', v_label;
        end if;
      else
        select b.id into v_branch from public.branches b where b.tenant_id = p_tenant_id and b.is_default and b.is_active;
      end if;
      if not app.can_access_branch(p_tenant_id, v_branch) then
        raise exception 'PERMISSION_ERROR: %you can only add orders for your own branches', v_label using errcode = '42501';
      end if;
    end if;

    if jsonb_typeof(v_order -> 'items') is distinct from 'array' or jsonb_array_length(v_order -> 'items') = 0 then
      raise exception 'VALIDATION_ERROR: %add at least one product', v_label;
    end if;
    if jsonb_array_length(v_order -> 'items') > 100 then
      raise exception 'VALIDATION_ERROR: %an order can have at most 100 lines', v_label;
    end if;

    -- Live prices from the catalog — never from the caller.
    v_subtotal := 0;
    for v_item in select value from jsonb_array_elements(v_order -> 'items') loop
      if coalesce(v_item ->> 'product_id', '') !~ '^[0-9a-fA-F-]{36}$' then
        raise exception 'VALIDATION_ERROR: %a product is not in your catalog', v_label;
      end if;
      if coalesce(v_item ->> 'quantity', '') !~ '^\d{1,3}$' or (v_item ->> 'quantity')::int < 1 then
        raise exception 'VALIDATION_ERROR: %quantities must be whole numbers from 1 to 999', v_label;
      end if;
      v_qty := (v_item ->> 'quantity')::int;
      select p.price_minor, p.status, p.source_price is not null into v_price, v_status, v_needs_price
      from public.products p where p.id = (v_item ->> 'product_id')::uuid and p.tenant_id = p_tenant_id;
      if not found or v_status = 'archived' then
        raise exception 'VALIDATION_ERROR: %a product is not in your catalog', v_label;
      end if;
      if v_needs_price then
        raise exception 'VALIDATION_ERROR: %a product still needs its price', v_label;
      end if;
      v_subtotal := v_subtotal + v_price * v_qty;
    end loop;

    v_delivery := case when v_fulfillment = 'delivery' then coalesce((v_settings ->> 'delivery_fee_minor')::bigint, 0) else 0 end;
    v_tax := case when v_rate > 0 and not v_included then ((v_subtotal + v_delivery) * v_rate) / 10000 else 0 end;
    v_total := v_subtotal + v_delivery + v_tax;

    update public.tenant_counters set next_order_number = next_order_number + 1
      where tenant_id = p_tenant_id
      returning next_order_number - 1 into v_number;
    if v_number is null then
      insert into public.tenant_counters (tenant_id, next_order_number) values (p_tenant_id, 1001)
        on conflict (tenant_id) do nothing;
      v_number := 1000;
    end if;

    insert into public.orders (
      tenant_id, order_number, status, fulfillment_type, branch_id, customer_name, customer_phone, delivery_address, notes,
      currency, subtotal_minor, delivery_fee_minor, tax_minor, total_minor, created_via
    ) values (
      p_tenant_id, v_number, 'confirmed', v_fulfillment, v_branch, v_name, v_phone,
      case when v_address is not null then jsonb_build_object('formatted', v_address) end, v_notes,
      v_currency, v_subtotal, v_delivery, v_tax, v_total, p_created_via
    )
    returning id into v_id;

    insert into public.order_items (tenant_id, order_id, product_id, product_name, unit_price_minor, quantity, total_minor)
    select p_tenant_id, v_id, p.id, p.name, p.price_minor, (x.value ->> 'quantity')::int, p.price_minor * (x.value ->> 'quantity')::int
    from jsonb_array_elements(v_order -> 'items') x
    join public.products p on p.id = (x.value ->> 'product_id')::uuid and p.tenant_id = p_tenant_id;

    insert into public.order_status_history (tenant_id, order_id, from_status, to_status, actor, note)
    values (p_tenant_id, v_id, null, 'confirmed', 'staff',
      case p_created_via when 'manual' then 'added manually' else 'added by bulk import' end);

    insert into public.payments (tenant_id, order_id, provider, amount_minor, currency, status)
    values (p_tenant_id, v_id, 'cash_on_delivery', v_total, v_currency, case when v_paid then 'succeeded' else 'pending' end);

    insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
    values (p_tenant_id, auth.uid(), 'order.created_manually', 'order', v_id);

    order_id := v_id;
    order_number := v_number;
    return next;
  end loop;
end;
$function$;

