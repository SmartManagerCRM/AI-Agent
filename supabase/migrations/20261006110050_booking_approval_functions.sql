-- Bookings the business confirms itself (see 20261006110000_booking_approval):
-- the Agent's bookings for a "confirm each request" service are created as
-- pending requests, and pending requests hold their places in capacity and
-- free times.

-- Books one service at exact instants. Callers: the Agent (service role) and
-- signed-in members with bookings.write (console). Returns
-- {ok, booking_id, status, starts_at, ends_at} or {ok:false, reason}.
-- A service set to "I confirm each request" takes the Agent's bookings as
-- requests (status pending) — they hold their places until the business
-- confirms or declines them. Console bookings are always confirmed.
create or replace function public.book_service_at(
  p_tenant_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_party_size integer,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_notes text,
  p_source text,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_service public.bookable_services%rowtype;
  v_ends timestamptz := p_ends_at;
  v_party integer := coalesce(p_party_size, 1);
  v_taken integer;
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

  -- Opening hours (the business's own, in its own time zone), when it set any.
  v_tz := app.tenant_time_zone(p_tenant_id);
  select exists (
    select 1 from public.branches b
     where b.tenant_id = p_tenant_id and b.is_default and b.is_active and b.opening_hours <> '{}'::jsonb
  ) into v_has_hours;
  if v_has_hours then
    select exists (
      select 1 from (
        select * from app.opening_windows(p_tenant_id, (p_starts_at at time zone v_tz)::date)
        union all
        -- a window opened the evening before and still running after midnight
        select * from app.opening_windows(p_tenant_id, (p_starts_at at time zone v_tz)::date - 1)
      ) w
      where p_starts_at >= w.opens_at and coalesce(v_ends, p_starts_at) <= w.closes_at
    ) into v_inside;
    if not v_inside then
      return jsonb_build_object('ok', false, 'reason', 'closed');
    end if;
  end if;

  -- Capacity: people already booked over any part of this time.
  select coalesce(sum(b.party_size), 0) into v_taken
    from public.bookings b
   where b.service_id = p_service_id
     and b.status in ('confirmed', 'pending')
     and b.starts_at < app.booking_hold_end(p_starts_at, v_ends, v_service.duration_minutes)
     and app.booking_hold_end(b.starts_at, b.ends_at, v_service.duration_minutes) > p_starts_at;
  if v_taken + v_party > v_service.capacity then
    return jsonb_build_object('ok', false, 'reason', 'full', 'spots_left', greatest(v_service.capacity - v_taken, 0));
  end if;

  v_status := case when p_source <> 'console' and v_service.requires_approval then 'pending' else 'confirmed' end;
  insert into public.bookings (
    tenant_id, service_id, conversation_id, customer_name, customer_phone, customer_email,
    starts_at, ends_at, party_size, notes, source, status
  ) values (
    p_tenant_id, p_service_id, p_conversation_id,
    nullif(left(btrim(coalesce(p_customer_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_customer_phone, '')), 40), ''),
    nullif(left(btrim(coalesce(p_customer_email, '')), 200), ''),
    p_starts_at, v_ends, v_party,
    nullif(left(btrim(coalesce(p_notes, '')), 1000), ''),
    p_source, v_status
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'booking_id', v_id, 'status', v_status, 'starts_at', p_starts_at, 'ends_at', v_ends);
end;
$$;
revoke all on function public.book_service_at(uuid, uuid, timestamptz, timestamptz, integer, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.book_service_at(uuid, uuid, timestamptz, timestamptz, integer, text, text, text, text, text, uuid) to authenticated, service_role;

-- Free start times for one service on one local date (requests awaiting the
-- business's answer hold their places too).
create or replace function public.service_slots(p_tenant_id uuid, p_service_id uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz, local_time text, spots_left integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_service public.bookable_services%rowtype;
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
  v_tz := app.tenant_time_zone(p_tenant_id);
  v_step := make_interval(mins => coalesce(v_service.duration_minutes, 30));
  for w in select * from app.opening_windows(p_tenant_id, p_date) order by 1 loop
    v_cursor := w.opens_at;
    loop
      v_end := case when v_service.duration_minutes is null then null else v_cursor + v_step end;
      exit when coalesce(v_end, v_cursor + interval '1 minute') > w.closes_at;
      if v_cursor > now() then
        select coalesce(sum(b.party_size), 0) into v_taken
          from public.bookings b
         where b.service_id = p_service_id and b.status in ('confirmed', 'pending')
           and b.starts_at < app.booking_hold_end(v_cursor, v_end, v_service.duration_minutes)
           and app.booking_hold_end(b.starts_at, b.ends_at, v_service.duration_minutes) > v_cursor;
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
revoke all on function public.service_slots(uuid, uuid, date) from public, anon;
grant execute on function public.service_slots(uuid, uuid, date) to authenticated, service_role;
