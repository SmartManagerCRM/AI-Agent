-- Regression fix: 20260928120000_dine_in_order_copy redefined
-- `create_order_from_cart` from the ORIGINAL 20260927180001 version rather
-- than the latest one (20260928010000_marketing_coupons), silently dropping:
--   * Cash on Delivery / Pay on Table orders starting as `confirmed` — every
--     in-person order stayed `pending_payment`, and `create_payment_attempt`
--     (which requires `confirmed` for those methods) then refused to record
--     the in-person payment;
--   * the payment-method checks (chosen, and enabled for this business);
--   * coupon validation, the discount, and the coupon's usage count;
--   * the "pay via …" note in the order history.
-- This is the marketing_coupons version again, plus the dine-in change that
-- migration actually intended: copying `table_id` from cart to order.
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
$$;

revoke all on function public.create_order_from_cart(uuid) from public;
grant execute on function public.create_order_from_cart(uuid) to authenticated, service_role;
