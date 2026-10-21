-- Throwaway stand-in for the pieces Supabase hosts outside the project's own
-- schema, so supabase/schema.sql can be applied on a vanilla Postgres.
-- Local proof only; never applied to the hosted project.
--
-- It now matches what the real stack stands in: `docker/db/initdb/` brings up
-- the roles, the extensions and `auth.users`, and nothing else. The `storage`
-- half of this file — two tables, the foldername helper and their policies — was
-- deleted with Plan 2 Task 10, so this proof applies the schema of record with no
-- storage schema in reach, which is the shape the shipping stack has.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema extensions;
create schema vault;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as
  $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create publication supabase_realtime;

grant usage on schema auth, extensions, vault to anon, authenticated, service_role;
grant all on all tables in schema auth to service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
