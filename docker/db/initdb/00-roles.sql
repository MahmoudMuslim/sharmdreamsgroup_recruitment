-- The four roles Supabase creates for every project, and the login role
-- PostgREST connects as before switching into one of them.
--
-- Roles live in the cluster, not the database, so these DO blocks exist because
-- `create role` has no IF NOT EXISTS and a developer who wipes only the database
-- (not the volume) would otherwise get a hard failure here.
--
-- `service_role` gets BYPASSRLS because the app's service client is meant to
-- reach every row; that is what src/lib/supabase/service.ts assumes today.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- The login role. This password must equal LOCAL_PGRST_PASSWORD in docker/.env.
-- It is a local dev credential by design; KVM2 replaces the whole file from a
-- secret that never enters the repo.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'sdg_pgrst_local';
  else
    alter role authenticator with login password 'sdg_pgrst_local';
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;

-- supabase/schema.sql grants object-level privileges to these roles, so they
-- must be able to hold the schemas it creates.
grant usage on schema public to anon, authenticated, service_role;
