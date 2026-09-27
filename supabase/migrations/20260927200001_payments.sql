-- Phase 6 — Payments (spec §17, §63, §64). A `PaymentProvider` abstraction
-- (src/server/payments/provider.ts) with one implementation today — a mock
-- provider standing in for a real gateway until one is wired in at deploy
-- time, the same "platform-level credential added later" posture as
-- GEMINI_API_KEY/ANTHROPIC_API_KEY (src/server/env-core.ts). The one rule
-- this whole phase exists to enforce: an order only ever becomes `paid`
-- through server-side verification of a provider's own notification
-- (a webhook) — never from anything the frontend, the customer, or the
-- LLM claims. No tool, Server Action reachable from the browser, or AI
-- response is ever able to set `orders.status = 'paid'` directly; the two
-- functions that can (`mark_payment_succeeded`, and staff's own
-- `update_order_status` for out-of-band/cash payments) are both below,
-- and neither trusts client input for the outcome.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  -- Only the mock provider exists today; a real one is a second value here
  -- plus a second `PaymentProvider` implementation, never a schema change.
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
create trigger set_updated_at before update on public.payments
  for each row execute function app.set_updated_at();
create index payments_order_idx on public.payments (order_id, created_at desc);
-- The actual idempotency guard for create_payment_attempt below: at most
-- one attempt per order may be in flight or already successful. Enforced
-- by Postgres, not trusted to application logic.
create unique index payments_order_active_uidx on public.payments (order_id) where status in ('pending', 'succeeded');
create unique index payments_provider_intent_uidx on public.payments (provider, provider_intent_id) where provider_intent_id is not null;

alter table public.payments enable row level security;
alter table public.payments force row level security;
create policy payments_select on public.payments
  for select using (app.has_permission(tenant_id, 'orders.read') or app.is_super_admin());
-- No insert/update/delete policy anywhere — every write is one of the four
-- SECURITY DEFINER functions below.

-- Dedupe ledger for webhook deliveries (a provider may retry the same
-- event). RLS enabled with **no policy at all** — same "on, nothing
-- granted" pattern as tenant_counters; only service-role code ever touches
-- this table, by design.
create table public.payment_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  payload jsonb,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);
alter table public.payment_webhook_events enable row level security;
alter table public.payment_webhook_events force row level security;

-- ── create_payment_attempt: starts (or idempotently resumes) a payment ──
create or replace function public.create_payment_attempt(p_order_id uuid, p_provider text default 'mock')
returns table (payment_id uuid, provider text, order_number int, amount_minor bigint, currency text, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
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
  if v_order.status <> 'pending_payment' then
    raise exception 'VALIDATION_ERROR: order is not awaiting payment';
  end if;
  if p_provider not in ('mock') then
    raise exception 'VALIDATION_ERROR: unknown payment provider %', p_provider;
  end if;

  select * into v_existing from public.payments
    where order_id = p_order_id and status in ('pending', 'succeeded')
    order by created_at desc limit 1;
  if found then
    return query select v_existing.id, v_existing.provider, v_order.order_number, v_existing.amount_minor, v_existing.currency, true;
    return;
  end if;

  -- The amount is the order's own total, re-read here — never supplied by
  -- the caller (spec §15's "backend computes the total" discipline applies
  -- to payments too: an amount is only ever what create_order_from_cart
  -- already computed and stored).
  insert into public.payments (tenant_id, order_id, provider, amount_minor, currency, status)
  values (v_order.tenant_id, p_order_id, p_provider, v_order.total_minor, v_order.currency, 'pending')
  returning id into v_payment_id;

  return query select v_payment_id, p_provider, v_order.order_number, v_order.total_minor, v_order.currency, false;
end;
$$;
revoke all on function public.create_payment_attempt(uuid, text) from public;
grant execute on function public.create_payment_attempt(uuid, text) to authenticated, service_role;

-- ── record_payment_provider_intent: stores the provider's own intent id.
--    Service-role only — this runs right after calling the provider's API
--    from trusted server code, never from a client or a staff session. ───
create or replace function public.record_payment_provider_intent(p_payment_id uuid, p_provider_intent_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payments
    set provider_intent_id = p_provider_intent_id
    where id = p_payment_id and status = 'pending';
$$;
revoke all on function public.record_payment_provider_intent(uuid, text) from public;
grant execute on function public.record_payment_provider_intent(uuid, text) to service_role;

-- ── mark_payment_succeeded / mark_payment_failed: the only two functions
--    that ever record a payment outcome. Both are service-role only —
--    reachable only from the webhook route handler
--    (src/app/api/payments/webhook/[provider]/route.ts), which has already
--    verified the provider's signature before calling either. Neither
--    trusts anything about the outcome except what it was given here. ───
create or replace function public.mark_payment_succeeded(p_payment_id uuid, p_provider_event_id text, p_raw jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'NOT_FOUND: payment does not exist';
  end if;

  -- Idempotency: a provider may deliver the same event more than once.
  -- The unique (provider, event_id) constraint is the real guard; a
  -- duplicate delivery no-ops here rather than erroring, since retries are
  -- the provider's normal behavior, not a bug.
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
    raise exception 'VALIDATION_ERROR: payment % is % and cannot be marked succeeded', p_payment_id, v_payment.status;
  end if;

  update public.payments set status = 'succeeded', raw_verification = p_raw where id = p_payment_id;

  update public.orders set status = 'paid' where id = v_payment.order_id and status = 'pending_payment';

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, actor, note)
  values (v_payment.tenant_id, v_payment.order_id, 'pending_payment', 'paid', 'system', 'payment verified via ' || v_payment.provider);

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_payment.tenant_id, null, 'payment.succeeded', 'payment', p_payment_id);
end;
$$;
revoke all on function public.mark_payment_succeeded(uuid, text, jsonb) from public;
grant execute on function public.mark_payment_succeeded(uuid, text, jsonb) to service_role;

create or replace function public.mark_payment_failed(p_payment_id uuid, p_provider_event_id text, p_raw jsonb, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'NOT_FOUND: payment does not exist';
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

  update public.payments
    set status = 'failed', failure_reason = p_reason, raw_verification = p_raw
    where id = p_payment_id;
  -- The order deliberately stays `pending_payment` — a failed attempt lets
  -- the customer retry (create_payment_attempt finds no active attempt
  -- left and starts a new one), it does not cancel the order.

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_payment.tenant_id, null, 'payment.failed', 'payment', p_payment_id, jsonb_build_object('reason', p_reason));
end;
$$;
revoke all on function public.mark_payment_failed(uuid, text, jsonb, text) from public;
grant execute on function public.mark_payment_failed(uuid, text, jsonb, text) to service_role;
