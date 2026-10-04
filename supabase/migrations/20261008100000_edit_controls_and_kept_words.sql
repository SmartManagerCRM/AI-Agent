-- 1. Translation: words each business keeps as written (brand and dish names),
--    e.g. "خيال = Khayal" — Settings → Translation. Saving the list re-checks
--    the business's texts (queue_tenant_translations).
-- 2. Everything a business adds can be edited, suspended / reactivated and
--    deleted: customers get an active flag; leads, bookings, coupons and
--    memberships can be deleted by members allowed to change them; orders are
--    edited / deleted through functions that keep their money records safe;
--    staff members can be removed (never the owner).

-- ── 1. Kept words ────────────────────────────────────────────────────────
alter table public.tenant_settings add column translation jsonb not null default '{}'::jsonb;
-- tenant_settings is granted column by column (usage_governance migration): members may
-- read and change their kept words (the AI budget column stays hidden).
grant select (translation), update (translation) on public.tenant_settings to authenticated;

-- Queue every translatable text of one business (after its kept words change).
create or replace function public.queue_tenant_translations(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (app.has_permission(p_tenant_id, 'settings.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: settings.write required' using errcode = '42501';
  end if;
  insert into public.translation_queue (table_name, row_key, tenant_id)
  select 'products', id::text, tenant_id from public.products where tenant_id = p_tenant_id
  union all select 'categories', id::text, tenant_id from public.categories where tenant_id = p_tenant_id
  union all select 'bookable_services', id::text, tenant_id from public.bookable_services where tenant_id = p_tenant_id
  union all select 'membership_plans', id::text, tenant_id from public.membership_plans where tenant_id = p_tenant_id
  on conflict (table_name, row_key) do update set next_attempt_at = now(), attempts = 0, locked_until = null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.queue_tenant_translations(uuid) from public, anon;
grant execute on function public.queue_tenant_translations(uuid) to authenticated, service_role;

-- ── 2. Edit / suspend / delete ───────────────────────────────────────────
alter table public.customers add column is_active boolean not null default true;
-- Updates on customers are granted column by column (saved_customers migration).
grant update (is_active) on public.customers to authenticated;

create policy leads_delete on public.leads
  for delete using (app.has_permission(tenant_id, 'leads.write'));
create policy bookings_delete on public.bookings
  for delete using (app.has_permission(tenant_id, 'bookings.write'));
create policy coupons_delete on public.coupons
  for delete using (app.has_permission(tenant_id, 'marketing.write'));
create policy memberships_delete on public.memberships
  for delete using (app.has_permission(tenant_id, 'memberships.write'));

-- An order's customer details (never its lines, prices or totals).
create or replace function public.update_order_details(
  p_order_id uuid, p_customer_name text, p_customer_phone text, p_customer_email text, p_delivery_address text, p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Deletes an order — refused once a payment for it has succeeded (cancel it instead).
create or replace function public.delete_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
  if exists (select 1 from public.payments p where p.order_id = p_order_id and p.status = 'succeeded') then
    raise exception 'VALIDATION_ERROR: a paid order cannot be deleted';
  end if;
  delete from public.orders where id = p_order_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_order.tenant_id, auth.uid(), 'order.deleted', 'order', p_order_id,
          jsonb_build_object('order_number', v_order.order_number, 'total_minor', v_order.total_minor, 'currency', v_order.currency));
end;
$$;

-- Removes a staff member from the business (never its owner).
create or replace function public.remove_staff_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.tenant_members%rowtype;
  v_role_key text;
begin
  select * into v_member from public.tenant_members where id = p_member_id;
  if not found then
    raise exception 'NOT_FOUND: staff member does not exist';
  end if;
  if not (app.has_permission(v_member.tenant_id, 'staff.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: staff.write required' using errcode = '42501';
  end if;
  select key into v_role_key from public.roles where id = v_member.role_id;
  if v_role_key = 'business_owner' then
    raise exception 'VALIDATION_ERROR: the business owner cannot be removed';
  end if;
  delete from public.tenant_members where id = p_member_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_member.tenant_id, auth.uid(), 'staff.removed', 'tenant_member', p_member_id, '{}'::jsonb);
end;
$$;

revoke all on function public.update_order_details(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.delete_order(uuid) from public, anon;
revoke all on function public.remove_staff_member(uuid) from public, anon;
grant execute on function public.update_order_details(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.delete_order(uuid) to authenticated;
grant execute on function public.remove_staff_member(uuid) to authenticated;
