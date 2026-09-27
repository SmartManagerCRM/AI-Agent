-- Phase 1 — Foundation. Seed reference data: currencies (spec §77), business
-- types (spec §78), system permissions/roles (spec §22), and platform
-- defaults (spec §76). No tenant, plan or subscription data is seeded here —
-- there is no demo tenant until Phase 2+ needs one to develop against.

insert into public.currencies (code, exponent, name) values
  ('SAR', 2, '{"en": "Saudi Riyal", "ar": "ريال سعودي", "fr": "Riyal saoudien"}'),
  ('USD', 2, '{"en": "US Dollar", "ar": "دولار أمريكي", "fr": "Dollar américain"}'),
  ('EUR', 2, '{"en": "Euro", "ar": "يورو", "fr": "Euro"}'),
  ('GBP', 2, '{"en": "British Pound", "ar": "جنيه إسترليني", "fr": "Livre sterling"}'),
  ('TND', 3, '{"en": "Tunisian Dinar", "ar": "دينار تونسي", "fr": "Dinar tunisien"}'),
  ('AED', 2, '{"en": "UAE Dirham", "ar": "درهم إماراتي", "fr": "Dirham des Émirats"}'),
  ('QAR', 2, '{"en": "Qatari Riyal", "ar": "ريال قطري", "fr": "Riyal qatari"}'),
  ('KWD', 3, '{"en": "Kuwaiti Dinar", "ar": "دينار كويتي", "fr": "Dinar koweïtien"}'),
  ('BHD', 3, '{"en": "Bahraini Dinar", "ar": "دينار بحريني", "fr": "Dinar bahreïni"}'),
  ('OMR', 3, '{"en": "Omani Rial", "ar": "ريال عماني", "fr": "Rial omanais"}'),
  ('TRY', 2, '{"en": "Turkish Lira", "ar": "ليرة تركية", "fr": "Livre turque"}');

insert into public.business_types (key, name) values
  ('restaurant', '{"en": "Restaurant", "ar": "مطعم", "fr": "Restaurant"}'),
  ('cafe', '{"en": "Café", "ar": "مقهى", "fr": "Café"}'),
  ('salon', '{"en": "Salon", "ar": "صالون", "fr": "Salon de coiffure"}'),
  ('spa', '{"en": "Spa", "ar": "سبا", "fr": "Spa"}'),
  ('gym', '{"en": "Gym", "ar": "نادي رياضي", "fr": "Salle de sport"}'),
  ('clinic', '{"en": "Clinic", "ar": "عيادة", "fr": "Clinique"}'),
  ('service_business', '{"en": "Service business", "ar": "نشاط خدمي", "fr": "Entreprise de services"}'),
  ('engineering', '{"en": "Engineering company", "ar": "شركة هندسية", "fr": "Bureau d''ingénierie"}'),
  ('other', '{"en": "Other", "ar": "أخرى", "fr": "Autre"}');

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

-- ── Permissions (Phase 1 core set — more arrive with each later phase) ──
insert into public.permissions (key, module, description) values
  ('business.read', 'business', 'View business profile'),
  ('business.write', 'business', 'Edit business profile'),
  ('settings.read', 'settings', 'View tenant/agent settings'),
  ('settings.write', 'settings', 'Edit tenant/agent settings'),
  ('staff.read', 'staff', 'View staff members'),
  ('staff.write', 'staff', 'Invite/manage staff members'),
  ('audit.read', 'audit', 'View the tenant audit log'),
  ('brain.read', 'brain', 'View Business Brain content'),
  ('brain.write', 'brain', 'Edit/approve Business Brain content'),
  ('agent.read', 'agent', 'View agent conversations'),
  ('agent.write', 'agent', 'Configure the AI agent');

-- ── System roles (spec §22): business_owner, business_admin, staff ──────
insert into public.roles (tenant_id, key, name) values
  (null, 'business_owner', '{"en": "Owner", "ar": "المالك", "fr": "Propriétaire"}'),
  (null, 'business_admin', '{"en": "Admin", "ar": "مدير", "fr": "Administrateur"}'),
  (null, 'staff', '{"en": "Staff", "ar": "موظف", "fr": "Employé"}');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key = 'business_owner';

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key = 'business_admin'
  and p.key <> 'staff.write';

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key = 'staff'
  and p.key in ('business.read', 'settings.read', 'brain.read', 'agent.read');
