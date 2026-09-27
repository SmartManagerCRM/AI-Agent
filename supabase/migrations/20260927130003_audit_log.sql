-- Phase 1 — Foundation. Audit log (spec §57). Written only by SECURITY
-- DEFINER functions / the service role — never directly by a client, and
-- never by an AI tool call.

create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  diff jsonb,
  ip inet,
  at timestamptz not null default now()
);

create index audit_logs_tenant_idx on public.audit_logs (tenant_id, at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
-- RLS policies for this table are created in `rls_helpers_and_policies`,
-- once the `app.is_super_admin()` / `app.has_permission()` helpers exist.
-- No insert/update/delete policy is ever added: rows are written only by
-- SECURITY DEFINER functions (e.g. create_business) or the service role.
