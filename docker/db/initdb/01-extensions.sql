-- supabase/schema.sql line 27-32 creates these itself with `if not exists`, so
-- this file only has to make sure the schema exists and the roles can reach it.
-- It does NOT create supabase_vault: nothing in src/ uses Vault (spec §12), and
-- a vanilla image cannot.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
