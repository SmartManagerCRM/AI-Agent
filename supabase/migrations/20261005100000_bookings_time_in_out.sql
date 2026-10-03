-- Bookings: time in / time out, optional duration, capacity, and online
-- booking from the customer Agent's own booking form (no AI involved).
--
--   bookable_services
--     duration_minutes   now optional (a service may have no fixed length)
--     customer_sets_end  the customer may choose their time out (or a
--                        duration) — e.g. hourly rentals, open sessions
--     capacity           how many people may be booked at the same time
--                        (1 = one booking at a time, as before)
--     online_booking     ticked: customers can book it on the Agent's
--                        landing page; unticked: console bookings only
--     description        shown to the customer before booking
--     price_unit         the price is per booking, per hour or per person
--   bookings
--     ends_at            now optional (time out unknown / open-ended)
--     party_size         people in this booking (counts against capacity)
--     source             agent_chat | agent_form | console
--
-- Every booking goes through public.book_service / book_service_at, which
-- validates against the business's real opening hours in its own time
-- zone and against capacity, under a per-service lock — so two customers
-- can never both get the last place.

alter table public.bookable_services alter column duration_minutes drop not null;
alter table public.bookable_services drop constraint if exists bookable_services_duration_minutes_check;
alter table public.bookable_services add constraint bookable_services_duration_minutes_check
  check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 1440));
alter table public.bookable_services
  add column customer_sets_end boolean not null default false,
  add column capacity integer not null default 1 check (capacity between 1 and 500),
  add column online_booking boolean not null default true,
  add column description jsonb not null default '{}'::jsonb,
  add column price_unit text not null default 'booking' check (price_unit in ('booking', 'hour', 'person'));

alter table public.bookings alter column ends_at drop not null;
alter table public.bookings drop constraint if exists bookings_check;
alter table public.bookings add constraint bookings_ends_after_start check (ends_at is null or ends_at > starts_at);
alter table public.bookings
  add column party_size integer not null default 1 check (party_size between 1 and 500),
  add column source text not null default 'agent_chat' check (source in ('agent_chat', 'agent_form', 'console'));

-- How long a booking with no time out holds its place, for capacity only:
-- the service's own duration, else one hour.
create or replace function app.booking_hold_end(p_starts_at timestamptz, p_ends_at timestamptz, p_duration integer)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_ends_at, p_starts_at + make_interval(mins => coalesce(p_duration, 60)));
$$;

-- The business's opening windows for one local date, as instants. Windows
-- that close after midnight ("18:00"–"02:00") end the next day. No hours
-- set at all → null (the business didn't say; nothing is refused for it).
create or replace function app.opening_windows(p_tenant_id uuid, p_date date)
returns table (opens_at timestamptz, closes_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_hours jsonb;
  v_key text := (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from p_date)::int];
  w jsonb;
  v_open time;
  v_close time;
begin
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  select b.opening_hours into v_hours from public.branches b
   where b.tenant_id = p_tenant_id and b.is_default and b.is_active limit 1;
  if v_hours is null or v_hours = '{}'::jsonb then
    return;
  end if;
  for w in select * from jsonb_array_elements(coalesce(v_hours -> v_key, '[]'::jsonb)) loop
    begin
      v_open := (w ->> 'open')::time;
      v_close := (w ->> 'close')::time;
    exception when others then
      continue;
    end;
    opens_at := (p_date + v_open) at time zone coalesce(v_tz, 'UTC');
    closes_at := (p_date + v_close + case when v_close <= v_open then interval '1 day' else interval '0' end) at time zone coalesce(v_tz, 'UTC');
    return next;
  end loop;
end;
$$;

-- Books one service at exact instants. Callers: the Agent (service role) and
-- signed-in members with bookings.write (console). Returns
-- {ok, booking_id, starts_at, ends_at} or {ok:false, reason}.
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
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  select exists (
    select 1 from public.branches b
     where b.tenant_id = p_tenant_id and b.is_default and b.is_active and b.opening_hours <> '{}'::jsonb
  ) into v_has_hours;
  if v_has_hours then
    select exists (
      select 1 from (
        select * from app.opening_windows(p_tenant_id, (p_starts_at at time zone coalesce(v_tz, 'UTC'))::date)
        union all
        -- a window opened the evening before and still running after midnight
        select * from app.opening_windows(p_tenant_id, (p_starts_at at time zone coalesce(v_tz, 'UTC'))::date - 1)
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
     and b.status = 'confirmed'
     and b.starts_at < app.booking_hold_end(p_starts_at, v_ends, v_service.duration_minutes)
     and app.booking_hold_end(b.starts_at, b.ends_at, v_service.duration_minutes) > p_starts_at;
  if v_taken + v_party > v_service.capacity then
    return jsonb_build_object('ok', false, 'reason', 'full', 'spots_left', greatest(v_service.capacity - v_taken, 0));
  end if;

  insert into public.bookings (
    tenant_id, service_id, conversation_id, customer_name, customer_phone, customer_email,
    starts_at, ends_at, party_size, notes, source
  ) values (
    p_tenant_id, p_service_id, p_conversation_id,
    nullif(left(btrim(coalesce(p_customer_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_customer_phone, '')), 40), ''),
    nullif(left(btrim(coalesce(p_customer_email, '')), 200), ''),
    p_starts_at, v_ends, v_party,
    nullif(left(btrim(coalesce(p_notes, '')), 1000), ''),
    p_source
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'booking_id', v_id, 'starts_at', p_starts_at, 'ends_at', v_ends);
end;
$$;
revoke all on function public.book_service_at(uuid, uuid, timestamptz, timestamptz, integer, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.book_service_at(uuid, uuid, timestamptz, timestamptz, integer, text, text, text, text, text, uuid) to authenticated, service_role;

-- The same, from the business's local date and clock times (what a customer
-- or the owner types). A time out earlier than the time in is the next day.
-- A duration (minutes) may be given instead of a time out.
create or replace function public.book_service(
  p_tenant_id uuid,
  p_service_id uuid,
  p_date date,
  p_time_in time,
  p_time_out time,
  p_duration_minutes integer,
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
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_date is null or p_time_in is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select coalesce(t.timezone, 'UTC') into v_tz from public.tenants t where t.id = p_tenant_id;
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
    p_customer_phone, p_customer_email, p_notes, p_source, p_conversation_id);
end;
$$;
revoke all on function public.book_service(uuid, uuid, date, time, time, integer, integer, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.book_service(uuid, uuid, date, time, time, integer, integer, text, text, text, text, text, uuid) to authenticated, service_role;

-- Free start times for one service on one local date: steps of the service's
-- duration (else 30 minutes) inside the opening windows, with the places
-- still free at each. Computed live from real bookings — never invented.
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
  select coalesce(t.timezone, 'UTC') into v_tz from public.tenants t where t.id = p_tenant_id;
  v_step := make_interval(mins => coalesce(v_service.duration_minutes, 30));
  for w in select * from app.opening_windows(p_tenant_id, p_date) order by 1 loop
    v_cursor := w.opens_at;
    loop
      v_end := case when v_service.duration_minutes is null then null else v_cursor + v_step end;
      exit when coalesce(v_end, v_cursor + interval '1 minute') > w.closes_at;
      if v_cursor > now() then
        select coalesce(sum(b.party_size), 0) into v_taken
          from public.bookings b
         where b.service_id = p_service_id and b.status = 'confirmed'
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

revoke all on function app.opening_windows(uuid, date) from public, anon, authenticated;
