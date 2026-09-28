-- Customer Agent Master Prompt §26 "Booking". A real, server-validated
-- booking system — availability is always computed live from the
-- business's own real opening hours (branches.opening_hours, already
-- real data) minus this service's own already-confirmed bookings, never
-- an invented slot (§26 "never invent a booking slot").
--
-- Deliberately simple for this first pass: one resource per service (no
-- staff/room scheduling model — two different services can run in
-- parallel without conflict, but two bookings of the *same* service
-- cannot overlap). This is an honest, real subset, not a shortcut
-- pretending to be the full multi-staff model spec §26 describes; a
-- later phase can add a resource/staff dimension without changing this
-- shape's core meaning.
create table public.bookable_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name jsonb not null default '{}'::jsonb,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 480),
  price_minor bigint check (price_minor >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.bookable_services
  for each row execute function app.set_updated_at();
create index bookable_services_tenant_idx on public.bookable_services (tenant_id, is_active);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null references public.bookable_services(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_name text,
  customer_phone text,
  customer_email text,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'confirmed' check (status in ('confirmed', 'completed', 'canceled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.bookings
  for each row execute function app.set_updated_at();
create index bookings_tenant_idx on public.bookings (tenant_id, starts_at desc);
create index bookings_service_idx on public.bookings (service_id, starts_at);

alter table public.bookable_services enable row level security;
alter table public.bookable_services force row level security;
create policy bookable_services_select on public.bookable_services
  for select using (app.has_permission(tenant_id, 'bookings.read'));
create policy bookable_services_insert on public.bookable_services
  for insert with check (app.has_permission(tenant_id, 'bookings.write'));
create policy bookable_services_update on public.bookable_services
  for update using (app.has_permission(tenant_id, 'bookings.write'))
  with check (app.has_permission(tenant_id, 'bookings.write'));

alter table public.bookings enable row level security;
alter table public.bookings force row level security;
create policy bookings_select on public.bookings
  for select using (app.has_permission(tenant_id, 'bookings.read'));
create policy bookings_update on public.bookings
  for update using (app.has_permission(tenant_id, 'bookings.write'))
  with check (app.has_permission(tenant_id, 'bookings.write'));
-- No insert policy for authenticated/anon on bookings — every booking is
-- written by the Agent's own service-role client (create_booking tool
-- handler), same posture as leads/orders.

insert into public.permissions (key, module, description) values
  ('bookings.read', 'bookings', 'View bookable services and bookings'),
  ('bookings.write', 'bookings', 'Manage bookable services and booking status');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key in ('business_owner', 'business_admin')
  and p.key in ('bookings.read', 'bookings.write');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key = 'staff' and p.key = 'bookings.read';
