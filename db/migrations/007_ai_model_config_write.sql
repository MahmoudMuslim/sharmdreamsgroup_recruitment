-- ============================================================================
-- Allow staff to UPDATE ai_model_config.
--
-- 006_provider_credentials.sql created ai_model_config with a SELECT-only
-- policy, so the Settings → AI models save was silently rejected by RLS even
-- though the server action had already checked the permission. Writes now
-- require the same permission the action enforces.
-- ============================================================================

drop policy if exists ai_model_config_write on ai_model_config;
create policy ai_model_config_write on ai_model_config
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));