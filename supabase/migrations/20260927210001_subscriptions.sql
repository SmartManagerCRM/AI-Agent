-- Phase 7 — Trial & Subscription (spec §98). Every tenant starts on an
-- automatic free trial at signup (no card required) on the platform's
-- default plan; `create_business` is extended (again — see Phase 5's own
-- extension of it) to seed that trial and, closing a real gap Phase 1
-- left open, to actually move a new tenant out of `onboarding` into
-- `active` (nothing before this phase ever did, which meant
-- `resolvePublicTenant`'s `status = 'active'` check — the External Agent's
-- own gate — was unreachable for any tenant created so far).
--
-- Entitlement (is this tenant currently allowed to use the Agent) is never
-- read off a cached flag — `tenants.status` stays an administrative state
-- (Super Admin suspending/closing a business), while trial/subscription
-- expiry is computed live from `subscriptions.status`/`trial_ends_at`/
-- `current_period_end` every time it matters (src/server/billing/entitlement.ts),
-- the same "never trust stale state, re-verify" discipline
-- `create_order_from_cart` already applies to prices.

create table public.subscription_plans (
  key text primary key,
  name jsonb not null default '{}'::jsonb,
  -- Platform billing is always in one reference currency, deliberately
  -- independent of a tenant's own storefront currency (`tenants.currency`,
  -- what *their* customers pay them) — this is what a tenant pays
  -- SmartManager, not what their business charges.
  price_minor bigint not null check (price_minor >= 0),
  currency char(3) not null references public.currencies(code),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  trial_days integer not null default 14 check (trial_days >= 0),
  -- Reserved for future enforcement (e.g. max_agent_interactions_per_month,
  -- max_staff) — data-driven, same "never hard-code" posture as
  -- ai_model_configs. Nothing reads this yet.
  limits jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.subscription_plans
  for each row execute function app.set_updated_at();
create unique index subscription_plans_single_default_uidx on public.subscription_plans (is_default) where is_default;

alter table public.subscription_plans enable row level security;
alter table public.subscription_plans force row level security;
create policy subscription_plans_select on public.subscription_plans for select to authenticated using (true);

insert into public.subscription_plans (key, name, price_minor, currency, billing_interval, trial_days, is_default, sort_order) values
  ('starter', '{"en": "Starter", "ar": "أساسي", "fr": "Débutant"}'::jsonb, 2900, 'USD', 'month', 14, true, 1),
  ('pro', '{"en": "Pro", "ar": "احترافي", "fr": "Pro"}'::jsonb, 7900, 'USD', 'month', 14, false, 2);

-- ── subscriptions: one row per tenant (singleton, like tenant_settings) ──
create table public.subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_key text not null references public.subscription_plans(key),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at timestamptz not null,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.subscriptions
  for each row execute function app.set_updated_at();

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
create policy subscriptions_select on public.subscriptions
  for select using (app.has_permission(tenant_id, 'billing.read') or app.is_super_admin());
-- No insert/update/delete policy — every write is create_business (seeds
-- the trial) or mark_subscription_payment_succeeded below.

-- ── subscription_payments: one row per billing attempt (history, not a
--    singleton — unlike an order, a subscription is paid again every
--    period, so a past 'succeeded' row must never block a future one;
--    only a *pending* attempt is exclusive). ─────────────────────────────
create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_key text not null references public.subscription_plans(key),
  provider text not null default 'mock' check (provider in ('mock')),
  provider_intent_id text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null references public.currencies(code),
  failure_reason text,
  raw_verification jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.subscription_payments
  for each row execute function app.set_updated_at();
create index subscription_payments_tenant_idx on public.subscription_payments (tenant_id, created_at desc);
create unique index subscription_payments_tenant_pending_uidx on public.subscription_payments (tenant_id) where status = 'pending';
create unique index subscription_payments_provider_intent_uidx on public.subscription_payments (provider, provider_intent_id) where provider_intent_id is not null;

