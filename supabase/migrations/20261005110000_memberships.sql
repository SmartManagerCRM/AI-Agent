-- Memberships: plans a business sells or gives to its customers, and the
-- customers who hold them.
--
--   membership_plans     loyalty (free or paid club / loyalty card) or
--                        service (paid access: gym, classes, car wash …).
--                        Price per period (0 = free), joining fee, length
--                        of a period (days / weeks / months / years, or no
--                        expiry), free trial, grace period, visits included
--                        per period, member discount, benefits, member cap,
--                        and the bookable services it covers.
--   memberships          one customer on one plan: member number, start and
--                        renewal dates, status (active / paused / cancelled;
--                        "expired" is derived from the renewal date + grace),
--                        auto-renew, payment status, visits used this period.
--   membership_payments  every payment taken (joining fee, first period,
--                        renewals) — the membership revenue record.
--   membership_visits    check-ins (counted against visits per period).
--
-- Writes that need rules (enrolment, renewal, check-in, pause/resume) go
-- through SECURITY DEFINER functions that check memberships.write; members
-- of other businesses can never see or change them (RLS).

insert into public.permissions (key, module, description) values
  ('memberships.read', 'memberships', 'View membership plans and members'),
  ('memberships.write', 'memberships', 'Manage membership plans, enrol, renew and check in members')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p
where r.tenant_id is null and r.key in ('business_owner', 'business_admin') and p.key in ('memberships.read', 'memberships.write')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'memberships.read' from public.roles r
where r.tenant_id is null and r.key = 'staff'
on conflict do nothing;

create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name jsonb not null check (name <> '{}'::jsonb),
  description jsonb not null default '{}'::jsonb,
  kind text not null check (kind in ('loyalty', 'service')),
  price_minor bigint not null default 0 check (price_minor >= 0),
  joining_fee_minor bigint not null default 0 check (joining_fee_minor >= 0),
  currency char(3) not null references public.currencies(code),
  billing_period text not null check (billing_period in ('none', 'day', 'week', 'month', 'year')),
  period_count integer not null default 1 check (period_count between 1 and 60),
  auto_renew_default boolean not null default true,
  trial_days integer not null default 0 check (trial_days between 0 and 365),
  grace_days integer not null default 0 check (grace_days between 0 and 90),
  visits_per_period integer check (visits_per_period is null or visits_per_period between 1 and 10000),
  discount_percent numeric(5, 2) check (discount_percent is null or (discount_percent > 0 and discount_percent <= 100)),
  benefits text check (benefits is null or length(benefits) <= 2000),
  max_members integer check (max_members is null or max_members between 1 and 1000000),
  service_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_plans_archived_inactive check (archived_at is null or not is_active),
  -- A plan with no expiry has nothing to renew.
  constraint membership_plans_none_no_renew check (billing_period <> 'none' or (not auto_renew_default and trial_days = 0))
);
create trigger set_updated_at before update on public.membership_plans
  for each row execute function app.set_updated_at();
create index membership_plans_tenant_idx on public.membership_plans (tenant_id, is_active);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.membership_plans(id) on delete restrict,
  member_number integer not null,
  customer_name text not null check (length(btrim(customer_name)) between 1 and 120),
  customer_phone text check (customer_phone is null or length(customer_phone) <= 40),
  customer_email text check (customer_email is null or length(customer_email) <= 200),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  start_date date not null,
  -- Renewal date: the day the current period ends. Null = no expiry.
  end_date date,
  trial_ends_on date,
  auto_renew boolean not null default false,
  price_minor bigint not null check (price_minor >= 0),
  currency char(3) not null references public.currencies(code),
  payment_status text not null check (payment_status in ('paid', 'unpaid', 'free', 'trial')),
  visits_used integer not null default 0 check (visits_used >= 0),
  paused_on date,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, member_number),
  check (end_date is null or end_date >= start_date)
);
create trigger set_updated_at before update on public.memberships
  for each row execute function app.set_updated_at();
create index memberships_tenant_idx on public.memberships (tenant_id, status, end_date);
create index memberships_plan_idx on public.memberships (plan_id);
create index memberships_phone_idx on public.memberships (tenant_id, customer_phone);

create table public.membership_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  kind text not null check (kind in ('joining', 'period', 'renewal')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null references public.currencies(code),
  method text not null check (method in ('cash', 'card', 'transfer', 'online', 'other')),
  period_start date,
  period_end date,
  paid_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null
);
create index membership_payments_tenant_idx on public.membership_payments (tenant_id, paid_at desc);
create index membership_payments_membership_idx on public.membership_payments (membership_id);

