-- Customer Agent Master Prompt §27 "Lead Capture". A real table for a
-- real capability the Agent gains this phase — `capture_lead`, a new
-- tool the AI can call when a customer's request isn't a simple catalog
-- purchase (a custom project, a consultation, a follow-up request).
-- Writes only ever come from the service-role client the public Agent
-- entry point already uses for cart/order writes (see
-- src/server/agent-public/actions.ts) — no insert policy for
-- `authenticated`/`anon`, same "written only server-side" posture as
-- audit_logs. Staff reading/updating leads in their own console is
-- gated by two new real permissions, following the exact
-- structured_catalog.sql pattern.
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_name text,
  customer_phone text,
  customer_email text,
  message text not null check (length(message) between 1 and 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.leads
  for each row execute function app.set_updated_at();
create index leads_tenant_idx on public.leads (tenant_id, created_at desc);

alter table public.leads enable row level security;
alter table public.leads force row level security;
create policy leads_select on public.leads
  for select using (app.has_permission(tenant_id, 'leads.read'));
create policy leads_update on public.leads
  for update using (app.has_permission(tenant_id, 'leads.write'))
  with check (app.has_permission(tenant_id, 'leads.write'));
-- No insert/delete policy for authenticated/anon — every lead is written
-- by the Agent's own service-role client (capture_lead tool handler).

insert into public.permissions (key, module, description) values
  ('leads.read', 'leads', 'View captured leads'),
  ('leads.write', 'leads', 'Update lead status');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key in ('business_owner', 'business_admin')
  and p.key in ('leads.read', 'leads.write');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key = 'staff' and p.key = 'leads.read';
