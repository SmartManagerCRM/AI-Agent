-- Bookings: the customer says how many people.
--
--   • Every booking — on the Agent's form, in chat, or added in the console —
--     asks how many people it is for (required). The business no longer sets
--     a "capacity" on its services: the column stays, now optional (empty = no
--     limit), and every service's is cleared so a party of any size (1–500)
--     can book.
--   • Availability then follows the branch's opening hours (and, for a
--     service that requires it, the business's own confirmation).

alter table public.bookable_services alter column capacity drop not null;
alter table public.bookable_services alter column capacity drop default;
update public.bookable_services set capacity = null where capacity is not null;

CREATE OR REPLACE FUNCTION public.book_service_at(p_tenant_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_party_size integer, p_customer_name text, p_customer_phone text, p_customer_email text, p_notes text, p_source text, p_conversation_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- One booking at a time per service: availability is checked and taken atomically.
  select * into v_service from public.bookable_services s
   where s.id = p_service_id and s.tenant_id = p_tenant_id
   for update;
  if not found or v_service.archived_at is not null or not v_service.is_active then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
  if p_source = 'agent_form' and not v_service.online_booking then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
  -- The customer says how many people; a limit applies only where one is still set.
  if v_party < 1 or v_party > coalesce(v_service.capacity, 500) then
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

  -- A limit on people at the same time (only where one is still set): those already booked at this branch.
  if v_service.capacity is not null then
    v_taken := app.booked_party(p_service_id, p_tenant_id, v_branch, p_starts_at, v_ends, v_service.duration_minutes);
    if v_taken + v_party > v_service.capacity then
      return jsonb_build_object('ok', false, 'reason', 'full', 'spots_left', greatest(v_service.capacity - v_taken, 0));
    end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.service_slots(p_tenant_id uuid, p_service_id uuid, p_date date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone, local_time text, spots_left integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        -- No limit on people at the same time (the customer says how many): every time is free.
        v_taken := case when v_service.capacity is null then 0
                        else app.booked_party(p_service_id, p_tenant_id, v_branch, v_cursor, v_end, v_service.duration_minutes) end;
        if v_service.capacity is null or v_taken < v_service.capacity then
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
$function$;
