-- ============================================================================
-- Multiple API keys per provider with failover support
-- ============================================================================

-- Drop and recreate provider_credentials to support multiple keys per provider
drop table if exists provider_credentials cascade;

create table provider_credentials (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  -- Priority determines failover order (1 = primary, 2 = secondary, etc.)
  priority integer not null default 1,
  -- The actual secret, encrypted
  secret_encrypted text not null,
  -- Hint for identification (last 4 chars, nickname, etc.)
  secret_hint text,
  -- Non-secret config (base URLs, IDs, etc.)
  config jsonb not null default '{}',
  -- Secondary secrets (app secrets, webhook secrets, etc.) - encrypted
  extra_secrets_encrypted jsonb,
  is_active boolean not null default true,
  last_verified_at timestamptz,
  last_verified_status text,
  last_verified_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure one active key per provider per priority
create unique index provider_credentials_provider_priority_key
  on provider_credentials (provider, priority)
  where is_active = true;

drop trigger if exists trg_provider_credentials_updated on provider_credentials;
create trigger trg_provider_credentials_updated before update on provider_credentials
  for each row execute function set_updated_at();

-- Enable RLS (service-role only - no policies)
alter table provider_credentials enable row level security;

comment on table provider_credentials is
  'Multiple API keys per provider with priority-based failover. RLS enabled with zero policies — service role only.';

-- Also add provider_models table for dynamic model catalog per provider
create table if not exists provider_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model_id text not null,
  name text not null,
  prompt_price_per_million numeric,
  completion_price_per_million numeric,
  context_length integer,
  is_free boolean default false,
  context_window_category text, -- 'small', 'medium', 'large', 'xlarge'
  capabilities text[] default '{}', -- e.g., ['chat', 'completion', 'json_mode', 'function_calling']
  is_active boolean default true,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index provider_models_provider_model_id_key on provider_models (provider, model_id);
create index provider_models_provider_active_idx on provider_models (provider, is_active);
create index provider_models_price_idx on provider_models (prompt_price_per_million, completion_price_per_million);

drop trigger if exists trg_provider_models_updated on provider_models;
create trigger trg_provider_models_updated before update on provider_models
  for each row execute function set_updated_at();

alter table provider_models enable row level security;
-- Public read for active models, service role for writes
create policy provider_models_public_read on provider_models
  for select using (is_active = true);