-- Multi-source Business Brain addendum. Same anon-execute cleanup as every
-- prior hardening migration.
revoke execute on function public.resolve_brain_conflict(uuid, jsonb) from anon;
