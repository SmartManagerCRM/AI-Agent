-- Super Admin Master Spec — Integrations (payment gateway connection
-- status across every business). `security invoker` (not definer): this
-- runs with the caller's own RLS, so it grants no privilege the caller
-- didn't already have — it only ever returns whether a secret key is
-- set, never the key itself, so Super Admin's own Next.js server never
-- has a tenant's real Moyasar/Tap secret pass through it just to render
-- a connected/not-connected badge.
create or replace function public.tenant_payment_integration_status()
returns table (tenant_id uuid, moyasar_connected boolean, tap_connected boolean, enabled_methods text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select tenant_id, moyasar_secret_key is not null, tap_secret_key is not null, enabled_methods
  from public.tenant_payment_config;
$$;
grant execute on function public.tenant_payment_integration_status() to authenticated;