alter table public.subscription_payments enable row level security;
alter table public.subscription_payments force row level security;
create policy subscription_payments_select on public.subscription_payments
  for select using (app.has_permission(tenant_id, 'billing.read') or app.is_super_admin());

-- ── Permissions (new module). billing.write is owner-only — deliberately
--    tighter than orders.read/write (which business_admin also gets):
--    changing a business's own plan/payment is an owner-level action. ────
insert into public.permissions (key, module, description) values
  ('billing.read', 'billing', 'View subscription and billing history'),
  ('billing.write', 'billing', 'Change plan / make a subscription payment');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p
where r.tenant_id is null and r.key in ('business_owner', 'business_admin') and p.key = 'billing.read';

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p
where r.tenant_id is null and r.key = 'business_owner' and p.key = 'billing.write';

-- ── create_business: now also starts the tenant's trial and — the actual
--    fix — activates the tenant. Carries forward Phase 5's tenant_counters
--    seeding unchanged. ───────────────────────────────────────────────────
create or replace function public.create_business(
  p_business_name jsonb,
  p_business_type_key text,
  p_slug text,
  p_default_language text,
  p_currency char(3)
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tenant_id uuid;
  v_owner_role_id uuid;
  v_default_plan public.subscription_plans%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_ERROR: sign in required' using errcode = '28000';
  end if;

  select id into v_owner_role_id from public.roles where tenant_id is null and key = 'business_owner';
  if v_owner_role_id is null then
    raise exception 'CONFIG_ERROR: system role business_owner is not seeded';
  end if;

  select * into v_default_plan from public.subscription_plans where is_default and is_active limit 1;
  if not found then
    raise exception 'CONFIG_ERROR: no default subscription plan is seeded';
  end if;

  insert into public.tenants (slug, business_name, business_type_key, default_language, enabled_languages, currency, status)
  values (lower(p_slug), p_business_name, p_business_type_key, p_default_language, array[p_default_language], p_currency, 'active')
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);
  insert into public.tenant_counters (tenant_id, next_order_number) values (v_tenant_id, 1000);

  insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at)
  values (v_tenant_id, v_default_plan.key, 'trialing', now() + make_interval(days => v_default_plan.trial_days));

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_tenant_id, v_user, v_owner_role_id, 'active');

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_tenant_id, v_user, 'tenant.created', 'tenant', v_tenant_id);

  return v_tenant_id;
end;
$$;
revoke all on function public.create_business(jsonb, text, text, text, char(3)) from public;
grant execute on function public.create_business(jsonb, text, text, text, char(3)) to authenticated;

