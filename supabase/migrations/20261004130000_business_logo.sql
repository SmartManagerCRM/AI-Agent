-- The business's own logo, uploaded by the owner in Settings and shown next
-- to the business name in the console sidebar and on the customer Agent.
-- The file lives in the public `catalog-images` bucket
-- ("<tenant_id>/logo-<hash>.webp", re-encoded by the server like product
-- photos); this column holds its path. Owners and admins change it through
-- the existing `tenants_update` policy (settings.write); nothing else changes.
alter table public.tenants
  add column logo_path text check (logo_path is null or length(logo_path) between 1 and 300);
