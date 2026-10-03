-- Booking requests reach open consoles at once: a `booking_requested`
-- notification (same realtime path as new orders) for each Agent booking
-- that waits for the business's answer (see 20261006110000_booking_approval).
-- Members with bookings.read receive it.

alter table public.notification_events drop constraint notification_events_kind_check;
alter table public.notification_events drop constraint notification_events_kind_audience_check;
alter table public.notification_events add constraint notification_events_kind_check
  check (kind in ('new_order_received', 'brain_analysis_finished', 'booking_requested', 'new_subscriber', 'subscription_upgraded'));
alter table public.notification_events add constraint notification_events_kind_audience_check
  check ((kind in ('new_order_received', 'brain_analysis_finished', 'booking_requested')) = (audience = 'tenant'));

drop policy notification_events_select on public.notification_events;
create policy notification_events_select on public.notification_events
  for select to authenticated
  using (
    (audience = 'tenant' and kind = 'new_order_received' and app.has_permission(tenant_id, 'orders.read'))
    or (audience = 'tenant' and kind = 'brain_analysis_finished' and app.has_permission(tenant_id, 'brain.read'))
    or (audience = 'tenant' and kind = 'booking_requested' and app.has_permission(tenant_id, 'bookings.read'))
    or (audience = 'platform' and app.is_super_admin())
  );

create or replace function app.notify_booking_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tz text;
  v_service jsonb;
begin
  begin
    if new.status <> 'pending' then
      return null;
    end if;
    v_tz := app.tenant_time_zone(new.tenant_id);
    select s.name into v_service from public.bookable_services s where s.id = new.service_id;
    perform app.record_notification_event(
      'booking_requested', 'tenant', new.tenant_id, new.id, 'booking_requested:' || new.id,
      jsonb_build_object(
        'booking_id', new.id,
        'service_name', v_service,
        'local_date', to_char(new.starts_at at time zone v_tz, 'YYYY-MM-DD'),
        'local_time', to_char(new.starts_at at time zone v_tz, 'HH24:MI'),
        'party_size', new.party_size,
        'customer_name', new.customer_name
      )
    );
  exception when others then
    -- Never let a notification problem undo the booking.
    raise warning '%: notification skipped: %', tg_name, sqlerrm;
  end;
  return null;
end;
$function$;

create trigger notify_booking_requested
  after insert on public.bookings
  for each row execute function app.notify_booking_requested();