-- ── create_subscription_payment_attempt: starts (or resumes) a payment
--    for a chosen plan. Owner-only (billing.write) — there is no
--    anonymous/customer path here, unlike order payments. ──────────────
create or replace function public.create_subscription_payment_attempt(p_tenant_id uuid, p_plan_key text, p_provider text default 'mock')
returns table (payment_id uuid, provider text, plan_key text, amount_minor bigint, currency text, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_existing public.subscription_payments%rowtype;
  v_payment_id uuid;
begin
  if not (app.has_permission(p_tenant_id, 'billing.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: billing.write required' using errcode = '42501';
  end if;
  if p_provider not in ('mock') then
    raise exception 'VALIDATION_ERROR: unknown payment provider %', p_provider;
  end if;

  select * into v_plan from public.subscription_plans where key = p_plan_key and is_active;
  if not found then
    raise exception 'VALIDATION_ERROR: unknown or inactive plan %', p_plan_key;
  end if;

  select * into v_existing from public.subscription_payments
    where tenant_id = p_tenant_id and status = 'pending'
    order by created_at desc limit 1;
  if found then
    return query select v_existing.id, v_existing.provider, v_existing.plan_key, v_existing.amount_minor, v_existing.currency::text, true;
    return;
  end if;

  insert into public.subscription_payments (tenant_id, plan_key, provider, amount_minor, currency, status)
  values (p_tenant_id, p_plan_key, p_provider, v_plan.price_minor, v_plan.currency, 'pending')
  returning id into v_payment_id;

  return query select v_payment_id, p_provider, p_plan_key, v_plan.price_minor, v_plan.currency::text, false;
end;
$$;
revoke all on function public.create_subscription_payment_attempt(uuid, text, text) from public;
grant execute on function public.create_subscription_payment_attempt(uuid, text, text) to authenticated;

-- ── record_subscription_payment_provider_intent: service-role only, same
--    "runs right after calling the provider's API from trusted server
--    code" reasoning as record_payment_provider_intent. ────────────────
create or replace function public.record_subscription_payment_provider_intent(p_payment_id uuid, p_provider_intent_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.subscription_payments
    set provider_intent_id = p_provider_intent_id
    where id = p_payment_id and status = 'pending';
$$;
revoke all on function public.record_subscription_payment_provider_intent(uuid, text) from public;
grant execute on function public.record_subscription_payment_provider_intent(uuid, text) to service_role;

-- ── mark_subscription_payment_succeeded / _failed: the only two functions
--    that ever record a subscription payment's outcome. Service-role only
--    — reachable only from the (already signature-verified) webhook path,
--    same as mark_payment_succeeded/failed. ────────────────────────────
create or replace function public.mark_subscription_payment_succeeded(p_payment_id uuid, p_provider_event_id text, p_raw jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_period_length interval;
begin
  select * into v_payment from public.subscription_payments where id = p_payment_id;
  if not found then
    raise exception 'NOT_FOUND: subscription payment does not exist';
  end if;

  begin
    insert into public.payment_webhook_events (provider, event_id, payload)
    values (v_payment.provider, p_provider_event_id, p_raw);
  exception when unique_violation then
    return;
  end;

  if v_payment.status = 'succeeded' then
    return;
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'VALIDATION_ERROR: subscription payment % is % and cannot be marked succeeded', p_payment_id, v_payment.status;
  end if;

  select * into v_plan from public.subscription_plans where key = v_payment.plan_key;
  v_period_length := case v_plan.billing_interval when 'year' then interval '1 year' else interval '1 month' end;

  update public.subscription_payments set status = 'succeeded', raw_verification = p_raw where id = p_payment_id;

  update public.subscriptions
    set plan_key = v_payment.plan_key, status = 'active', current_period_end = now() + v_period_length
    where tenant_id = v_payment.tenant_id;

  -- A tenant a Super Admin never touched but that lapsed into `suspended`
  -- purely for non-payment is restored the moment they pay again.
  update public.tenants set status = 'active' where id = v_payment.tenant_id and status = 'suspended';

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_payment.tenant_id, null, 'subscription.payment_succeeded', 'subscription_payment', p_payment_id);
end;
$$;
revoke all on function public.mark_subscription_payment_succeeded(uuid, text, jsonb) from public;
grant execute on function public.mark_subscription_payment_succeeded(uuid, text, jsonb) to service_role;

create or replace function public.mark_subscription_payment_failed(p_payment_id uuid, p_provider_event_id text, p_raw jsonb, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments%rowtype;
begin
  select * into v_payment from public.subscription_payments where id = p_payment_id;
  if not found then
    raise exception 'NOT_FOUND: subscription payment does not exist';
  end if;

  begin
    insert into public.payment_webhook_events (provider, event_id, payload)
    values (v_payment.provider, p_provider_event_id, p_raw);
  exception when unique_violation then
    return;
  end;

  if v_payment.status <> 'pending' then
    return;
  end if;

  update public.subscription_payments
    set status = 'failed', failure_reason = p_reason, raw_verification = p_raw
    where id = p_payment_id;
  -- The subscription's own status is untouched — a failed *new* attempt
  -- does not revoke whatever entitlement (trial or a prior period) the
  -- tenant already had.

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_payment.tenant_id, null, 'subscription.payment_failed', 'subscription_payment', p_payment_id, jsonb_build_object('reason', p_reason));
end;
$$;
revoke all on function public.mark_subscription_payment_failed(uuid, text, jsonb, text) from public;
grant execute on function public.mark_subscription_payment_failed(uuid, text, jsonb, text) to service_role;
