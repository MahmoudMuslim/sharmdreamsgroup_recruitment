/*
 * Sharm Dreams Talent Cloud — schema of record.
 *
 * Generated from the live project, so this file describes the database instead
 * of intending to: every statement is Postgres' own pg_get_* definer. The design
 * reasoning behind any single object lives in supabase/migrations/001-*.sql.
 *
 * The SEED DATA block at the end is the one section this file authors rather
 * than dumps. Regenerate with:
 *
 *   node scripts/dump-schema.mjs > supabase/schema.sql
 *   node scripts/verify-schema.mjs supabase/schema.sql   # must report no gaps
 *
 * Order is dependency-driven, because this file has to apply on an empty
 * database: extensions and enums, then every table, then uniqueness, then the
 * foreign keys that point at it, then functions, then the indexes and policies
 * that call those functions. It applies on a Supabase project — some policies
 * reference auth.uid() and storage.objects — but not on vanilla Postgres, and
 * the reference rows the console needs (permissions, roles, notification
 * templates, currencies, ai_model_config) come from supabase/migrations/, not
 * from here.
 */

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

create schema if not exists extensions;
create extension if not exists "pg_stat_statements" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
create schema if not exists vault;
create extension if not exists "supabase_vault" with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- ============================================================================
-- ENUM TYPES — label order is the sort order, so it is load-bearing
-- ============================================================================

