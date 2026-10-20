-- Everything Supabase hosts in the `auth` schema that our own policies touch.
-- 80 of the 94 policies reach identity through auth.uid() indirectly, via
-- is_staff() (66), has_permission() (41), is_super_admin() (12),
-- current_user_profile_id() (12) and user_tenant_id() (11).

create schema if not exists auth;

-- The migrated directory. Plan 2 keeps this table and writes it directly;
-- spec §5 requires encrypted_password to survive the dump restore, and PG17
-- pgcrypto compares bcrypt ($2a$) hashes, so no Node dependency is needed.
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
-- 'a'). The explicit cast is an I/O conversion, which is legal here.
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
