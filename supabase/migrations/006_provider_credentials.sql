-- ============================================================================
-- Provider credentials + AI model selection, manageable from Settings.
--
-- SECURITY MODEL
--   * Secrets are encrypted with AES-256-GCM before storage (key lives in the
--     SETTINGS_ENCRYPTION_KEY env var, never in the database).
--   * `secret_hint` holds the last 4 characters only, for display. It is the
--     ONLY secret-derived column the UI may ever read.
--   * Row Level Security denies anon and ordinary staff outright; the tables
--     are reachable only through the service-role client inside server
--     actions, which keeps secrets off the wire entirely.
--   * Every write is recorded in credential_audit_log.
-- ============================================================================

create table if not exists provider_credentials (
  id uuid primary key default gen_random_uuid(),
  -- Stable key that maps to an env var, e.g. OPENROUTER_API_KEY -> 'openrouter'
  provider text not null unique,
  display_name text not null,
  -- Which .env variable this row overrides when present.
  env_var_name text not null,
  -- base64( iv(12) || ciphertext || authTag(16) )
  secret_encrypted text not null,
  -- Last 4 characters only. NEVER the full value.
  secret_hint text not null,
  -- Non-secret settings (base urls, phone ids, client ids).
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_verified_at timestamptz,
  last_verified_status text,
  last_verified_detail text,
  created_by uuid references user_profiles (id) on delete set null,
  updated_by uuid references user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_provider_credentials_updated on provider_credentials;
create trigger trg_provider_credentials_updated before update on provider_credentials
  for each row execute function set_updated_at();

-- Per-capability model routing. Not secret, so this is readable by staff.
create table if not exists ai_model_config (
  capability text primary key,
  -- OpenRouter model id, e.g. 'google/gemma-3-27b-it:free'
  primary_model text not null,
  fallback_model text,
  temperature numeric(3,2) not null default 0.30,
  max_tokens integer not null default 1200,
  is_enabled boolean not null default true,
  updated_by uuid references user_profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists credential_audit_log (
  id uuid primary key default gen_random_uuid(),
  provider text,
  action text not null,
  actor_id uuid references user_profiles (id) on delete set null,
  -- Deliberately stores only non-secret context.
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_credential_audit_created
  on credential_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: enabled, then locked down. The service role bypasses RLS, which is how
-- the server actions reach these rows. No client role can read them at all.
-- ---------------------------------------------------------------------------
alter table provider_credentials enable row level security;
alter table ai_model_config enable row level security;
alter table credential_audit_log enable row level security;

drop policy if exists ai_model_config_read on ai_model_config;
create policy ai_model_config_read on ai_model_config
  for select using (is_staff());

-- No SELECT policy on provider_credentials or credential_audit_log: RLS with
-- zero policies denies everything to anon and authenticated users. Only the
-- service-role client (server actions) can read them.

-- ---------------------------------------------------------------------------
-- Seed the model routing table from the env defaults so the UI has something
-- to show before anyone has opened it.
-- ---------------------------------------------------------------------------
insert into ai_model_config (capability, primary_model, fallback_model) values
  ('resume_screening',     'google/gemma-4-31b-it:free',      'google/gemma-4-26b-a4b-it:free'),
  ('soft_skills',          'nvidia/nemotron-3.5-lightning:free', 'google/gemma-4-31b-it:free'),
  ('case_reasoning',       'deepseek/deepseek-r1:free',      'google/gemma-4-31b-it:free'),
  ('feedback',             'google/gemma-4-31b-it:free',      'google/gemma-4-26b-a4b-it:free'),
  ('interview_questions',  'nvidia/nemotron-3.5-lightning:free', 'google/gemma-4-31b-it:free'),
  ('transcription',        'google/gemma-4-31b-it:free',      'google/gemma-4-26b-a4b-it:free')
on conflict (capability) do nothing;