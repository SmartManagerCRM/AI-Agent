-- The business's time zone, read safely by the booking functions.
-- tenants.timezone was a free-text field: a value typed as an offset
-- ("UTC+1") is not a zone name, and PostgreSQL reads such POSIX-style
-- strings with the opposite sign (UTC+1 as one hour *behind* UTC). This
-- returns a real zone: a known name as is; "UTC+1" / "GMT+01:00" / "+3" as
-- the matching fixed zone (Etc/GMT-1 = one hour ahead); anything else UTC.
-- The stored value is not changed — the owner picks a proper zone in Settings.
create or replace function app.tenant_time_zone(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
  m text[];
  h integer;
begin
  select btrim(coalesce(t.timezone, '')) into v from public.tenants t where t.id = p_tenant_id;
  if v is null or v = '' then
    return 'UTC';
  end if;
  m := regexp_match(v, '^(?:[Uu][Tt][Cc]|[Gg][Mm][Tt])?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$');
  if m is not null then
    h := m[2]::integer;
    if coalesce(m[3], '00') = '00' and h <= 14 then
      return case when h = 0 then 'UTC' else 'Etc/GMT' || case when m[1] = '+' then '-' else '+' end || h end;
    end if;
    return case m[1] || lpad(h::text, 2, '0') || ':' || m[3]
      when '+03:30' then 'Asia/Tehran' when '+04:30' then 'Asia/Kabul' when '+05:30' then 'Asia/Kolkata'
      when '+05:45' then 'Asia/Kathmandu' when '+06:30' then 'Asia/Yangon' when '+09:30' then 'Australia/Darwin'
      when '-03:30' then 'America/St_Johns' when '-09:30' then 'Pacific/Marquesas' else 'UTC' end;
  end if;
  if exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v) then
    return v;
  end if;
  return 'UTC';
end;
$$;
revoke all on function app.tenant_time_zone(uuid) from public, anon, authenticated;

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
  v_tz := app.tenant_time_zone(p_tenant_id);
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
    opens_at := (p_date + v_open) at time zone v_tz;
    closes_at := (p_date + v_close + case when v_close <= v_open then interval '1 day' else interval '0' end) at time zone v_tz;
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
