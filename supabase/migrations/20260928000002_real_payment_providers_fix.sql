-- Applied to production (version 20260927200546, "real_payment_providers_fix")
-- but never committed to the repository; recorded here so the repository's
-- migration history matches the database again.
create or replace function public.create_payment_attempt(p_order_id uuid)
returns table (payment_id uuid, provider text, order_number int, amount_minor bigint, currency text, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke all on function public.create_payment_attempt(uuid) from public;
grant execute on function public.create_payment_attempt(uuid) to authenticated, service_role;
