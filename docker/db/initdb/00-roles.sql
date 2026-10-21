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
-- `authenticator` is NOINHERIT so that `SET ROLE` stays the only way to obtain
-- any role's privileges. An INHERIT login role automatically exercises the
-- object privileges granted to `anon`, `authenticated` and `service_role`,
-- service_role's broad table grants included, so one request could act with the
-- union of three roles without ever switching. Attributes are a different thing
-- and are not inherited at all: membership in a BYPASSRLS role does not make the
-- member bypass RLS. That is why PostgREST must `SET ROLE`, and why RLS stays
-- enforced on the connection role.
--
-- Each branch spells the complete desired attribute list, because `alter role
-- ... with` only sets the options it names and never strips one a drifted
-- cluster added — the `no...` keywords are what remove a stray bypassrls,
-- superuser, createrole or createdb. The direction that matters is `anon` and
-- `authenticated`: PGRST_DB_ANON_ROLE switches every tokenless request into
-- anon, so a bypassrls or superuser on either of them is a real RLS bypass. The
-- file converges the attributes it lists and nothing else — not membership
-- beyond the `grant` below, not rolconnlimit, not rolvaliduntil.
--
-- `service_role` keeps BYPASSRLS because the app's service client is meant to
-- reach every row; that is what src/lib/data-api/service.ts assumes today.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit nobypassrls nosuperuser nocreaterole nocreatedb;
  else
    alter role anon with nologin noinherit nobypassrls nosuperuser nocreaterole nocreatedb;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit nobypassrls nosuperuser nocreaterole nocreatedb;
  else
    alter role authenticated with nologin noinherit nobypassrls nosuperuser nocreaterole nocreatedb;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls nosuperuser nocreaterole nocreatedb;
  else
    alter role service_role with nologin noinherit bypassrls nosuperuser nocreaterole nocreatedb;
  end if;
end $$;

-- The login role. The literal below is ONLY the first-boot default:
-- db/initdb/05-set-pgrst-password.sh runs after this file on a fresh volume and
-- resets the password from LOCAL_PGRST_PASSWORD, so on any host whose
-- docker/.env carries a value that one is authoritative and this literal never
-- survives. Keep them equal only for a host that has no LOCAL_PGRST_PASSWORD set
-- at all; PGRST_DB_URI is built from `${LOCAL_PGRST_PASSWORD}`, so a role
-- password that does not match it means `rest` cannot connect.
-- Rotating the value later takes a wipe, not a restart, because initdb runs only
-- while PGDATA is empty — see the rotation rule in docs/DEPLOYMENT.md.
--
-- It is a local dev credential by design; on KVM2 the secrets file replaces the
-- value and 05-*.sh applies it.
--
-- No `nologin` here: Postgres does NOT let the last keyword win — `create role
-- authenticator nologin … login …` raises `ERROR: conflicting or redundant
-- options` and aborts the whole initdb pass, leaving a half-built volume.
-- `login` alone is what this role needs, and the else-branch re-asserts exactly
-- the keyword list this line sets (including NOINHERIT) so a re-run converges
-- attributes rather than only existence.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login nobypassrls nosuperuser nocreaterole nocreatedb password 'sdg_pgrst_local';
  else
    alter role authenticator with noinherit login nobypassrls nosuperuser nocreaterole nocreatedb password 'sdg_pgrst_local';
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;

-- db/schema.sql grants object-level privileges to these roles, so they
-- must be able to hold the schemas it creates.
grant usage on schema public to anon, authenticated, service_role;
