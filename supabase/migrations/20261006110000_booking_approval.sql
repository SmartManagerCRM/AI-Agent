-- Bookings the business confirms itself.
--
-- Bookings → service: "Confirm automatically" (as before) or "I confirm each
-- request" (bookable_services.requires_approval). For the latter, a booking
-- made on the Agent is a request:
--
--   pending ──confirm──► confirmed
--      └─────decline──► declined
--
-- A pending request holds its places (capacity) until it is answered, so a
-- confirmation can never overbook. Requests reach open consoles at once as a
-- `booking_requested` notification (same realtime path as new orders); the
-- owner answers with public.decide_booking. The customer's Agent page waits
-- for the answer.

alter table public.bookable_services add column requires_approval boolean not null default false;

alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'declined', 'completed', 'canceled'));
alter table public.bookings
  add column decided_at timestamptz,
  add column decided_by uuid references auth.users(id) on delete set null,
  -- The language the customer used on the Agent, so messages to them (WhatsApp) are in it.
  add column customer_locale text check (customer_locale is null or customer_locale in ('en', 'ar', 'fr'));
create index bookings_pending_idx on public.bookings (tenant_id, created_at) where status = 'pending';

-- The business answers a booking request: confirm or decline (bookings.write).
-- Only a pending request can be answered; answering twice changes nothing.
create or replace function public.decide_booking(p_tenant_id uuid, p_booking_id uuid, p_decision text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;
revoke all on function public.decide_booking(uuid, uuid, text) from public, anon;
grant execute on function public.decide_booking(uuid, uuid, text) to authenticated;