create table public.membership_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  visited_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null
);
create index membership_visits_membership_idx on public.membership_visits (membership_id, visited_at desc);

alter table public.tenant_counters add column if not exists next_member_number integer not null default 1;

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.membership_plans enable row level security;
alter table public.membership_plans force row level security;
create policy membership_plans_select on public.membership_plans
  for select using (app.has_permission(tenant_id, 'memberships.read'));
create policy membership_plans_insert on public.membership_plans
  for insert with check (app.has_permission(tenant_id, 'memberships.write'));
create policy membership_plans_update on public.membership_plans
  for update using (app.has_permission(tenant_id, 'memberships.write'))
  with check (app.has_permission(tenant_id, 'memberships.write'));

alter table public.memberships enable row level security;
alter table public.memberships force row level security;
create policy memberships_select on public.memberships
  for select using (app.has_permission(tenant_id, 'memberships.read'));
-- Direct updates only for the simple fields (notes, contact, auto-renew); the column grant below limits them.
create policy memberships_update on public.memberships
  for update using (app.has_permission(tenant_id, 'memberships.write'))
  with check (app.has_permission(tenant_id, 'memberships.write'));

alter table public.membership_payments enable row level security;
alter table public.membership_payments force row level security;
create policy membership_payments_select on public.membership_payments
  for select using (app.has_permission(tenant_id, 'memberships.read'));

alter table public.membership_visits enable row level security;
alter table public.membership_visits force row level security;
create policy membership_visits_select on public.membership_visits
  for select using (app.has_permission(tenant_id, 'memberships.read'));

revoke all on public.membership_plans, public.memberships, public.membership_payments, public.membership_visits from anon;
revoke update on public.memberships from authenticated;
grant update (customer_name, customer_phone, customer_email, auto_renew, notes) on public.memberships to authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────
create or replace function app.membership_period(p_period text, p_count integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_period
    when 'day' then make_interval(days => p_count)
    when 'week' then make_interval(weeks => p_count)
    when 'month' then make_interval(months => p_count)
    when 'year' then make_interval(years => p_count)
    else null
  end;
$$;

create or replace function app.require_membership_write(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_permission(p_tenant_id, 'memberships.write') then
    raise exception 'PERMISSION_ERROR: memberships.write required' using errcode = '42501';
  end if;
end;
$$;

-- ── Enrol a customer ───────────────────────────────────────────────────
-- Payment: 'paid' records the joining fee and the first period; 'unpaid'
-- records nothing yet; free plans are 'free'; plans with a trial start in
-- 'trial' (the first paid period starts when the trial ends, via renew).
create or replace function public.enrol_membership(
  p_plan_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_start_date date,
  p_paid boolean,
  p_payment_method text,
  p_auto_renew boolean,
  p_notes text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan public.membership_plans%rowtype;
  v_number integer;
  v_start date := coalesce(p_start_date, current_date);
  v_end date;
  v_trial_end date;
  v_status text;
  v_id uuid;
  v_active integer;
begin
  select * into v_plan from public.membership_plans where id = p_plan_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'plan');
  end if;
  perform app.require_membership_write(v_plan.tenant_id);
  if not v_plan.is_active or v_plan.archived_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'plan');
  end if;
  if length(btrim(coalesce(p_customer_name, ''))) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'name');
  end if;
  if v_start < current_date - 365 or v_start > current_date + 365 then
    return jsonb_build_object('ok', false, 'reason', 'start_date');
  end if;
  if p_payment_method is not null and p_payment_method not in ('cash', 'card', 'transfer', 'online', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'method');
  end if;
  if v_plan.max_members is not null then
    select count(*) into v_active from public.memberships
     where plan_id = p_plan_id and status <> 'cancelled' and (end_date is null or end_date + v_plan.grace_days >= current_date);
    if v_active >= v_plan.max_members then
      return jsonb_build_object('ok', false, 'reason', 'full');
    end if;
  end if;

  if v_plan.trial_days > 0 then
    v_trial_end := v_start + v_plan.trial_days;
    v_end := v_trial_end;
    v_status := 'trial';
  elsif v_plan.billing_period = 'none' then
    v_end := null;
    v_status := case when v_plan.price_minor + v_plan.joining_fee_minor = 0 then 'free' when p_paid then 'paid' else 'unpaid' end;
  else
    v_end := (v_start + app.membership_period(v_plan.billing_period, v_plan.period_count))::date;
    v_status := case when v_plan.price_minor + v_plan.joining_fee_minor = 0 then 'free' when p_paid then 'paid' else 'unpaid' end;
  end if;

  insert into public.tenant_counters (tenant_id) values (v_plan.tenant_id) on conflict (tenant_id) do nothing;
  update public.tenant_counters set next_member_number = next_member_number + 1
   where tenant_id = v_plan.tenant_id returning next_member_number - 1 into v_number;

  insert into public.memberships (
    tenant_id, plan_id, member_number, customer_name, customer_phone, customer_email, status,
    start_date, end_date, trial_ends_on, auto_renew, price_minor, currency, payment_status, notes, created_by
  ) values (
    v_plan.tenant_id, p_plan_id, v_number, btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_phone, '')), ''), nullif(btrim(coalesce(p_customer_email, '')), ''), 'active',
    v_start, v_end, v_trial_end,
    case when v_plan.billing_period = 'none' then false else coalesce(p_auto_renew, v_plan.auto_renew_default) end,
    v_plan.price_minor, v_plan.currency, v_status, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  ) returning id into v_id;

  if v_status = 'paid' then
    if v_plan.joining_fee_minor > 0 then
      insert into public.membership_payments (tenant_id, membership_id, kind, amount_minor, currency, method, recorded_by)
      values (v_plan.tenant_id, v_id, 'joining', v_plan.joining_fee_minor, v_plan.currency, coalesce(p_payment_method, 'cash'), auth.uid());
    end if;
    if v_plan.price_minor > 0 then
      insert into public.membership_payments (tenant_id, membership_id, kind, amount_minor, currency, method, period_start, period_end, recorded_by)
      values (v_plan.tenant_id, v_id, 'period', v_plan.price_minor, v_plan.currency, coalesce(p_payment_method, 'cash'), v_start, v_end, auth.uid());
    end if;
  elsif v_status = 'trial' and p_paid and v_plan.joining_fee_minor > 0 then
    insert into public.membership_payments (tenant_id, membership_id, kind, amount_minor, currency, method, recorded_by)
    values (v_plan.tenant_id, v_id, 'joining', v_plan.joining_fee_minor, v_plan.currency, coalesce(p_payment_method, 'cash'), auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'membership_id', v_id, 'member_number', v_number, 'end_date', v_end);
