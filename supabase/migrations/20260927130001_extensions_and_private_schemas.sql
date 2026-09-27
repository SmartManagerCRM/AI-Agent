-- Phase 1 — Foundation. Extensions and the private `app` schema (RLS helper
-- functions live here; it is not exposed through PostgREST).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists btree_gist;
create extension if not exists unaccent;

create schema if not exists app;
comment on schema app is 'Private helpers (RLS predicates, triggers). Not exposed via the API.';

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
