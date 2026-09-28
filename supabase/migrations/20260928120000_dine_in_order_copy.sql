-- Carries `table_id` from cart to order (spec §25 dine-in mode): without
-- this, an order placed at a real table would silently lose which table it
-- was for the moment it converts from cart to order. `create or replace`
-- keeps the function's signature and every other behavior identical to
-- 20260927180001_cart_and_orders.sql — only the two `table_id` mentions are
-- new.
create or replace function public.create_order_from_cart(p_cart_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
begin
  select * into v_cart from public.carts where id = p_cart_id;
  if not found then
    raise exception 'NOT_FOUND: cart does not exist';
  end if;
  if auth.uid() is not null and not app.has_permission(v_cart.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if v_cart.status <> 'active' then
    raise exception 'VALIDATION_ERROR: this cart is no longer active';
  end if;
  if v_cart.fulfillment_type is null then
    raise exception 'VALIDATION_ERROR: choose pickup, delivery, or dine-in before placing the order';
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

  if v_cart.fulfillment_type = 'delivery' then
    v_delivery_fee := coalesce((v_settings ->> 'delivery_fee_minor')::bigint, 0);
  end if;

  v_tax_rate_bps := coalesce((v_settings ->> 'tax_rate_bps')::int, 0);
  v_tax_included := coalesce((v_settings ->> 'tax_included')::boolean, false);
  if v_tax_rate_bps > 0 and not v_tax_included then
    v_tax := ((v_subtotal + v_delivery_fee) * v_tax_rate_bps) / 10000;
  end if;

  update public.tenant_counters set next_order_number = next_order_number + 1
    where tenant_id = v_cart.tenant_id
    returning next_order_number - 1 into v_order_number;
  if v_order_number is null then
    insert into public.tenant_counters (tenant_id, next_order_number) values (v_cart.tenant_id, 1001)
      on conflict (tenant_id) do nothing;
    v_order_number := 1000;
  end if;

  insert into public.orders (
    tenant_id, order_number, conversation_id, cart_id, status, fulfillment_type, branch_id, table_id,
    customer_name, customer_phone, customer_email, delivery_address, notes,
    currency, subtotal_minor, delivery_fee_minor, tax_minor, total_minor
  ) values (
    v_cart.tenant_id, v_order_number, v_cart.conversation_id, v_cart.id, 'pending_payment', v_cart.fulfillment_type,
    v_cart.branch_id, v_cart.table_id, v_cart.customer_name, v_cart.customer_phone, v_cart.customer_email,
    v_cart.delivery_address, v_cart.notes, v_currency, v_subtotal, v_delivery_fee, v_tax,
    v_subtotal + v_delivery_fee + v_tax
  )
  returning id into v_order_id;

  insert into public.order_items (tenant_id, order_id, product_id, product_name, unit_price_minor, quantity, total_minor)
  select v_cart.tenant_id, v_order_id, p.id, p.name, p.price_minor, ci.quantity, p.price_minor * ci.quantity
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = p_cart_id;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, actor)
  values (v_cart.tenant_id, v_order_id, null, 'pending_payment', case when auth.uid() is null then 'customer' else 'staff' end);

  update public.carts set status = 'converted' where id = p_cart_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_cart.tenant_id, auth.uid(), 'order.created', 'order', v_order_id);

  return v_order_id;
end;
$$;
revoke all on function public.create_order_from_cart(uuid) from public;
grant execute on function public.create_order_from_cart(uuid) to authenticated, service_role;