do $$ begin
  create type public.app_role as enum ('SUPER_ADMIN', 'SUBSIDIARY_HR_MANAGER', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'CANDIDATE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.application_source as enum ('LINKEDIN', 'WHATSAPP', 'JOB_BOARD', 'CAREER_SITE', 'REFERRAL', 'ATS_IMPORT');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.application_stage as enum ('NEW', 'AI_SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.ats_provider as enum ('GREENHOUSE', 'LEVER', 'FRAPPE_HR', 'LINKEDIN_APPLY');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.attempt_status as enum ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'GRADED', 'EXPIRED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.business_sector as enum ('HOSPITALITY', 'REAL_ESTATE', 'COMMERCIAL_DEVELOPMENT', 'CORPORATE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.calendar_provider as enum ('GOOGLE', 'MICROSOFT', 'MANUAL');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.integration_status as enum ('CONNECTED', 'PENDING', 'ERROR', 'DISCONNECTED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.integrity_event_type as enum ('FOCUS_LOST', 'TAB_HIDDEN', 'PASTE_BLOCKED', 'PASTE_DETECTED', 'COPY_DETECTED', 'FULLSCREEN_EXIT', 'MULTI_DEVICE', 'AI_PASTE_SUSPECTED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.integrity_severity as enum ('INFO', 'WARN', 'CRITICAL');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.interview_status as enum ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.invite_status as enum ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.job_status as enum ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.message_channel as enum ('WHATSAPP', 'EMAIL', 'IN_APP');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.message_direction as enum ('INBOUND', 'OUTBOUND');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.question_type as enum ('EXCEL_MODEL', 'VIDEO_PITCH', 'CASE_STUDY', 'MULTIPLE_CHOICE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.settings_scope as enum ('GLOBAL', 'TENANT');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.user_role as enum ('SUPER_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'CANDIDATE');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- SEQUENCES
-- ============================================================================

create sequence if not exists public.application_tracking_seq;

-- ============================================================================
-- TABLES
-- ============================================================================

create table if not exists public.ai_model_config (
  capability text,
  primary_model text,
  fallback_model text,
  temperature numeric(3,2) default 0.30,
  max_tokens integer default 1200,
  is_enabled boolean default true,
  updated_by uuid,
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (capability)
);
create table if not exists public.app_settings (
  id uuid default gen_random_uuid(),
  scope settings_scope default 'GLOBAL'::settings_scope,
  company_id uuid,
  key text,
  value jsonb default 'null'::jsonb,
  description text,
  is_secret boolean default false,
  updated_by uuid,
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.applicants (
  id text,
  applicant_name text,
  email_address text,
  phone_number text,
  company text,
  custom_business_sector text,
  job_title text,
  custom_acquisition_source text default 'Direct Career Portal'::text,
  status text default 'Applied'::text,
  custom_ai_score numeric,
  skill_match_score numeric,
  cultural_fit_score numeric,
  soft_skills_score numeric,
  radar_scores jsonb,
  matched_skills jsonb default '[]'::jsonb,
  missing_skills jsonb default '[]'::jsonb,
  custom_ai_summary text,
  custom_ai_strengths text,
  custom_ai_red_flags text,
  custom_suggested_interview_questions text,
  custom_raw_cv_text text,
  custom_whatsapp_chat_id text,
  interviews jsonb default '[]'::jsonb,
  sentiment_analysis jsonb,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.application_gate_questions (
  id uuid default gen_random_uuid(),
  job_id uuid,
  question text,
  help_text text,
  options jsonb default '[]'::jsonb,
  position integer default 0,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
comment on table public.application_gate_questions is 'No-points viability questions shown on the public application form. An answer marked as not passing rejects the application at submission time.';
create table if not exists public.applications (
  id uuid default gen_random_uuid(),
  job_id uuid,
  full_name text,
  email text,
  phone text,
  cv_file_path text,
  cv_text text,
  tracking_code text,
  stage application_stage default 'NEW'::application_stage,
  source application_source default 'CAREER_SITE'::application_source,
  ai_match_score numeric,
  ai_screening_summary text,
  ai_strengths jsonb,
  ai_gaps jsonb,
  ai_soft_skills jsonb,
  ai_feedback text,
  diversity_flags jsonb,
  rejection_reason text,
  hired_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  gate_answers jsonb,
  archived_at timestamp with time zone,
  PRIMARY KEY (id)
);
create table if not exists public.assessment_questions (
  id uuid default gen_random_uuid(),
  template_id uuid,
  question_type question_type,
  title text,
  prompt text,
  config jsonb default '{}'::jsonb,
  points integer default 10,
  position integer default 0,
  time_limit_minutes integer,
  shuffle_options boolean default false,
  instructions text,
  PRIMARY KEY (id)
);
create table if not exists public.assessment_templates (
  id uuid default gen_random_uuid(),
  tenant_id uuid,
  name text,
  description text default ''::text,
  role_family text default 'GENERAL'::text,
  time_limit_minutes integer default 60,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  randomize_questions boolean default false,
  randomize_options boolean default false,
  block_copy_paste boolean default true,
  PRIMARY KEY (id)
);
create table if not exists public.assistant_messages (
  id uuid default gen_random_uuid(),
  session_id uuid,
  owner_id uuid,
  role text,
  content text,
  steps jsonb default '[]'::jsonb,
  model text,
  provider text,
  note text,
  attachment_name text,
  attachment_text text,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.assistant_sessions (
  id uuid default gen_random_uuid(),
  owner_id uuid,
  title text default 'New conversation'::text,
  engine text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
comment on table public.assistant_sessions is 'One saved assistant conversation per staff member. RLS: owner only.';
create table if not exists public.ats_integrations (
  id uuid default gen_random_uuid(),
  tenant_id uuid,
  provider ats_provider,
  status integration_status default 'PENDING'::integration_status,
  credentials jsonb,
  webhook_secret text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.candidate_attempts (
  id uuid default gen_random_uuid(),
  application_id uuid,
  template_id uuid,
  access_token text,
  status attempt_status default 'NOT_STARTED'::attempt_status,
  time_limit_minutes integer default 60,
  started_at timestamp with time zone,
  expires_at timestamp with time zone,
  submitted_at timestamp with time zone,
  total_score numeric,
  max_score numeric,
  draft_saved_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  current_index_hint integer default 0,
  integrity_score integer,
  integrity_flags integer default 0,
  question_order uuid[],
  option_order jsonb,
  PRIMARY KEY (id)
);
create table if not exists public.candidate_responses (
  id uuid default gen_random_uuid(),
  attempt_id uuid,
  question_id uuid,
  answer_text text,
  spreadsheet_state jsonb,
  video_path text,
  video_duration_seconds integer,
  transcript text,
  score numeric,
  max_score integer default 10,
  ai_evaluation jsonb,
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.candidate_skills (
  application_id uuid,
  skill_id uuid,
  proficiency integer default 1,
  source text default 'AI_SCREENING'::text,
  PRIMARY KEY (application_id, skill_id)
);
create table if not exists public.communication_logs (
  id uuid default gen_random_uuid(),
  application_id uuid,
  channel message_channel,
  direction message_direction,
  recipient text,
  body text,
  delivered boolean default false,
  error_message text,
  created_at timestamp with time zone default now(),
  subject text,
  read_at timestamp with time zone,
  prospect_id uuid,
  PRIMARY KEY (id)
);
create table if not exists public.credential_audit_log (
  id uuid default gen_random_uuid(),
  provider text,
  action text,
  actor_id uuid,
  detail text,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.currencies (
  id uuid default gen_random_uuid(),
  code text,
  symbol text,
  label text,
  is_active boolean default true,
  sort_order integer default 100,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
comment on table public.currencies is 'ISO 4217 currencies job salaries can be denominated in. RLS is enabled with explicit policies because rls_auto_enable() only turns RLS on, it does not grant access.';
create table if not exists public.departments (
  id uuid default gen_random_uuid(),
  tenant_id uuid,
  name text,
  slug text,
  description text,
  head_profile_id uuid,
  is_active boolean default true,
  sort_order integer default 100,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.integrity_events (
  id uuid default gen_random_uuid(),
  attempt_id uuid,
  question_id uuid,
  event_type integrity_event_type,
  severity integrity_severity default 'INFO'::integrity_severity,
  detail text,
  session_fingerprint text,
  device_label text,
  occurred_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.interview_schedules (
  id uuid default gen_random_uuid(),
  application_id uuid,
  interviewer_profile_id uuid,
  scheduled_at timestamp with time zone,
  duration_minutes integer default 45,
  calendar_provider calendar_provider default 'MANUAL'::calendar_provider,
  calendar_event_id text,
  meeting_link text,
  status interview_status default 'SCHEDULED'::interview_status,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.job_openings (
  id uuid default gen_random_uuid(),
  tenant_id uuid,
  title text,
  department text,
  sector business_sector,
  location text,
  employment_type text default 'FULL_TIME'::text,
  description text,
  requirements jsonb default '[]'::jsonb,
  min_salary_usd integer,
  max_salary_usd integer,
  status job_status default 'DRAFT'::job_status,
  posted_at timestamp with time zone,
  closing_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone default now(),
  salary_currency text default 'USD'::text,
  PRIMARY KEY (id)
);
create table if not exists public.jobs (
  id text,
  title text,
  department text,
  company text,
  business_sector text,
  location text,
  type text default 'Full-time'::text,
  salary_range text,
  required_skills jsonb default '[]'::jsonb,
  preferred_skills jsonb default '[]'::jsonb,
  cultural_values jsonb default '[]'::jsonb,
  description text,
  status text default 'Active'::text,
  applicants_count integer default 0,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.locations (
  id uuid default gen_random_uuid(),
  tenant_id uuid,
  name text,
  city text,
  governorate text,
  country text default 'Egypt'::text,
  timezone text default 'Africa/Cairo'::text,
  address text,
  is_active boolean default true,
  sort_order integer default 100,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.notification_templates (
  id uuid default gen_random_uuid(),
  key text,
  channel text,
  subject text,
  body text,
  is_active boolean default true,
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.onboarding_plans (
  id uuid default gen_random_uuid(),
  application_id uuid,
  tenant_id uuid,
  checklist jsonb default '[]'::jsonb,
  skill_gaps jsonb default '[]'::jsonb,
  internal_mobility_suggestions jsonb default '[]'::jsonb,
  retention_risk_score numeric,
  progress numeric default 0,
  generated_by_ai boolean default false,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.permissions (
  key text,
  label text,
  group_name text,
  description text,
  PRIMARY KEY (key)
);
create table if not exists public.provider_credentials (
  id uuid default gen_random_uuid(),
  provider text,
  priority integer default 1,
  secret_encrypted text,
  secret_hint text,
  config jsonb default '{}'::jsonb,
  extra_secrets_encrypted jsonb,
  is_active boolean default true,
  last_verified_at timestamp with time zone,
  last_verified_status text,
  last_verified_detail text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
comment on table public.provider_credentials is 'Multiple API keys per provider with priority-based failover. RLS enabled with zero policies — service role only.';
create table if not exists public.provider_models (
  id uuid default gen_random_uuid(),
  provider text,
  model_id text,
  name text,
  prompt_price_per_million numeric,
  completion_price_per_million numeric,
  context_length integer,
  is_free boolean default false,
  context_window_category text,
  capabilities text[] default '{}'::text[],
  is_active boolean default true,
  fetched_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.role_families (
  id uuid default gen_random_uuid(),
  key text,
  label text,
  description text,
  department_id uuid,
  is_active boolean default true,
  sort_order integer default 100,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.role_family_skills (
  role_family_id uuid,
  skill_id uuid,
  required_level integer default 3,
  weight numeric(3,2) default 1.00,
  PRIMARY KEY (role_family_id, skill_id)
);
create table if not exists public.role_permissions (
  role_key app_role,
  permission_key text,
  granted boolean default true,
  PRIMARY KEY (role_key, permission_key)
);
create table if not exists public.roles (
  id uuid default gen_random_uuid(),
  key app_role,
  label text,
  description text,
  is_system boolean default true,
  PRIMARY KEY (id)
);
create table if not exists public.scheduled_whatsapp_jobs (
  id uuid default gen_random_uuid(),
  application_id uuid,
  recipient_phone text,
  scheduled_for timestamp with time zone default now(),
  payload jsonb,
  status text default 'PENDING'::text,
  attempts integer default 0,
  error_log text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.settings_audit_log (
  id uuid default gen_random_uuid(),
  key text,
  company_id uuid,
  previous_value jsonb,
  next_value jsonb,
  changed_by uuid,
  changed_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.skills (
  id uuid default gen_random_uuid(),
  name text,
  category text,
  description text,
  is_active boolean default true,
  sort_order integer default 100,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.sourced_prospects (
  id uuid default gen_random_uuid(),
  full_name text,
  headline text,
  company text,
  location text,
  email text,
  phone text,
  linkedin_url text,
  notes text,
  origin text default 'LINKEDIN'::text,
  stage text default 'NEW'::text,
  job_id uuid,
  application_id uuid,
  created_by uuid,
  last_contacted_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  profile jsonb,
  profile_url text,
  profile_source text,
  profile_captured_at timestamp with time zone,
  profile_error text,
  PRIMARY KEY (id)
);
comment on table public.sourced_prospects is 'People a recruiter found off-pipeline (LinkedIn, an event, a referral) and loaded here to work on. Not applications: no tracking code, no candidate portal access until they are converted.';
create table if not exists public.tenants_and_companies (
  id uuid default gen_random_uuid(),
  name text,
  slug text,
  sector business_sector,
  country text default 'Egypt'::text,
  created_at timestamp with time zone default now(),
  legal_name text,
  logo_url text,
  website text,
  contact_email text,
  contact_phone text,
  address text,
  city text,
  is_active boolean default true,
  sort_order integer default 100,
  PRIMARY KEY (id)
);
create table if not exists public.user_invites (
  id uuid default gen_random_uuid(),
  email text,
  full_name text,
  role app_role default 'RECRUITER'::app_role,
  company_id uuid,
  status invite_status default 'PENDING'::invite_status,
  invited_by uuid,
  expires_at timestamp with time zone default (now() + '7 days'::interval),
  accepted_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
create table if not exists public.user_profiles (
  id uuid default gen_random_uuid(),
  auth_user_id uuid,
  tenant_id uuid,
  full_name text,
  email text,
  phone text,
  role user_role default 'CANDIDATE'::user_role,
  avatar_url text,
  locale text default 'en'::text,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
do $$ begin
  alter table public.app_settings add constraint app_settings_scope_company_key_uniq UNIQUE NULLS NOT DISTINCT (scope, company_id, key);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.application_gate_questions add constraint application_gate_questions_help_text_check CHECK (((help_text IS NULL) OR (char_length(btrim(help_text)) <= 400)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.application_gate_questions add constraint application_gate_questions_options_check CHECK ((jsonb_typeof(options) = 'array'::text));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.application_gate_questions add constraint application_gate_questions_question_check CHECK (((char_length(btrim(question)) >= 3) AND (char_length(btrim(question)) <= 400)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.applications add constraint applications_tracking_code_key UNIQUE (tracking_code);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.assessment_questions add constraint assessment_questions_points_check CHECK ((points > 0));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.assessment_templates add constraint assessment_templates_time_limit_minutes_check CHECK (((time_limit_minutes >= 5) AND (time_limit_minutes <= 300)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.assistant_messages add constraint assistant_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.assistant_sessions add constraint assistant_sessions_engine_check CHECK ((engine = ANY (ARRAY['auto'::text, 'qoder'::text, 'gateway'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.ats_integrations add constraint ats_integrations_tenant_id_provider_key UNIQUE (tenant_id, provider);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.candidate_attempts add constraint candidate_attempts_access_token_key UNIQUE (access_token);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.candidate_responses add constraint candidate_responses_attempt_id_question_id_key UNIQUE (attempt_id, question_id);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.candidate_skills add constraint candidate_skills_proficiency_check CHECK (((proficiency >= 1) AND (proficiency <= 5)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.currencies add constraint currencies_code_key UNIQUE (code);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.interview_schedules add constraint interview_schedules_duration_minutes_check CHECK (((duration_minutes >= 15) AND (duration_minutes <= 240)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.job_openings add constraint job_openings_employment_type_check CHECK ((employment_type = ANY (ARRAY['FULL_TIME'::text, 'PART_TIME'::text, 'CONTRACT'::text, 'INTERNSHIP'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.notification_templates add constraint notification_templates_channel_check CHECK ((channel = ANY (ARRAY['EMAIL'::text, 'WHATSAPP'::text, 'IN_APP'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.notification_templates add constraint notification_templates_key_channel_key UNIQUE (key, channel);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.onboarding_plans add constraint onboarding_plans_application_id_key UNIQUE (application_id);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.onboarding_plans add constraint onboarding_plans_progress_check CHECK (((progress >= (0)::numeric) AND (progress <= (100)::numeric)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.role_families add constraint role_families_key_key UNIQUE (key);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.role_family_skills add constraint role_family_skills_required_level_check CHECK (((required_level >= 1) AND (required_level <= 5)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.roles add constraint roles_key_key UNIQUE (key);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.scheduled_whatsapp_jobs add constraint scheduled_whatsapp_jobs_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'FAILED'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.skills add constraint skills_name_key UNIQUE (name);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.sourced_prospects add constraint sourced_prospects_full_name_check CHECK (((char_length(full_name) >= 2) AND (char_length(full_name) <= 160)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.sourced_prospects add constraint sourced_prospects_origin_check CHECK ((origin = ANY (ARRAY['LINKEDIN'::text, 'CSV'::text, 'MANUAL'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.sourced_prospects add constraint sourced_prospects_profile_source_check CHECK ((profile_source = ANY (ARRAY['URL'::text, 'PASTE'::text, 'FILE'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.sourced_prospects add constraint sourced_prospects_stage_check CHECK ((stage = ANY (ARRAY['NEW'::text, 'CONTACTED'::text, 'REPLIED'::text, 'INTERVIEW'::text, 'CONVERTED'::text, 'PASSED'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.tenants_and_companies add constraint tenants_and_companies_slug_key UNIQUE (slug);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.user_profiles add constraint user_profiles_auth_user_id_key UNIQUE (auth_user_id);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.user_profiles add constraint user_profiles_locale_check CHECK ((locale = ANY (ARRAY['en'::text, 'ar'::text, 'ru'::text, 'de'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.ai_model_config add constraint ai_model_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.app_settings add constraint app_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES tenants_and_companies(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.app_settings add constraint app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.application_gate_questions add constraint application_gate_questions_job_id_fkey FOREIGN KEY (job_id) REFERENCES job_openings(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.applications add constraint applications_job_id_fkey FOREIGN KEY (job_id) REFERENCES job_openings(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.assessment_questions add constraint assessment_questions_template_id_fkey FOREIGN KEY (template_id) REFERENCES assessment_templates(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.assessment_templates add constraint assessment_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants_and_companies(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.assistant_messages add constraint assistant_messages_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.assistant_messages add constraint assistant_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES assistant_sessions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.assistant_sessions add constraint assistant_sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.ats_integrations add constraint ats_integrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants_and_companies(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.candidate_attempts add constraint candidate_attempts_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.candidate_attempts add constraint candidate_attempts_template_id_fkey FOREIGN KEY (template_id) REFERENCES assessment_templates(id) ON DELETE RESTRICT;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.candidate_responses add constraint candidate_responses_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES candidate_attempts(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.candidate_responses add constraint candidate_responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.candidate_skills add constraint candidate_skills_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.candidate_skills add constraint candidate_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.communication_logs add constraint communication_logs_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.communication_logs add constraint communication_logs_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES sourced_prospects(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.credential_audit_log add constraint credential_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.departments add constraint departments_head_profile_id_fkey FOREIGN KEY (head_profile_id) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.departments add constraint departments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants_and_companies(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.integrity_events add constraint integrity_events_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES candidate_attempts(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.integrity_events add constraint integrity_events_question_id_fkey FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.interview_schedules add constraint interview_schedules_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.interview_schedules add constraint interview_schedules_interviewer_profile_id_fkey FOREIGN KEY (interviewer_profile_id) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.job_openings add constraint job_openings_created_by_fkey FOREIGN KEY (created_by) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.job_openings add constraint job_openings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants_and_companies(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.locations add constraint locations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants_and_companies(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.onboarding_plans add constraint onboarding_plans_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.onboarding_plans add constraint onboarding_plans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants_and_companies(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.role_families add constraint role_families_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.role_family_skills add constraint role_family_skills_role_family_id_fkey FOREIGN KEY (role_family_id) REFERENCES role_families(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.role_family_skills add constraint role_family_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.role_permissions add constraint role_permissions_permission_key_fkey FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.role_permissions add constraint role_permissions_role_key_fkey FOREIGN KEY (role_key) REFERENCES roles(key) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.scheduled_whatsapp_jobs add constraint scheduled_whatsapp_jobs_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.settings_audit_log add constraint settings_audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.settings_audit_log add constraint settings_audit_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES tenants_and_companies(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.sourced_prospects add constraint sourced_prospects_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.sourced_prospects add constraint sourced_prospects_created_by_fkey FOREIGN KEY (created_by) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.sourced_prospects add constraint sourced_prospects_job_id_fkey FOREIGN KEY (job_id) REFERENCES job_openings(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.user_invites add constraint user_invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES tenants_and_companies(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.user_invites add constraint user_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.user_profiles add constraint user_profiles_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.user_profiles add constraint user_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants_and_companies(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.ai_model_config enable row level security;
alter table public.app_settings enable row level security;
alter table public.applicants enable row level security;
alter table public.application_gate_questions enable row level security;
alter table public.applications enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_templates enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_sessions enable row level security;
alter table public.ats_integrations enable row level security;
alter table public.candidate_attempts enable row level security;
alter table public.candidate_responses enable row level security;
alter table public.candidate_skills enable row level security;
alter table public.communication_logs enable row level security;
alter table public.credential_audit_log enable row level security;
alter table public.currencies enable row level security;
alter table public.departments enable row level security;
alter table public.integrity_events enable row level security;
alter table public.interview_schedules enable row level security;
alter table public.job_openings enable row level security;
alter table public.jobs enable row level security;
alter table public.locations enable row level security;
alter table public.notification_templates enable row level security;
alter table public.onboarding_plans enable row level security;
alter table public.permissions enable row level security;
alter table public.provider_credentials enable row level security;
alter table public.provider_models enable row level security;
alter table public.role_families enable row level security;
alter table public.role_family_skills enable row level security;
alter table public.role_permissions enable row level security;
alter table public.roles enable row level security;
alter table public.scheduled_whatsapp_jobs enable row level security;
alter table public.settings_audit_log enable row level security;
alter table public.skills enable row level security;
alter table public.sourced_prospects enable row level security;
alter table public.tenants_and_companies enable row level security;
alter table public.user_invites enable row level security;
alter table public.user_profiles enable row level security;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_tracking_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.tracking_code is null or btrim(new.tracking_code) = '' then
    new.tracking_code := generate_tracking_code();
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.current_user_profile()
 RETURNS user_profiles
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from user_profiles where auth_user_id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.current_user_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from user_profiles where auth_user_id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.generate_tracking_code()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no I, L, O, 0, 1
  suffix text := '';
  i integer;
begin
  for i in 1 .. 6 loop
    suffix := suffix || substr(
      alphabet,
      1 + floor(random() * length(alphabet))::integer,
      1
    );
  end loop;

  return 'SDG-' || suffix || '-' || lpad(
    (nextval('application_tracking_seq'))::text, 5, '0'
  );
end;
$function$;
comment on function public.generate_tracking_code() is 'Collision-safe, unguessable application tracking code. Unique via a sequence; non-enumerable via a random 6-character block.';
CREATE OR REPLACE FUNCTION public.has_permission(permission_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from user_profiles up
    join role_permissions rp on rp.role_key::text = up.role::text
    where up.auth_user_id = auth.uid()
      and rp.permission_key = permission_name
      and rp.granted
  );
$function$;
CREATE OR REPLACE FUNCTION public.has_role(role_names text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from user_profiles
    where auth_user_id = auth.uid()
      and role::text = any (role_names)
  );
$function$;
CREATE OR REPLACE FUNCTION public.integrity_severity_weight(kind text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case kind
    when 'CRITICAL' then 10
    when 'WARN' then 4
    else 1
  end;
$function$;
CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select role in ('SUPER_ADMIN', 'RECRUITER', 'HIRING_MANAGER')
     from user_profiles where auth_user_id = auth.uid()),
    false
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select role = 'SUPER_ADMIN' from user_profiles where auth_user_id = auth.uid()),
    false
  );
$function$;
CREATE OR REPLACE FUNCTION public.normalise_invite_email()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_attempt_integrity(target_attempt uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update candidate_attempts a
  set integrity_flags = coalesce(t.flags, 0),
      integrity_score = greatest(0, 100 - coalesce(t.penalty, 0))
  from (
    select
      count(*)::int as flags,
      coalesce(sum(case e.severity
        when 'CRITICAL' then 10
        when 'WARN' then 4
        else 1 end), 0)::int as penalty
    from integrity_events e
    where e.attempt_id = target_attempt
  ) t
  where a.id = target_attempt;
$function$;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select tenant_id from user_profiles where auth_user_id = auth.uid();
$function$;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_app_settings_key ON public.app_settings USING btree (key);
CREATE INDEX IF NOT EXISTS idx_gate_questions_active ON public.application_gate_questions USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_gate_questions_scope ON public.application_gate_questions USING btree (job_id, "position");
CREATE UNIQUE INDEX IF NOT EXISTS applications_one_live_per_job ON public.applications USING btree (job_id, lower(email)) WHERE ((stage = ANY (ARRAY['NEW'::application_stage, 'AI_SCREENING'::application_stage, 'ASSESSMENT'::application_stage, 'INTERVIEW'::application_stage, 'OFFER'::application_stage])) AND (archived_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_applications_created ON public.applications USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_applications_job ON public.applications USING btree (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_live ON public.applications USING btree (created_at DESC) WHERE (archived_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON public.applications USING btree (stage);
CREATE INDEX IF NOT EXISTS idx_assessment_questions_template ON public.assessment_questions USING btree (template_id);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_session_created ON public.assistant_messages USING btree (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assistant_sessions_owner_updated ON public.assistant_sessions USING btree (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidate_attempts_application ON public.candidate_attempts USING btree (application_id);
CREATE INDEX IF NOT EXISTS idx_candidate_attempts_token ON public.candidate_attempts USING btree (access_token);
CREATE INDEX IF NOT EXISTS idx_candidate_responses_attempt ON public.candidate_responses USING btree (attempt_id);
CREATE INDEX IF NOT EXISTS idx_communication_logs_application ON public.communication_logs USING btree (application_id);
CREATE INDEX IF NOT EXISTS idx_communication_logs_prospect ON public.communication_logs USING btree (prospect_id, created_at DESC) WHERE (prospect_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_communication_logs_unread ON public.communication_logs USING btree (application_id, created_at DESC) WHERE ((channel = 'IN_APP'::message_channel) AND (read_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_credential_audit_created ON public.credential_audit_log USING btree (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS departments_global_slug_uniq ON public.departments USING btree (slug) WHERE (tenant_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS departments_tenant_slug_uniq ON public.departments USING btree (tenant_id, slug) WHERE (tenant_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_departments_tenant ON public.departments USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_integrity_events_attempt ON public.integrity_events USING btree (attempt_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_interview_schedules_application ON public.interview_schedules USING btree (application_id);
CREATE INDEX IF NOT EXISTS idx_job_openings_status ON public.job_openings USING btree (status);
CREATE INDEX IF NOT EXISTS idx_job_openings_tenant ON public.job_openings USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_locations_tenant ON public.locations USING btree (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS locations_global_name_uniq ON public.locations USING btree (name, city) WHERE (tenant_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS locations_tenant_name_uniq ON public.locations USING btree (tenant_id, name, city) WHERE (tenant_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_provider_priority_key ON public.provider_credentials USING btree (provider, priority) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS provider_models_price_idx ON public.provider_models USING btree (prompt_price_per_million, completion_price_per_million);
CREATE INDEX IF NOT EXISTS provider_models_provider_active_idx ON public.provider_models USING btree (provider, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS provider_models_provider_model_id_key ON public.provider_models USING btree (provider, model_id);
CREATE INDEX IF NOT EXISTS idx_role_families_department ON public.role_families USING btree (department_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_whatsapp_jobs_application ON public.scheduled_whatsapp_jobs USING btree (application_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_whatsapp_jobs_due ON public.scheduled_whatsapp_jobs USING btree (scheduled_for) WHERE (status = 'PENDING'::text);
CREATE INDEX IF NOT EXISTS idx_settings_audit_key ON public.settings_audit_log USING btree (key, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_skills_category ON public.skills USING btree (category);
CREATE INDEX IF NOT EXISTS idx_sourced_prospects_job ON public.sourced_prospects USING btree (job_id);
CREATE INDEX IF NOT EXISTS idx_sourced_prospects_stage ON public.sourced_prospects USING btree (stage, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sourced_prospects_linkedin_key ON public.sourced_prospects USING btree (lower(TRIM(BOTH FROM linkedin_url))) WHERE ((linkedin_url IS NOT NULL) AND (btrim(linkedin_url) <> ''::text));
CREATE INDEX IF NOT EXISTS idx_companies_active ON public.tenants_and_companies USING btree (is_active, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS user_invites_pending_email_uniq ON public.user_invites USING btree (lower(email)) WHERE (status = 'PENDING'::invite_status);

-- ============================================================================
-- POLICIES
-- ============================================================================

drop policy if exists "ai_model_config_read" on public.ai_model_config;
create policy "ai_model_config_read" on public.ai_model_config
  for SELECT
  to public
  using (is_staff());
drop policy if exists "ai_model_config_write" on public.ai_model_config;
create policy "ai_model_config_write" on public.ai_model_config
  for ALL
  to public
  using (has_permission('settings.manage_platform'::text))
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "app_settings_read" on public.app_settings;
create policy "app_settings_read" on public.app_settings
  for SELECT
  to public
  using (is_staff());
drop policy if exists "app_settings_write" on public.app_settings;
create policy "app_settings_write" on public.app_settings
  for ALL
  to public
  using (has_permission('settings.manage_platform'::text))
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "Allow authenticated insert applicants" on public.applicants;
create policy "Allow authenticated insert applicants" on public.applicants
  for INSERT
  to public
  with check (true);
drop policy if exists "Allow authenticated update applicants" on public.applicants;
create policy "Allow authenticated update applicants" on public.applicants
  for UPDATE
  to public
  using (true);
drop policy if exists "Allow public read applicants" on public.applicants;
create policy "Allow public read applicants" on public.applicants
  for SELECT
  to public
  using (true);
drop policy if exists "gate_questions_manager_write" on public.application_gate_questions;
create policy "gate_questions_manager_write" on public.application_gate_questions
  for ALL
  to public
  using (has_permission('jobs.manage'::text))
  with check (has_permission('jobs.manage'::text));
drop policy if exists "gate_questions_public_read" on public.application_gate_questions;
create policy "gate_questions_public_read" on public.application_gate_questions
  for SELECT
  to public
  using ((is_staff() OR is_active));
drop policy if exists "applications_candidate_self" on public.applications;
create policy "applications_candidate_self" on public.applications
  for SELECT
  to public
  using ((EXISTS ( SELECT 1
   FROM user_profiles up
  WHERE ((up.auth_user_id = auth.uid()) AND (up.role = 'CANDIDATE'::user_role) AND (lower(up.email) = lower(applications.email))))));
drop policy if exists "applications_public_insert" on public.applications;
create policy "applications_public_insert" on public.applications
  for INSERT
  to public
  with check (true);
drop policy if exists "applications_staff_read" on public.applications;
create policy "applications_staff_read" on public.applications
  for SELECT
  to public
  using ((is_staff() AND (is_super_admin() OR (user_tenant_id() IS NULL) OR (user_tenant_id() IN ( SELECT job_openings.tenant_id
   FROM job_openings
  WHERE (job_openings.id = applications.job_id))))));
drop policy if exists "applications_staff_write" on public.applications;
create policy "applications_staff_write" on public.applications
  for ALL
  to public
  using ((is_staff() AND (is_super_admin() OR (user_tenant_id() IS NULL) OR (user_tenant_id() IN ( SELECT job_openings.tenant_id
   FROM job_openings
  WHERE (job_openings.id = applications.job_id))))))
  with check ((is_staff() AND (is_super_admin() OR (user_tenant_id() IS NULL) OR (user_tenant_id() IN ( SELECT job_openings.tenant_id
   FROM job_openings
  WHERE (job_openings.id = applications.job_id))))));
drop policy if exists "questions_read" on public.assessment_questions;
create policy "questions_read" on public.assessment_questions
  for SELECT
  to public
  using ((EXISTS ( SELECT 1
   FROM assessment_templates t
  WHERE ((t.id = assessment_questions.template_id) AND (t.is_active OR is_staff())))));
drop policy if exists "questions_staff_write" on public.assessment_questions;
create policy "questions_staff_write" on public.assessment_questions
  for ALL
  to public
  using (is_staff())
  with check (is_staff());
drop policy if exists "assessment_templates_staff_read" on public.assessment_templates;
create policy "assessment_templates_staff_read" on public.assessment_templates
  for SELECT
  to public
  using (is_staff());
drop policy if exists "templates_staff_read" on public.assessment_templates;
create policy "templates_staff_read" on public.assessment_templates
  for SELECT
  to public
  using ((is_active OR is_staff()));
drop policy if exists "templates_staff_write" on public.assessment_templates;
create policy "templates_staff_write" on public.assessment_templates
  for ALL
  to public
  using (is_staff())
  with check (is_staff());
drop policy if exists "assistant_messages_owner_delete" on public.assistant_messages;
create policy "assistant_messages_owner_delete" on public.assistant_messages
  for DELETE
  to authenticated
  using ((( SELECT current_user_profile_id() AS current_user_profile_id) = owner_id));
drop policy if exists "assistant_messages_owner_insert" on public.assistant_messages;
create policy "assistant_messages_owner_insert" on public.assistant_messages
  for INSERT
  to authenticated
  with check (((( SELECT current_user_profile_id() AS current_user_profile_id) = owner_id) AND is_staff()));
drop policy if exists "assistant_messages_owner_read" on public.assistant_messages;
create policy "assistant_messages_owner_read" on public.assistant_messages
  for SELECT
  to authenticated
  using (((( SELECT current_user_profile_id() AS current_user_profile_id) = owner_id) AND is_staff()));
drop policy if exists "assistant_sessions_owner_delete" on public.assistant_sessions;
create policy "assistant_sessions_owner_delete" on public.assistant_sessions
  for DELETE
  to authenticated
  using ((( SELECT current_user_profile_id() AS current_user_profile_id) = owner_id));
drop policy if exists "assistant_sessions_owner_insert" on public.assistant_sessions;
create policy "assistant_sessions_owner_insert" on public.assistant_sessions
  for INSERT
  to authenticated
  with check (((( SELECT current_user_profile_id() AS current_user_profile_id) = owner_id) AND is_staff()));
drop policy if exists "assistant_sessions_owner_read" on public.assistant_sessions;
create policy "assistant_sessions_owner_read" on public.assistant_sessions
  for SELECT
  to authenticated
  using (((( SELECT current_user_profile_id() AS current_user_profile_id) = owner_id) AND is_staff()));
drop policy if exists "assistant_sessions_owner_update" on public.assistant_sessions;
create policy "assistant_sessions_owner_update" on public.assistant_sessions
  for UPDATE
  to authenticated
  using ((( SELECT current_user_profile_id() AS current_user_profile_id) = owner_id))
  with check ((( SELECT current_user_profile_id() AS current_user_profile_id) = owner_id));
drop policy if exists "ats_read" on public.ats_integrations;
create policy "ats_read" on public.ats_integrations
  for SELECT
  to public
  using ((is_super_admin() OR (is_staff() AND (tenant_id = user_tenant_id()))));
drop policy if exists "ats_write" on public.ats_integrations;
create policy "ats_write" on public.ats_integrations
  for ALL
  to public
  using (is_super_admin())
  with check (is_super_admin());
drop policy if exists "attempts_staff_write" on public.candidate_attempts;
create policy "attempts_staff_write" on public.candidate_attempts
  for ALL
  to public
  using (is_staff())
  with check (is_staff());
drop policy if exists "attempts_token_read" on public.candidate_attempts;
create policy "attempts_token_read" on public.candidate_attempts
  for SELECT
  to public
  using ((is_staff() OR ( SELECT (((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'attempt_token'::text) = candidate_attempts.access_token))));
drop policy if exists "responses_staff_all" on public.candidate_responses;
create policy "responses_staff_all" on public.candidate_responses
  for ALL
  to public
  using (is_staff())
  with check (is_staff());
drop policy if exists "responses_token_insert" on public.candidate_responses;
create policy "responses_token_insert" on public.candidate_responses
  for INSERT
  to public
  with check ((( SELECT ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'attempt_token'::text)) IN ( SELECT candidate_attempts.access_token
   FROM candidate_attempts
  WHERE (candidate_attempts.id = candidate_responses.attempt_id))));
drop policy if exists "responses_token_read" on public.candidate_responses;
create policy "responses_token_read" on public.candidate_responses
  for SELECT
  to public
  using ((is_staff() OR (( SELECT ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'attempt_token'::text)) IN ( SELECT candidate_attempts.access_token
   FROM candidate_attempts
  WHERE (candidate_attempts.id = candidate_responses.attempt_id)))));
drop policy if exists "responses_token_update" on public.candidate_responses;
create policy "responses_token_update" on public.candidate_responses
  for UPDATE
  to public
  using ((( SELECT ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'attempt_token'::text)) IN ( SELECT candidate_attempts.access_token
   FROM candidate_attempts
  WHERE (candidate_attempts.id = candidate_responses.attempt_id))))
  with check (true);
drop policy if exists "candidate_skills_read" on public.candidate_skills;
create policy "candidate_skills_read" on public.candidate_skills
  for SELECT
  to public
  using (is_staff());
drop policy if exists "candidate_skills_write" on public.candidate_skills;
create policy "candidate_skills_write" on public.candidate_skills
  for ALL
  to public
  using (is_staff())
  with check (is_staff());
drop policy if exists "comms_staff_read" on public.communication_logs;
create policy "comms_staff_read" on public.communication_logs
  for SELECT
  to public
  using (is_staff());
drop policy if exists "comms_staff_write" on public.communication_logs;
create policy "comms_staff_write" on public.communication_logs
  for ALL
  to public
  using (is_staff())
  with check (is_staff());
drop policy if exists "currencies_read" on public.currencies;
create policy "currencies_read" on public.currencies
  for SELECT
  to public
  using ((is_active OR is_staff()));
drop policy if exists "currencies_write" on public.currencies;
create policy "currencies_write" on public.currencies
  for ALL
  to public
  using (has_permission('settings.manage_platform'::text))
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "departments_read" on public.departments;
create policy "departments_read" on public.departments
  for SELECT
  to public
  using ((is_active OR is_staff()));
drop policy if exists "departments_write" on public.departments;
create policy "departments_write" on public.departments
  for ALL
  to public
  using (has_permission('settings.manage_platform'::text))
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "integrity_events_staff_read" on public.integrity_events;
create policy "integrity_events_staff_read" on public.integrity_events
  for SELECT
  to public
  using (is_staff());
drop policy if exists "interviews_staff_all" on public.interview_schedules;
create policy "interviews_staff_all" on public.interview_schedules
  for ALL
  to public
  using (is_staff())
  with check (is_staff());
drop policy if exists "jobs_public_read" on public.job_openings;
create policy "jobs_public_read" on public.job_openings
  for SELECT
  to public
  using (((status = 'PUBLISHED'::job_status) OR is_staff()));
drop policy if exists "jobs_staff_write" on public.job_openings;
create policy "jobs_staff_write" on public.job_openings
  for ALL
  to public
  using (is_staff())
  with check (is_staff());
drop policy if exists "Allow authenticated insert jobs" on public.jobs;
create policy "Allow authenticated insert jobs" on public.jobs
  for INSERT
  to public
  with check (true);
drop policy if exists "Allow authenticated update jobs" on public.jobs;
create policy "Allow authenticated update jobs" on public.jobs
  for UPDATE
  to public
  using (true);
drop policy if exists "Allow public read jobs" on public.jobs;
create policy "Allow public read jobs" on public.jobs
  for SELECT
  to public
  using (true);
drop policy if exists "locations_read" on public.locations;
create policy "locations_read" on public.locations
  for SELECT
  to public
  using ((is_active OR is_staff()));
drop policy if exists "locations_write" on public.locations;
create policy "locations_write" on public.locations
  for ALL
  to public
  using (has_permission('settings.manage_platform'::text))
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "notification_templates_read" on public.notification_templates;
create policy "notification_templates_read" on public.notification_templates
  for SELECT
  to public
  using (is_staff());
drop policy if exists "notification_templates_write" on public.notification_templates;
create policy "notification_templates_write" on public.notification_templates
  for ALL
  to public
  using (has_permission('settings.manage_platform'::text))
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "onboarding_staff_all" on public.onboarding_plans;
create policy "onboarding_staff_all" on public.onboarding_plans
  for ALL
  to public
  using (is_staff())
  with check (is_staff());
drop policy if exists "permissions_read" on public.permissions;
create policy "permissions_read" on public.permissions
  for SELECT
  to public
  using (is_staff());
drop policy if exists "provider_models_public_read" on public.provider_models;
create policy "provider_models_public_read" on public.provider_models
  for SELECT
  to public
  using ((is_active = true));
drop policy if exists "role_families_read" on public.role_families;
create policy "role_families_read" on public.role_families
  for SELECT
  to public
  using ((is_active OR is_staff()));
drop policy if exists "role_families_write" on public.role_families;
create policy "role_families_write" on public.role_families
  for ALL
  to public
  using (has_permission('settings.manage_platform'::text))
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "role_family_skills_read" on public.role_family_skills;
create policy "role_family_skills_read" on public.role_family_skills
  for SELECT
  to public
  using (is_staff());
drop policy if exists "role_family_skills_write" on public.role_family_skills;
create policy "role_family_skills_write" on public.role_family_skills
  for ALL
  to public
  using (has_permission('settings.manage_platform'::text))
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "role_permissions_read" on public.role_permissions;
create policy "role_permissions_read" on public.role_permissions
  for SELECT
  to public
  using (is_staff());
drop policy if exists "role_permissions_write" on public.role_permissions;
create policy "role_permissions_write" on public.role_permissions
  for ALL
  to public
  using (has_permission('settings.manage_roles'::text))
  with check (has_permission('settings.manage_roles'::text));
drop policy if exists "roles_read" on public.roles;
create policy "roles_read" on public.roles
  for SELECT
  to public
  using (is_staff());
drop policy if exists "whatsapp_jobs_staff_read" on public.scheduled_whatsapp_jobs;
create policy "whatsapp_jobs_staff_read" on public.scheduled_whatsapp_jobs
  for SELECT
  to public
  using (is_staff());
drop policy if exists "settings_audit_read" on public.settings_audit_log;
create policy "settings_audit_read" on public.settings_audit_log
  for SELECT
  to public
  using (has_permission('settings.manage_platform'::text));
drop policy if exists "settings_audit_write" on public.settings_audit_log;
create policy "settings_audit_write" on public.settings_audit_log
  for INSERT
  to public
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "skills_read" on public.skills;
create policy "skills_read" on public.skills
  for SELECT
  to public
  using ((is_active OR is_staff()));
drop policy if exists "skills_write" on public.skills;
create policy "skills_write" on public.skills
  for ALL
  to public
  using (has_permission('settings.manage_platform'::text))
  with check (has_permission('settings.manage_platform'::text));
drop policy if exists "prospects_staff_read" on public.sourced_prospects;
create policy "prospects_staff_read" on public.sourced_prospects
  for SELECT
  to public
  using (is_staff());
drop policy if exists "prospects_staff_write" on public.sourced_prospects;
create policy "prospects_staff_write" on public.sourced_prospects
  for ALL
  to public
  using (has_permission('candidates.write'::text))
  with check (has_permission('candidates.write'::text));
drop policy if exists "companies_read" on public.tenants_and_companies;
create policy "companies_read" on public.tenants_and_companies
  for SELECT
  to public
  using ((is_active OR is_staff()));
drop policy if exists "companies_write" on public.tenants_and_companies;
create policy "companies_write" on public.tenants_and_companies
  for ALL
  to public
  using ((has_permission('companies.manage'::text) OR has_permission('settings.manage_platform'::text)))
  with check ((has_permission('companies.manage'::text) OR has_permission('settings.manage_platform'::text)));
drop policy if exists "tenants_admin_write" on public.tenants_and_companies;
create policy "tenants_admin_write" on public.tenants_and_companies
  for ALL
  to public
  using (is_super_admin())
  with check (is_super_admin());
drop policy if exists "tenants_read" on public.tenants_and_companies;
create policy "tenants_read" on public.tenants_and_companies
  for SELECT
  to public
  using (true);
drop policy if exists "user_invites_read" on public.user_invites;
create policy "user_invites_read" on public.user_invites
  for SELECT
  to public
  using (has_permission('settings.manage_users'::text));
drop policy if exists "user_invites_write" on public.user_invites;
create policy "user_invites_write" on public.user_invites
  for ALL
  to public
  using (has_permission('settings.manage_users'::text))
  with check (has_permission('settings.manage_users'::text));
drop policy if exists "profiles_admin_insert" on public.user_profiles;
create policy "profiles_admin_insert" on public.user_profiles
  for INSERT
  to public
  with check ((is_super_admin() OR is_staff()));
drop policy if exists "profiles_self_read" on public.user_profiles;
create policy "profiles_self_read" on public.user_profiles
  for SELECT
  to public
  using (((auth_user_id = auth.uid()) OR is_staff()));
drop policy if exists "profiles_self_update" on public.user_profiles;
create policy "profiles_self_update" on public.user_profiles
  for UPDATE
  to public
  using ((auth_user_id = auth.uid()))
  with check ((auth_user_id = auth.uid()));
drop policy if exists "candidate video uploads" on storage.objects;
create policy "candidate video uploads" on storage.objects
  for INSERT
  to anon, authenticated
  with check (((bucket_id = 'candidate-videos'::text) AND ((storage.foldername(name))[1] = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'attempt_token'::text))));
drop policy if exists "candidates upload cvs" on storage.objects;
create policy "candidates upload cvs" on storage.objects
  for INSERT
  to anon, authenticated
  with check ((bucket_id = 'candidate-cvs'::text));
drop policy if exists "public resume uploads" on storage.objects;
create policy "public resume uploads" on storage.objects
  for INSERT
  to anon
  with check (((bucket_id = 'resumes'::text) AND ((storage.foldername(name))[1] = 'public'::text)));
drop policy if exists "staff delete candidate cvs" on storage.objects;
create policy "staff delete candidate cvs" on storage.objects
  for DELETE
  to authenticated
  using (((bucket_id = 'candidate-cvs'::text) AND is_staff()));
drop policy if exists "staff delete candidate media" on storage.objects;
create policy "staff delete candidate media" on storage.objects
  for DELETE
  to authenticated
  using (((bucket_id = ANY (ARRAY['candidate-videos'::text, 'candidate-audio'::text, 'resumes'::text])) AND is_staff()));
drop policy if exists "staff read candidate cvs" on storage.objects;
create policy "staff read candidate cvs" on storage.objects
  for SELECT
  to authenticated
  using (((bucket_id = 'candidate-cvs'::text) AND is_staff()));
drop policy if exists "staff read candidate media" on storage.objects;
create policy "staff read candidate media" on storage.objects
  for SELECT
  to authenticated
  using (((bucket_id = ANY (ARRAY['candidate-videos'::text, 'candidate-audio'::text, 'resumes'::text])) AND is_staff()));

-- ============================================================================
-- TRIGGERS
-- ============================================================================

drop trigger if exists "trg_gate_questions_updated" on public.application_gate_questions;
CREATE TRIGGER trg_gate_questions_updated BEFORE UPDATE ON public.application_gate_questions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_applications_updated_at" on public.applications;
CREATE TRIGGER trg_applications_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_assign_tracking_code" on public.applications;
CREATE TRIGGER trg_assign_tracking_code BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION assign_tracking_code();
drop trigger if exists "trg_assistant_sessions_updated" on public.assistant_sessions;
CREATE TRIGGER trg_assistant_sessions_updated BEFORE UPDATE ON public.assistant_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_candidate_responses_updated_at" on public.candidate_responses;
CREATE TRIGGER trg_candidate_responses_updated_at BEFORE UPDATE ON public.candidate_responses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_currencies_updated" on public.currencies;
CREATE TRIGGER trg_currencies_updated BEFORE UPDATE ON public.currencies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_departments_updated" on public.departments;
CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_locations_updated" on public.locations;
CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_notification_templates_updated" on public.notification_templates;
CREATE TRIGGER trg_notification_templates_updated BEFORE UPDATE ON public.notification_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_provider_credentials_updated" on public.provider_credentials;
CREATE TRIGGER trg_provider_credentials_updated BEFORE UPDATE ON public.provider_credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_provider_models_updated" on public.provider_models;
CREATE TRIGGER trg_provider_models_updated BEFORE UPDATE ON public.provider_models FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_skills_updated" on public.skills;
CREATE TRIGGER trg_skills_updated BEFORE UPDATE ON public.skills FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_sourced_prospects_updated" on public.sourced_prospects;
CREATE TRIGGER trg_sourced_prospects_updated BEFORE UPDATE ON public.sourced_prospects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_user_invites_email" on public.user_invites;
CREATE TRIGGER trg_user_invites_email BEFORE INSERT OR UPDATE OF email ON public.user_invites FOR EACH ROW EXECUTE FUNCTION normalise_invite_email();

-- ============================================================================
-- COMMENTS
-- ============================================================================

comment on column public.applications.gate_answers is '[{question, answer, passed}] as answered on the careers form. Stored even when every answer passed, so a later rejection can be read in context.';
comment on column public.applications.archived_at is 'Set when staff file this candidate out of the pipeline. The row and every answer, notice and score on it stay; only staff reads hide it. Null = live.';
comment on column public.assessment_questions.time_limit_minutes is 'Optional per-question limit. Null means the attempt-level limit applies.';
comment on column public.assistant_messages.steps is 'The tool calls the answer was built from, as shown in the chat: which records were read or changed and the link to each. Part of the answer, not a log.';
comment on column public.assistant_messages.attachment_text is 'Extracted text of the document attached to that turn, clipped to what the model was allowed to read. Without it a restored thread cannot answer a follow-up about the CV it was given.';
comment on column public.job_openings.min_salary_usd is 'Minimum salary in salary_currency. Column name retained for compatibility.';
comment on column public.job_openings.salary_currency is 'ISO 4217 code the min/max salary values are denominated in.';
comment on column public.sourced_prospects.profile is 'Structured profile as last read: experience, education, certifications, projects, skills, languages, links. Null until someone reads it.';
comment on column public.sourced_prospects.profile_source is 'URL = fetched from profile_url, PASTE = text a recruiter copied out of a page they can see, FILE = an export they uploaded. Which reader produced the row.';
comment on column public.sourced_prospects.profile_error is 'Last refusal a reader gave, in recruiter-facing words, cleared when a read succeeds. Not a failure of this application.';
comment on index public.applications_one_live_per_job is 'Blocks duplicate live applications to the same job. Rejected, hired and archived applications are outside the index so re-applying is permitted.';

-- ============================================================================
-- GRANTS
-- ============================================================================

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_model_config to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_model_config to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_model_config to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_model_config to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_settings to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_settings to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_settings to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_settings to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applicants to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applicants to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applicants to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applicants to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_gate_questions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_gate_questions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_gate_questions to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_gate_questions to service_role;
grant select, update, usage on sequence public.application_tracking_seq to anon;
grant select, update, usage on sequence public.application_tracking_seq to authenticated;
grant select, update, usage on sequence public.application_tracking_seq to postgres;
grant select, update, usage on sequence public.application_tracking_seq to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applications to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applications to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applications to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applications to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assessment_questions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assessment_questions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assessment_questions to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assessment_questions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assessment_templates to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assessment_templates to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assessment_templates to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assessment_templates to service_role;
grant execute on function public.assign_tracking_code to anon;
grant execute on function public.assign_tracking_code to authenticated;
grant execute on function public.assign_tracking_code to postgres;
grant execute on function public.assign_tracking_code to public;
grant execute on function public.assign_tracking_code to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assistant_messages to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assistant_messages to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assistant_messages to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assistant_messages to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assistant_sessions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assistant_sessions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assistant_sessions to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assistant_sessions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ats_integrations to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ats_integrations to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ats_integrations to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ats_integrations to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_attempts to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_attempts to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_attempts to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_attempts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_responses to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_responses to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_responses to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_responses to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_skills to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_skills to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_skills to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.candidate_skills to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.communication_logs to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.communication_logs to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.communication_logs to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.communication_logs to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.credential_audit_log to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.credential_audit_log to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.credential_audit_log to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.credential_audit_log to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.currencies to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.currencies to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.currencies to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.currencies to service_role;
grant execute on function public.current_user_profile to anon;
grant execute on function public.current_user_profile to authenticated;
grant execute on function public.current_user_profile to postgres;
grant execute on function public.current_user_profile to public;
grant execute on function public.current_user_profile to service_role;
grant execute on function public.current_user_profile_id to anon;
grant execute on function public.current_user_profile_id to authenticated;
grant execute on function public.current_user_profile_id to postgres;
grant execute on function public.current_user_profile_id to public;
grant execute on function public.current_user_profile_id to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.departments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.departments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.departments to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.departments to service_role;
grant execute on function public.generate_tracking_code to anon;
grant execute on function public.generate_tracking_code to authenticated;
grant execute on function public.generate_tracking_code to postgres;
grant execute on function public.generate_tracking_code to public;
grant execute on function public.generate_tracking_code to service_role;
grant execute on function public.has_permission to anon;
grant execute on function public.has_permission to authenticated;
grant execute on function public.has_permission to postgres;
grant execute on function public.has_permission to public;
grant execute on function public.has_permission to service_role;
grant execute on function public.has_role to anon;
grant execute on function public.has_role to authenticated;
grant execute on function public.has_role to postgres;
grant execute on function public.has_role to public;
grant execute on function public.has_role to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.integrity_events to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.integrity_events to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.integrity_events to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.integrity_events to service_role;
grant execute on function public.integrity_severity_weight to anon;
grant execute on function public.integrity_severity_weight to authenticated;
grant execute on function public.integrity_severity_weight to postgres;
grant execute on function public.integrity_severity_weight to public;
grant execute on function public.integrity_severity_weight to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.interview_schedules to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.interview_schedules to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.interview_schedules to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.interview_schedules to service_role;
grant execute on function public.is_staff to anon;
grant execute on function public.is_staff to authenticated;
grant execute on function public.is_staff to postgres;
grant execute on function public.is_staff to public;
grant execute on function public.is_staff to service_role;
grant execute on function public.is_super_admin to anon;
grant execute on function public.is_super_admin to authenticated;
grant execute on function public.is_super_admin to postgres;
grant execute on function public.is_super_admin to public;
grant execute on function public.is_super_admin to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.job_openings to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.job_openings to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.job_openings to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.job_openings to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.jobs to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.jobs to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.jobs to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.jobs to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.locations to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.locations to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.locations to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.locations to service_role;
grant execute on function public.normalise_invite_email to anon;
grant execute on function public.normalise_invite_email to authenticated;
grant execute on function public.normalise_invite_email to postgres;
grant execute on function public.normalise_invite_email to public;
grant execute on function public.normalise_invite_email to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notification_templates to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notification_templates to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notification_templates to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notification_templates to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.onboarding_plans to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.onboarding_plans to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.onboarding_plans to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.onboarding_plans to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.permissions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.permissions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.permissions to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.permissions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.provider_credentials to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.provider_credentials to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.provider_credentials to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.provider_credentials to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.provider_models to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.provider_models to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.provider_models to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.provider_models to service_role;
grant execute on function public.refresh_attempt_integrity to anon;
grant execute on function public.refresh_attempt_integrity to authenticated;
grant execute on function public.refresh_attempt_integrity to postgres;
grant execute on function public.refresh_attempt_integrity to public;
grant execute on function public.refresh_attempt_integrity to service_role;
grant execute on function public.rls_auto_enable to anon;
grant execute on function public.rls_auto_enable to authenticated;
grant execute on function public.rls_auto_enable to postgres;
grant execute on function public.rls_auto_enable to public;
grant execute on function public.rls_auto_enable to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_families to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_families to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_families to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_families to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_family_skills to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_family_skills to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_family_skills to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_family_skills to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_permissions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_permissions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_permissions to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.role_permissions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.roles to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.roles to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.roles to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.roles to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.scheduled_whatsapp_jobs to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.scheduled_whatsapp_jobs to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.scheduled_whatsapp_jobs to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.scheduled_whatsapp_jobs to service_role;
grant execute on function public.set_updated_at to anon;
grant execute on function public.set_updated_at to authenticated;
grant execute on function public.set_updated_at to postgres;
grant execute on function public.set_updated_at to public;
grant execute on function public.set_updated_at to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.settings_audit_log to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.settings_audit_log to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.settings_audit_log to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.settings_audit_log to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.skills to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.skills to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.skills to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.skills to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.sourced_prospects to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.sourced_prospects to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.sourced_prospects to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.sourced_prospects to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants_and_companies to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants_and_companies to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants_and_companies to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants_and_companies to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_invites to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_invites to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_invites to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_invites to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_profiles to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_profiles to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_profiles to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.user_profiles to service_role;
grant execute on function public.user_tenant_id to anon;
grant execute on function public.user_tenant_id to authenticated;
grant execute on function public.user_tenant_id to postgres;
grant execute on function public.user_tenant_id to public;
grant execute on function public.user_tenant_id to service_role;

-- ============================================================================
-- STORAGE BUCKETS
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidate-audio', 'candidate-audio', false, 20971520, array['audio/webm', 'audio/mpeg', 'audio/mp4']::text[])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidate-cvs', 'candidate-cvs', false, null, null)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidate-videos', 'candidate-videos', false, 52428800, array['video/webm', 'video/mp4']::text[])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 10485760, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- REALTIME PUBLICATION
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'applications') then
    execute 'alter publication supabase_realtime add table public.applications';
  end if;
exception when undefined_object then null; end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'candidate_attempts') then
    execute 'alter publication supabase_realtime add table public.candidate_attempts';
  end if;
exception when undefined_object then null; end $$;

-- ============================================================================
-- SEED DATA — Sharm Dreams Group companies
-- ============================================================================

insert into tenants_and_companies (id, name, slug, sector, country) values
  ('11111111-1111-1111-1111-111111111101', 'Sharm Dreams Touristic', 'sharm-dreams-touristic', 'HOSPITALITY', 'Egypt'),
  ('11111111-1111-1111-1111-111111111102', 'Rowad Misr Development', 'rowad-misr', 'COMMERCIAL_DEVELOPMENT', 'Egypt'),
  ('11111111-1111-1111-1111-111111111103', 'Sharm Dreams Real Estate', 'sharm-dreams-realestate', 'REAL_ESTATE', 'Egypt'),
  ('11111111-1111-1111-1111-111111111104', 'SDG Corporate Shared Services', 'sdg-corporate', 'CORPORATE', 'Egypt')
on conflict (slug) do nothing;
