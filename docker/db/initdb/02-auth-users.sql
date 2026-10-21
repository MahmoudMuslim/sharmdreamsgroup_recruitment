-- Everything Supabase hosts in the `auth` schema that our own policies touch.
-- Re-measured on the running local stack (2026-10-21) with
-- `docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T db
-- psql -U postgres -d sharm_dreams` (the same door as `npm run docker:psql`) and
-- the CTE at the bottom of this comment, against the 88 policies in `public`:
--   is_staff() 55, has_permission() 24, current_user_profile_id() 10,
--   is_super_admin() 9, user_tenant_id() 5, a direct auth.uid() in 3 (1 of those
--   also calls a helper). THESE OVERLAP — one policy can call two helpers — so
--   they sum above the 80 they describe: 80 of the 88 reach an identity door.
--   5 more are addressed by the `attempt_token` claim instead (2 of those also
--   reach identity), and 5 reach neither: `applications_public_insert`,
--   `tenants_read` and `provider_models_public_read`, whose whole qual is
--   `true`/`is_active`, plus the two `files` rules keyed on bucket and path
--   prefix. Those five stand on the `anon` grant, not on a claim.
--
--   with p as (
--     select policyname as name,
--            coalesce(qual, '') || ' ' || coalesce(with_check, '') as src
--       from pg_policies where schemaname = 'public')
--   select count(*) total,
--          count(*) filter (where src like '%is_staff(%')                     is_staff,
--          count(*) filter (where src like '%has_permission(%')               has_permission,
--          count(*) filter (where src like '%current_user_profile_id(%')      cur_profile,
--          count(*) filter (where src like '%is_super_admin(%')               is_super_admin,
--          count(*) filter (where src like '%user_tenant_id(%')               user_tenant,
--          count(*) filter (where src like '%auth.uid(%')                     direct_uid,
--          count(*) filter (where src ~ '(is_staff\(|has_permission\(|current_user_profile_id\(|is_super_admin\(|user_tenant_id\(|auth\.uid\()') reaches_identity,
--          count(*) filter (where src like '%attempt_token%')                 attempt_door,
--          count(*) filter (where src like '%attempt_token%'
--                 and src ~ '(is_staff\(|has_permission\(|current_user_profile_id\(|is_super_admin\(|user_tenant_id\(|auth\.uid\()') attempt_and_identity,
--          count(*) filter (where src !~ '(is_staff\(|has_permission\(|current_user_profile_id\(|is_super_admin\(|user_tenant_id\(|auth\.uid\()'
--                 and src not like '%attempt_token%')                          reaches_neither
--     from p;

create schema if not exists auth;

-- The migrated directory. Plan 2 keeps this table and writes it directly;
-- spec §5 requires encrypted_password to survive the dump restore, and pgcrypto
-- compares bcrypt ($2a$) hashes, so no Node dependency is needed. Re-measured on
-- postgres:18.6-alpine3.24: 18 added a separate core `hash_bcrypt()` and left
-- `crypt()`/`gen_salt('bf')` alone, so all three seeded staff rows verify t/t/t.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text not null default 'authenticated',
  role text not null default 'authenticated',
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Correction #2 vs the old stub: modern PostgREST sets only the JSON
-- `request.jwt.claims` GUC. The stub's `request.jwt.claim.sub` (singular) never
-- exists, which is why the proof passed without ever proving evaluation.
-- The cast must wrap the WHOLE expression: `(… ->> 'sub')::uuid`. A SQL function
-- declared `returns uuid` cannot simply SELECT a text value — measured on
-- postgres:17-alpine, that shape fails at CREATE FUNCTION with `return type
-- mismatch in function declared to return uuid / Actual return type is text`,
-- because pg_cast has no text→uuid row (castcontext would have to be 'i' or
-- 'a'). The explicit cast is an I/O conversion, which is legal here — and still
-- required on 18.6, where this file creates the same three functions without
-- error.
create or replace function auth.uid() returns uuid
language sql stable as
$$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;

create or replace function auth.jwt() returns jsonb
language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create or replace function auth.role() returns text
language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                    current_setting('role', true)) $$;

grant usage on schema auth to anon, authenticated, service_role;
grant select, insert, update, delete on auth.users to service_role;
grant execute on function auth.uid(), auth.jwt(), auth.role()
  to anon, authenticated, service_role;
