-- Super Admin Master Spec — Business Types configuration. business_types
-- has only ever had a select policy (world-readable, seed data). Adding
-- new business types (or retiring one via is_active) is a real platform
-- configuration decision — mirrors the subscription_plans insert/update
-- pattern from 20260928020000_super_admin_plans.sql. No delete: a
-- business_type_key is a foreign key target from tenants, so retiring one
-- is is_active = false, same reasoning as that migration's own.
create policy business_types_insert on public.business_types
  for insert with check (app.is_super_admin());
create policy business_types_update on public.business_types
  for update using (app.is_super_admin()) with check (app.is_super_admin());