end;
$$;

-- ── Renew one period ───────────────────────────────────────────────────
-- From the renewal date if still running (or in grace), else from today.
create or replace function public.renew_membership(p_membership_id uuid, p_paid boolean, p_payment_method text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  m public.memberships%rowtype;
  v_plan public.membership_plans%rowtype;
  v_from date;
  v_to date;
begin
  select * into m from public.memberships where id = p_membership_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform app.require_membership_write(m.tenant_id);
  select * into v_plan from public.membership_plans where id = m.plan_id;
  if v_plan.billing_period = 'none' then
    return jsonb_build_object('ok', false, 'reason', 'no_expiry');
  end if;
  if m.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;
  if p_payment_method is not null and p_payment_method not in ('cash', 'card', 'transfer', 'online', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'method');
  end if;
  v_from := case when m.end_date is not null and m.end_date + v_plan.grace_days >= current_date then m.end_date else current_date end;
  v_to := (v_from + app.membership_period(v_plan.billing_period, v_plan.period_count))::date;
  update public.memberships set
    end_date = v_to,
    status = 'active',
    paused_on = null,
    visits_used = 0,
    price_minor = v_plan.price_minor,
    currency = v_plan.currency,
    payment_status = case when v_plan.price_minor = 0 then 'free' when p_paid then 'paid' else 'unpaid' end
  where id = m.id;
  if p_paid and v_plan.price_minor > 0 then
    insert into public.membership_payments (tenant_id, membership_id, kind, amount_minor, currency, method, period_start, period_end, recorded_by)
    values (m.tenant_id, m.id, 'renewal', v_plan.price_minor, v_plan.currency, coalesce(p_payment_method, 'cash'), v_from, v_to, auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'end_date', v_to);
end;
$$;

-- ── Record a payment for the current (unpaid) period ───────────────────
create or replace function public.mark_membership_paid(p_membership_id uuid, p_payment_method text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  m public.memberships%rowtype;
  v_plan public.membership_plans%rowtype;
begin
  select * into m from public.memberships where id = p_membership_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform app.require_membership_write(m.tenant_id);
  if m.payment_status <> 'unpaid' then
    return jsonb_build_object('ok', false, 'reason', 'not_unpaid');
  end if;
  if p_payment_method not in ('cash', 'card', 'transfer', 'online', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'method');
  end if;
  select * into v_plan from public.membership_plans where id = m.plan_id;
  -- First period of a new member also pays the joining fee.
  if not exists (select 1 from public.membership_payments where membership_id = m.id) and v_plan.joining_fee_minor > 0 then
    insert into public.membership_payments (tenant_id, membership_id, kind, amount_minor, currency, method, recorded_by)
    values (m.tenant_id, m.id, 'joining', v_plan.joining_fee_minor, m.currency, p_payment_method, auth.uid());
  end if;
  if m.price_minor > 0 then
    insert into public.membership_payments (tenant_id, membership_id, kind, amount_minor, currency, method, period_start, period_end, recorded_by)
    values (m.tenant_id, m.id, 'period', m.price_minor, m.currency, p_payment_method,
            coalesce((m.end_date - app.membership_period(v_plan.billing_period, v_plan.period_count))::date, m.start_date), m.end_date, auth.uid());
  end if;
  update public.memberships set payment_status = 'paid' where id = m.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Check in (a visit) ─────────────────────────────────────────────────
create or replace function public.membership_check_in(p_membership_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  m public.memberships%rowtype;
  v_plan public.membership_plans%rowtype;
begin
  select * into m from public.memberships where id = p_membership_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform app.require_membership_write(m.tenant_id);
  select * into v_plan from public.membership_plans where id = m.plan_id;
  if m.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', m.status);
  end if;
  if m.start_date > current_date then
    return jsonb_build_object('ok', false, 'reason', 'not_started');
  end if;
  if m.end_date is not null and m.end_date + v_plan.grace_days < current_date then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_plan.visits_per_period is not null and m.visits_used >= v_plan.visits_per_period then
    return jsonb_build_object('ok', false, 'reason', 'no_visits_left');
  end if;
  update public.memberships set visits_used = visits_used + 1 where id = m.id;
  insert into public.membership_visits (tenant_id, membership_id, recorded_by) values (m.tenant_id, m.id, auth.uid());
  return jsonb_build_object('ok', true, 'visits_used', m.visits_used + 1, 'visits_per_period', v_plan.visits_per_period);
end;
$$;

-- ── Pause (freeze), resume, cancel ─────────────────────────────────────
-- Resuming adds the paused days to the renewal date, so a frozen month isn't lost.
create or replace function public.set_membership_status(p_membership_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  m public.memberships%rowtype;
begin
  select * into m from public.memberships where id = p_membership_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform app.require_membership_write(m.tenant_id);
  if m.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;
  if p_status = 'paused' and m.status = 'active' then
    update public.memberships set status = 'paused', paused_on = current_date where id = m.id;
  elsif p_status = 'active' and m.status = 'paused' then
    update public.memberships set
      status = 'active',
      end_date = case when end_date is null then null else end_date + greatest(current_date - coalesce(paused_on, current_date), 0) end,
      paused_on = null
    where id = m.id;
  elsif p_status = 'cancelled' then
    update public.memberships set status = 'cancelled', auto_renew = false, cancelled_at = now(),
      cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
    where id = m.id;
  else
    return jsonb_build_object('ok', false, 'reason', 'transition');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.enrol_membership(uuid, text, text, text, date, boolean, text, boolean, text) from public, anon;
revoke all on function public.renew_membership(uuid, boolean, text) from public, anon;
revoke all on function public.mark_membership_paid(uuid, text) from public, anon;
revoke all on function public.membership_check_in(uuid) from public, anon;
revoke all on function public.set_membership_status(uuid, text, text) from public, anon;
grant execute on function public.enrol_membership(uuid, text, text, text, date, boolean, text, boolean, text) to authenticated;
grant execute on function public.renew_membership(uuid, boolean, text) to authenticated;
grant execute on function public.mark_membership_paid(uuid, text) to authenticated;
grant execute on function public.membership_check_in(uuid) to authenticated;
grant execute on function public.set_membership_status(uuid, text, text) to authenticated;

-- ── Business currency switch ───────────────────────────────────────────
-- When the owner switches the business currency (change_business_currency
-- converts products, services, coupons …), membership plan prices convert
-- at the same rate. Existing members keep the price they agreed, in its
-- currency, until they renew.
create or replace function app.convert_membership_plans_on_currency_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factor numeric;
begin
  select new.rate * power(10::numeric, t.exponent - f.exponent) into v_factor
    from public.currencies f, public.currencies t
   where f.code = new.from_currency and t.code = new.to_currency;
  if v_factor is null then
    return new;
  end if;
  update public.membership_plans p
     set price_minor = round(p.price_minor * v_factor)::bigint,
         joining_fee_minor = round(p.joining_fee_minor * v_factor)::bigint,
         currency = new.to_currency
   where p.tenant_id = new.tenant_id and p.currency = new.from_currency;
  return new;
end;
$$;
create trigger convert_membership_plans after insert on public.tenant_currency_changes
  for each row execute function app.convert_membership_plans_on_currency_change();
