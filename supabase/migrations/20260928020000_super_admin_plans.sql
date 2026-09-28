-- Super Admin Master Spec, Phase 3 — Subscriptions & Plans management.
-- subscription_plans has only ever had a select policy (world-readable to
-- authenticated users); Super Admin needs insert/update to manage plans
-- through the app. Mirrors the insert/update/delete split already used for
-- ai_model_configs in 20260927240001_hardening.sql — except there is
-- deliberately no delete policy here: subscription_plans.key is a
-- foreign key target from subscriptions and subscription_payments, so
-- deleting a plan a tenant has ever been on would break that history;
-- retiring a plan is `is_active = false`, the same soft-disable already
-- used for tenants.status.
create policy subscription_plans_insert on public.subscription_plans
  for insert with check (app.is_super_admin());
create policy subscription_plans_update on public.subscription_plans
  for update using (app.is_super_admin()) with check (app.is_super_admin());
