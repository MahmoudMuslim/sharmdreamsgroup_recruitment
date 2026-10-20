-- The four roles Supabase creates for every project, and the login role
-- PostgREST connects as before switching into one of them.
--
-- Roles live in the cluster, not the database, and `create role` has no IF NOT
-- EXISTS, so these DO blocks exist to make a manual `psql -f` re-run of this
-- file against an existing cluster safe. They do not make a repair automatic:
-- docker-entrypoint-initdb.d runs only while PGDATA is empty, so a first boot
-- that aborts partway leaves a half-built cluster this file never sees again,
-- and that case still needs `npm run docker:wipe`.
--
-- The `else` branches re-assert every attribute, not just existence, so a
-- drifted role converges back on a manual re-run. The one that matters is
-- NOINHERIT on `authenticator`: if that login role ever became inheriting it
-- would hold `service_role`'s BYPASSRLS without any `SET ROLE`, and a request
-- whose `SET ROLE` failed would run with bypass.
--
-- `service_role` gets BYPASSRLS because the app's service client is meant to
-- reach every row; that is what src/lib/supabase/service.ts assumes today.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  else
    alter role anon with nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  else
    alter role authenticated with nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  else
    alter role service_role with nologin noinherit bypassrls;
  end if;
end $$;

-- The login role. This password must equal LOCAL_PGRST_PASSWORD in docker/.env.
-- It is a local dev credential by design; KVM2 replaces the whole file from a
-- secret that never enters the repo.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'sdg_pgrst_local';
  else
    alter role authenticator with noinherit login password 'sdg_pgrst_local';
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;

-- supabase/schema.sql grants object-level privileges to these roles, so they
-- must be able to hold the schemas it creates.
grant usage on schema public to anon, authenticated, service_role;
