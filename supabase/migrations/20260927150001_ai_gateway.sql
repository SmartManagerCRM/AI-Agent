-- Phase 3 — AI Gateway (spec §5, §6, §29, §59, §68). Platform-level model
-- configuration/pricing (Super Admin territory — full Super Admin UI is
-- Phase 9, this migration only lays the table down) plus a unified
-- interaction ledger that records EVERY agent interaction, whether or not it
-- ever reached a model — the deterministic-first requirement (spec §7, §69)
-- needs that ledger to compute "% handled without AI", not just AI spend.

-- ── Model configuration & pricing (never hard-coded in business logic) ───
create table public.ai_model_configs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gemini', 'anthropic')),
  model text not null,
  -- "fast": routine/simple interactions (spec §6 "Flash-Lite class").
  -- "agent": complex reasoning/tool orchestration (spec §6 "Flash class").
  kind text not null check (kind in ('fast', 'agent')),
  -- USD, regardless of tenant display currency — AI vendor billing is USD
  -- and the internal trial/budget ceilings (spec §25) are specified in USD.
  input_price_per_million_usd numeric(10, 4) not null check (input_price_per_million_usd >= 0),
  output_price_per_million_usd numeric(10, 4) not null check (output_price_per_million_usd >= 0),
  is_active boolean not null default true,
  is_default boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.ai_model_configs
  for each row execute function app.set_updated_at();
-- At most one default per kind; the router falls back to any other active
-- row of the same kind (regardless of provider) if the default's call fails.
create unique index ai_model_configs_default_uidx on public.ai_model_configs (kind) where is_default;

alter table public.ai_model_configs enable row level security;
alter table public.ai_model_configs force row level security;
-- Model names and USD-per-million pricing are not tenant secrets — every
-- signed-in caller (staff today; a future anonymous customer-widget session,
-- Phase 10, reads through the service role instead) can read the active
-- configuration the router needs. Writes are Super Admin only (Phase 9 adds
-- the UI; the gate exists from the start).
create policy ai_model_configs_select on public.ai_model_configs
  for select to authenticated, anon using (true);
create policy ai_model_configs_write on public.ai_model_configs
  for all using (app.is_super_admin()) with check (app.is_super_admin());

-- ── Unified agent interaction ledger ─────────────────────────────────────
create table public.agent_interactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_type text not null,
  -- Whether this interaction ever reached a model at all — the number this
  -- whole table exists to make measurable (spec §7, §69: "do not interpret
  -- every customer message as requiring an LLM call").
  handled_by text not null check (handled_by in ('deterministic', 'ai')),
  deterministic_rule text,
  provider text check (provider in ('gemini', 'anthropic')),
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  latency_ms integer,
  success boolean not null default true,
  fallback_used boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  constraint agent_interactions_ai_has_provider check (
    handled_by = 'deterministic' or (provider is not null and model is not null)
  )
);
create index agent_interactions_tenant_idx on public.agent_interactions (tenant_id, created_at desc);
create index agent_interactions_handled_by_idx on public.agent_interactions (tenant_id, handled_by);

alter table public.agent_interactions enable row level security;
alter table public.agent_interactions force row level security;
create policy agent_interactions_select on public.agent_interactions
  for select using (app.has_permission(tenant_id, 'agent.read') or app.is_super_admin());
-- No insert/update/delete policy: every row is written by
-- `record_agent_interaction` below — the one path both a staff-authenticated
-- request (the Agent preview) and a future service-role customer-session
-- path (Phase 4/10, no Supabase Auth user at all) can both reach safely.

create or replace function public.record_agent_interaction(
  p_tenant_id uuid,
  p_request_type text,
  p_handled_by text,
  p_deterministic_rule text,
  p_provider text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_estimated_cost_usd numeric,
  p_latency_ms integer,
  p_success boolean,
  p_fallback_used boolean,
  p_error_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- A signed-in caller (the Agent preview, staff-only today) must hold
  -- agent.read/write via tenant membership. A caller with NO session at all
  -- (auth.uid() is null) reaches this only through the service role — never
  -- through `anon`, whose EXECUTE grant is revoked below — so it is trusted:
  -- that is how a future anonymous customer-widget session (Phase 4/10,
  -- which has no Supabase Auth user to check has_permission against) will
  -- record its own interactions.
  if auth.uid() is not null and not app.has_permission(p_tenant_id, 'agent.read') then
    raise exception 'PERMISSION_ERROR: agent access required' using errcode = '42501';
  end if;
  if p_handled_by not in ('deterministic', 'ai') then
    raise exception 'VALIDATION_ERROR: invalid handled_by';
  end if;

  insert into public.agent_interactions (
    tenant_id, request_type, handled_by, deterministic_rule, provider, model,
    input_tokens, output_tokens, estimated_cost_usd, latency_ms, success, fallback_used, error_message
  ) values (
    p_tenant_id, p_request_type, p_handled_by, p_deterministic_rule, p_provider, p_model,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_estimated_cost_usd, 0),
    p_latency_ms, p_success, p_fallback_used, p_error_message
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.record_agent_interaction(
  uuid, text, text, text, text, text, integer, integer, numeric, integer, boolean, boolean, text
) from public;
grant execute on function public.record_agent_interaction(
  uuid, text, text, text, text, text, integer, integer, numeric, integer, boolean, boolean, text
) to authenticated, service_role;

-- ── Deterministic-first metric (spec §69 "measure the percentage of
--    interactions handled without AI") ──────────────────────────────────
create or replace function public.agent_interaction_stats(p_tenant_id uuid, p_since timestamptz default now() - interval '30 days')
returns table (
  total_interactions bigint,
  deterministic_count bigint,
  ai_count bigint,
  deterministic_pct numeric,
  total_cost_usd numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*),
    count(*) filter (where handled_by = 'deterministic'),
    count(*) filter (where handled_by = 'ai'),
    round(
      100.0 * count(*) filter (where handled_by = 'deterministic') / greatest(count(*), 1),
      1
    ),
    coalesce(sum(estimated_cost_usd), 0)
  from public.agent_interactions
  where tenant_id = p_tenant_id and created_at >= p_since;
$$;
