-- Phase 11 — Hardening (spec §98, final phase). A pass over every prior
-- phase's own output rather than a new feature: this is the first
-- migration in the whole project written in response to the Supabase
-- advisor's *performance* lints (`get_advisors(type: "performance")`) —
-- every prior phase only ever checked `type: "security"`.

-- ── auth_rls_initplan: three policies called `auth.uid()` directly in
--    their predicate, forcing Postgres to re-evaluate it once per row
--    instead of once per statement. Wrapping it as `(select auth.uid())`
--    lets the planner treat it as a stable sub-select evaluated once —
--    same predicate, faster at scale. Nested calls through
--    `app.is_super_admin()`/`app.is_tenant_member()` elsewhere are
--    unaffected (those are themselves STABLE functions, not a raw
--    `auth.uid()` in the policy body). ───────────────────────────────────
alter policy profiles_select on public.profiles
  using (
    id = (select auth.uid())
    or app.is_super_admin()
    or exists (
      select 1 from public.tenant_members tm1
      join public.tenant_members tm2 on tm2.tenant_id = tm1.tenant_id
      where tm1.user_id = (select auth.uid()) and tm1.status = 'active'
        and tm2.user_id = profiles.id and tm2.status = 'active'
    )
  );

alter policy profiles_update on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy tenant_members_select on public.tenant_members
  using (user_id = (select auth.uid()) or app.is_tenant_member(tenant_id) or app.is_super_admin());

-- ── multiple_permissive_policies: ai_model_configs_select (select, using
--    true) and ai_model_configs_write (for all, using is_super_admin())
--    both apply to every SELECT — Postgres must evaluate and OR both
--    permissive policies for every read, when _select alone already
--    covers it. Splitting _write into insert/update/delete removes the
--    overlap without changing what anyone can actually do. ─────────────
drop policy ai_model_configs_write on public.ai_model_configs;
create policy ai_model_configs_insert on public.ai_model_configs
  for insert with check (app.is_super_admin());
create policy ai_model_configs_update on public.ai_model_configs
  for update using (app.is_super_admin()) with check (app.is_super_admin());
create policy ai_model_configs_delete on public.ai_model_configs
  for delete using (app.is_super_admin());

-- ── unindexed_foreign_keys: 27 were flagged; most are reference-table FKs
--    (currency/role/plan_key codes) joined from small, rarely-filtered
--    tables where an index adds write overhead for no real read benefit
--    at this project's scale — left as-is, revisit if usage grows. These
--    are the ones actually on a hot path today (cart/order line-item
--    lookups, tenant-scoped RLS filtering, and the staff page's join). ──
create index cart_items_product_idx on public.cart_items (product_id);
create index order_items_product_idx on public.order_items (product_id);
create index orders_branch_idx on public.orders (branch_id);
create index orders_cart_idx on public.orders (cart_id);
create index orders_conversation_idx on public.orders (conversation_id);
create index tenant_members_role_idx on public.tenant_members (role_id);
create index payments_tenant_idx on public.payments (tenant_id);
create index conversation_messages_tenant_idx on public.conversation_messages (tenant_id);
create index carts_branch_idx on public.carts (branch_id);
