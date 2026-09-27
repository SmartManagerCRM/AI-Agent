-- Phase 5 — Cart & Orders. tenant_counters is written only from inside
-- SECURITY DEFINER functions (create_business, create_order_from_cart) —
-- it needs RLS enabled (forced) but no policy at all, so no direct
-- PostgREST access exists either way. Same anon-execute cleanup as every
-- prior hardening migration for the two new order functions.
alter table public.tenant_counters enable row level security;
alter table public.tenant_counters force row level security;

revoke execute on function public.create_order_from_cart(uuid) from anon;
revoke execute on function public.update_order_status(uuid, text, text) from anon;
