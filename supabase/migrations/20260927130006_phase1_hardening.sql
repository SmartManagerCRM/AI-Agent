-- Phase 1 — Foundation. Fixes for the security advisor findings raised right
-- after the initial Phase 1 migrations: extensions relocated out of `public`,
-- a mutable search_path pinned, and anonymous execution of the two
-- SECURITY DEFINER RPCs explicitly revoked (both already reject a caller
-- with no session, but the grant itself should not exist for `anon`).

alter extension citext set schema extensions;
alter extension pg_trgm set schema extensions;
alter extension btree_gist set schema extensions;
alter extension unaccent set schema extensions;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.create_business(jsonb, text, text, text, char(3)) from anon;
revoke execute on function public.my_tenant_memberships() from anon;
