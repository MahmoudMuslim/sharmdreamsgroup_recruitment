-- ============================================================================
-- Fix the uniqueness model on app_settings.
--
-- Postgres treats NULL as distinct inside a UNIQUE constraint, so
-- UNIQUE (scope, company_id, key) never matched GLOBAL rows (company_id IS
-- NULL) and PostgREST's ON CONFLICT fell through to an INSERT, colliding on
-- the primary key. UNIQUE NULLS NOT DISTINCT (Postgres 15+) treats NULLs as
-- equal, so the ordinary conflict target works for both scopes.
-- ============================================================================

alter table app_settings
  drop constraint if exists app_settings_scope_company_id_key_key;
alter table app_settings
  drop constraint if exists app_settings_scope_company_id_key;

drop index if exists app_settings_global_key_uniq;
drop index if exists app_settings_tenant_key_uniq;

do $$
begin
  alter table app_settings
    add constraint app_settings_scope_company_key_uniq
    unique nulls not distinct (scope, company_id, key);
exception
  when duplicate_object then null;
  when duplicate_table then null;
end $$;