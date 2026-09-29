-- Performance: indexes for query patterns the console actually runs that no
-- existing index serves. Each one names the query it exists for. Nothing
-- here changes data, constraints or RLS; every index is additive.

-- Tenant dashboard/analytics/customers aggregates and the dashboard's
-- "5 most recent orders": WHERE tenant_id = ? [AND created_at >= ?]
-- ORDER BY created_at DESC. (orders_tenant_idx leads with status, so it
-- can't serve a tenant-wide created_at scan.)
create index if not exists orders_tenant_created_idx on public.orders (tenant_id, created_at desc);

-- Orders page: WHERE tenant_id = ? ORDER BY placed_at DESC LIMIT 100 —
-- orders_tenant_idx is (tenant_id, status, placed_at), unusable for the
-- all-statuses list without a status equality.
create index if not exists orders_tenant_placed_idx on public.orders (tenant_id, placed_at desc);

-- Dashboard "top products": every order item for one tenant, grouped by
-- name. order_items had no tenant_id index at all.
create index if not exists order_items_tenant_idx on public.order_items (tenant_id);

-- Business Brain page, now paginated: WHERE tenant_id = ? AND status IN
-- (...) ORDER BY created_at DESC, id LIMIT/OFFSET.
create index if not exists business_brain_entries_tenant_created_idx
  on public.business_brain_entries (tenant_id, created_at desc);

-- Products page, now paginated: WHERE tenant_id = ? ORDER BY created_at
-- DESC, id LIMIT/OFFSET (products_tenant_idx is (tenant_id, status)).
create index if not exists products_tenant_created_idx on public.products (tenant_id, created_at desc);

-- Analytics funnel "carts started": WHERE tenant_id = ? AND created_at >= ?
-- — cart_items was only indexed by cart_id/product_id.
create index if not exists cart_items_tenant_created_idx on public.cart_items (tenant_id, created_at);

-- Super Admin AI Cost Guard alerts (every Super Admin page) and the AI
-- usage tile: platform-wide WHERE created_at >= ? on the fastest-growing
-- table; the existing index leads with tenant_id.
create index if not exists agent_interactions_created_idx on public.agent_interactions (created_at);

-- Super Admin anomaly alerts (every Super Admin page), conversation KPI
-- windows and the growth chart: platform-wide WHERE started_at >= ?.
create index if not exists conversations_started_idx on public.conversations (started_at);

-- Super Admin "recent activity" and audit-log page: platform-wide
-- ORDER BY at DESC LIMIT n (audit_logs_tenant_idx leads with tenant_id).
create index if not exists audit_logs_at_idx on public.audit_logs (at desc);
