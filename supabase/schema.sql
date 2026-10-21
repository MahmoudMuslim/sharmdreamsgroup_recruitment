/*
 * Sharm Dreams Talent Cloud — schema of record.
 * AUTHORITATIVE: this file carries hand edits that `node scripts/dump-schema.mjs`
 * does not reproduce (the vault removal, the locked-down jobs/applicants
 * policies, and the storage statements Task 10 deleted — the dump tool still
 * emits them because it reads the hosted project, where `storage` is the
 * vendor's own schema). A re-dump must re-apply them, not silently restore them.
 *
 * Generated from the live project, so this file describes the database instead
 * of intending to: every statement is Postgres' own pg_get_* definer. The design
 * reasoning behind any single object lives in supabase/migrations/001-*.sql.
 *
 * Three sections are authored rather than dumped: the two seed blocks, and the
 * `public.files` table with its eight policies at the very end, which is the
 * table that replaced the vendor's storage.objects (Plan 2 Tasks 2 and 10, spec
 * §15 — Task 10 deleted those policies and the `storage` grants from this file).
 * Both seed blocks are dumps of live rows in authored shape. Regenerate with:
 *
 *   node scripts/dump-schema.mjs > supabase/schema.sql
 *   node scripts/verify-schema.mjs supabase/schema.sql   # must report no gaps
 *
 * Order is dependency-driven, because this file has to apply on an empty
 * database: extensions and enums, then every table, then uniqueness, then the
 * foreign keys that point at it, then functions, then the indexes and policies
 * that call those functions, then the rows the console reads before it can
 * render anything. It applies on vanilla Postgres with only the `auth` schema
 * stood in (`docker/db/initdb/02-auth-users.sql`); the `storage` stand-in that
 * used to be required alongside it is gone, and nothing here references it.
 */

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

create schema if not exists extensions;
create extension if not exists "pg_stat_statements" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
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

create table if not exists public.activity_log (
  id uuid default gen_random_uuid(),
  company_id uuid,
  actor_id uuid,
  actor_kind text not null,
  actor_label text not null,
  via text not null,
  area text not null,
  action text not null,
  entity text not null,
  entity_id text,
  summary text not null,
  detail jsonb,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.ai_model_config (
  capability text,
  primary_model text not null,
  fallback_model text,
  temperature numeric(3,2) default 0.30 not null,
  max_tokens integer default 1200 not null,
  is_enabled boolean default true not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (capability)
);
create table if not exists public.app_settings (
  id uuid default gen_random_uuid(),
  scope settings_scope default 'GLOBAL'::settings_scope not null,
  company_id uuid,
  key text not null,
  value jsonb default 'null'::jsonb not null,
  description text,
  is_secret boolean default false not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.applicants (
  id text,
  applicant_name text not null,
  email_address text not null,
  phone_number text,
  company text not null,
  custom_business_sector text not null,
  job_title text not null,
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
create table if not exists public.application_attachments (
  id uuid default gen_random_uuid(),
  application_id uuid not null,
  bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  bytes integer,
  uploaded_by uuid,
  created_at timestamp with time zone default now(),
  PRIMARY KEY (id)
);
comment on table public.application_attachments is 'Files a recruiter attached to a candidate record after the application landed: extra CVs in resumes, voice notes in candidate-audio. One row per stored object.';
create table if not exists public.application_gate_questions (
  id uuid default gen_random_uuid(),
  job_id uuid,
  question text not null,
  help_text text,
  options jsonb default '[]'::jsonb not null,
  position integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
comment on table public.application_gate_questions is 'No-points viability questions shown on the public application form. An answer marked as not passing rejects the application at submission time.';
create table if not exists public.applications (
  id uuid default gen_random_uuid(),
  job_id uuid not null,
  full_name text not null,
  email text not null,
  phone text,
  cv_file_path text,
  cv_text text,
  tracking_code text not null,
  stage application_stage default 'NEW'::application_stage not null,
  source application_source default 'CAREER_SITE'::application_source not null,
  ai_match_score numeric,
  ai_screening_summary text,
  ai_strengths jsonb,
  ai_gaps jsonb,
  ai_soft_skills jsonb,
  ai_feedback text,
  diversity_flags jsonb,
  rejection_reason text,
  hired_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  gate_answers jsonb,
  archived_at timestamp with time zone,
  PRIMARY KEY (id)
);
create table if not exists public.assessment_questions (
  id uuid default gen_random_uuid(),
  template_id uuid not null,
  question_type question_type not null,
  title text not null,
  prompt text not null,
  config jsonb default '{}'::jsonb not null,
  points integer default 10 not null,
  position integer default 0 not null,
  time_limit_minutes integer,
  shuffle_options boolean default false not null,
  instructions text,
  PRIMARY KEY (id)
);
create table if not exists public.assessment_templates (
  id uuid default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  description text default ''::text not null,
  role_family text default 'GENERAL'::text not null,
  time_limit_minutes integer default 60 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  randomize_questions boolean default false not null,
  randomize_options boolean default false not null,
  block_copy_paste boolean default true not null,
  PRIMARY KEY (id)
);
create table if not exists public.assistant_messages (
  id uuid default gen_random_uuid(),
  session_id uuid not null,
  owner_id uuid not null,
  role text not null,
  content text not null,
  steps jsonb default '[]'::jsonb not null,
  model text,
  provider text,
  note text,
  attachment_name text,
  attachment_text text,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.assistant_sessions (
  id uuid default gen_random_uuid(),
  owner_id uuid not null,
  title text default 'New conversation'::text not null,
  engine text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
comment on table public.assistant_sessions is 'One saved assistant conversation per staff member. RLS: owner only.';
create table if not exists public.ats_integrations (
  id uuid default gen_random_uuid(),
  tenant_id uuid not null,
  provider ats_provider not null,
  status integration_status default 'PENDING'::integration_status not null,
  credentials jsonb,
  webhook_secret text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.candidate_attempts (
  id uuid default gen_random_uuid(),
  application_id uuid not null,
  template_id uuid not null,
  access_token text not null,
  status attempt_status default 'NOT_STARTED'::attempt_status not null,
  time_limit_minutes integer default 60 not null,
  started_at timestamp with time zone,
  expires_at timestamp with time zone,
  submitted_at timestamp with time zone,
  total_score numeric,
  max_score numeric,
  draft_saved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  current_index_hint integer default 0 not null,
  integrity_score integer,
  integrity_flags integer default 0 not null,
  question_order uuid[],
  option_order jsonb,
  PRIMARY KEY (id)
);
create table if not exists public.candidate_responses (
  id uuid default gen_random_uuid(),
  attempt_id uuid not null,
  question_id uuid not null,
  answer_text text,
  spreadsheet_state jsonb,
  video_path text,
  video_duration_seconds integer,
  transcript text,
  score numeric,
  max_score integer default 10 not null,
  ai_evaluation jsonb,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.candidate_skills (
  application_id uuid,
  skill_id uuid,
  proficiency integer default 1 not null,
  source text default 'AI_SCREENING'::text not null,
  PRIMARY KEY (application_id, skill_id)
);
create table if not exists public.communication_logs (
  id uuid default gen_random_uuid(),
  application_id uuid,
  channel message_channel not null,
  direction message_direction not null,
  recipient text not null,
  body text not null,
  delivered boolean default false not null,
  error_message text,
  created_at timestamp with time zone default now() not null,
  subject text,
  read_at timestamp with time zone,
  prospect_id uuid,
  PRIMARY KEY (id)
);
create table if not exists public.credential_audit_log (
  id uuid default gen_random_uuid(),
  provider text,
  action text not null,
  actor_id uuid,
  detail text,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.currencies (
  id uuid default gen_random_uuid(),
  code text not null,
  symbol text not null,
  label text not null,
  is_active boolean default true not null,
  sort_order integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
comment on table public.currencies is 'ISO 4217 currencies job salaries can be denominated in. RLS is enabled with explicit policies because rls_auto_enable() only turns RLS on, it does not grant access.';
create table if not exists public.departments (
  id uuid default gen_random_uuid(),
  tenant_id uuid,
  name text not null,
  slug text not null,
  description text,
  head_profile_id uuid,
  is_active boolean default true not null,
  sort_order integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.integrity_events (
  id uuid default gen_random_uuid(),
  attempt_id uuid not null,
  question_id uuid,
  event_type integrity_event_type not null,
  severity integrity_severity default 'INFO'::integrity_severity not null,
  detail text,
  session_fingerprint text,
  device_label text,
  occurred_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.interview_schedules (
  id uuid default gen_random_uuid(),
  application_id uuid not null,
  interviewer_profile_id uuid,
  scheduled_at timestamp with time zone not null,
  duration_minutes integer default 45 not null,
  calendar_provider calendar_provider default 'MANUAL'::calendar_provider not null,
  calendar_event_id text,
  meeting_link text,
  status interview_status default 'SCHEDULED'::interview_status not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.job_openings (
  id uuid default gen_random_uuid(),
  tenant_id uuid not null,
  title text not null,
  department text not null,
  sector business_sector not null,
  location text not null,
  employment_type text default 'FULL_TIME'::text not null,
  description text not null,
  requirements jsonb default '[]'::jsonb not null,
  min_salary_usd integer,
  max_salary_usd integer,
  status job_status default 'DRAFT'::job_status not null,
  posted_at timestamp with time zone,
  closing_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  salary_currency text default 'USD'::text not null,
  PRIMARY KEY (id)
);
create table if not exists public.jobs (
  id text,
  title text not null,
  department text not null,
  company text not null,
  business_sector text not null,
  location text not null,
  type text default 'Full-time'::text not null,
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
  name text not null,
  city text,
  governorate text,
  country text default 'Egypt'::text not null,
  timezone text default 'Africa/Cairo'::text not null,
  address text,
  is_active boolean default true not null,
  sort_order integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.notification_templates (
  id uuid default gen_random_uuid(),
  key text not null,
  channel text not null,
  subject text,
  body text not null,
  is_active boolean default true not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.onboarding_plans (
  id uuid default gen_random_uuid(),
  application_id uuid not null,
  tenant_id uuid not null,
  checklist jsonb default '[]'::jsonb not null,
  skill_gaps jsonb default '[]'::jsonb not null,
  internal_mobility_suggestions jsonb default '[]'::jsonb not null,
  retention_risk_score numeric,
  progress numeric default 0 not null,
  generated_by_ai boolean default false not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.permissions (
  key text,
  label text not null,
  group_name text not null,
  description text,
  PRIMARY KEY (key)
);
create table if not exists public.provider_credentials (
  id uuid default gen_random_uuid(),
  provider text not null,
  priority integer default 1 not null,
  secret_encrypted text not null,
  secret_hint text,
  config jsonb default '{}'::jsonb not null,
  extra_secrets_encrypted jsonb,
  is_active boolean default true not null,
  last_verified_at timestamp with time zone,
  last_verified_status text,
  last_verified_detail text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
comment on table public.provider_credentials is 'Multiple API keys per provider with priority-based failover. RLS enabled with zero policies — service role only.';
create table if not exists public.provider_models (
  id uuid default gen_random_uuid(),
  provider text not null,
  model_id text not null,
  name text not null,
  prompt_price_per_million numeric,
  completion_price_per_million numeric,
  context_length integer,
  is_free boolean default false,
  context_window_category text,
  capabilities text[] default '{}'::text[],
  is_active boolean default true,
  fetched_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.role_families (
  id uuid default gen_random_uuid(),
  key text not null,
  label text not null,
  description text,
  department_id uuid,
  is_active boolean default true not null,
  sort_order integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.role_family_skills (
  role_family_id uuid,
  skill_id uuid,
  required_level integer default 3 not null,
  weight numeric(3,2) default 1.00 not null,
  PRIMARY KEY (role_family_id, skill_id)
);
create table if not exists public.role_permissions (
  role_key app_role,
  permission_key text,
  granted boolean default true not null,
  PRIMARY KEY (role_key, permission_key)
);
create table if not exists public.roles (
  id uuid default gen_random_uuid(),
  key app_role not null,
  label text not null,
  description text,
  is_system boolean default true not null,
  PRIMARY KEY (id)
);
create table if not exists public.scheduled_whatsapp_jobs (
  id uuid default gen_random_uuid(),
  application_id uuid,
  recipient_phone text not null,
  scheduled_for timestamp with time zone default now() not null,
  payload jsonb not null,
  status text default 'PENDING'::text not null,
  attempts integer default 0 not null,
  error_log text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.settings_audit_log (
  id uuid default gen_random_uuid(),
  key text not null,
  company_id uuid,
  previous_value jsonb,
  next_value jsonb,
  changed_by uuid,
  changed_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.skills (
  id uuid default gen_random_uuid(),
  name text not null,
  category text,
  description text,
  is_active boolean default true not null,
  sort_order integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.sourced_prospects (
  id uuid default gen_random_uuid(),
  full_name text not null,
  headline text,
  company text,
  location text,
  email text,
  phone text,
  linkedin_url text,
  notes text,
  origin text default 'LINKEDIN'::text not null,
  stage text default 'NEW'::text not null,
  job_id uuid,
  application_id uuid,
  created_by uuid,
  last_contacted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
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
  name text not null,
  slug text not null,
  sector business_sector not null,
  country text default 'Egypt'::text not null,
  created_at timestamp with time zone default now() not null,
  legal_name text,
  logo_url text,
  website text,
  contact_email text,
  contact_phone text,
  address text,
  city text,
  is_active boolean default true not null,
  sort_order integer default 100 not null,
  tagline text,
  description text,
  history text,
  careers_pitch text,
  founded_year smallint,
  ownership_type text,
  employee_range text,
  headquarters text,
  milestones jsonb,
  benefits jsonb,
  cover_url text,
  is_group_profile boolean default false not null,
  PRIMARY KEY (id)
);
create table if not exists public.time_entries (
  id uuid default gen_random_uuid(),
  company_id uuid,
  staff_id uuid not null,
  category text not null,
  task text not null,
  job_id uuid,
  application_id uuid,
  note text,
  started_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
comment on table public.time_entries is 'Worked time logged by staff: one row per span, with what it was spent on and which candidate or opening it belonged to. A row with no ended_at is the running timer.';
create table if not exists public.user_invites (
  id uuid default gen_random_uuid(),
  email text not null,
  full_name text not null,
  role app_role default 'RECRUITER'::app_role not null,
  company_id uuid,
  status invite_status default 'PENDING'::invite_status not null,
  invited_by uuid,
  expires_at timestamp with time zone default (now() + '7 days'::interval) not null,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
create table if not exists public.user_profiles (
  id uuid default gen_random_uuid(),
  auth_user_id uuid not null,
  tenant_id uuid,
  full_name text not null,
  email text not null,
  phone text,
  role user_role default 'CANDIDATE'::user_role not null,
  avatar_url text,
  locale text default 'en'::text not null,
  created_at timestamp with time zone default now() not null,
  PRIMARY KEY (id)
);
do $$ begin
  alter table public.activity_log add constraint activity_log_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['STAFF'::text, 'AI'::text, 'CANDIDATE'::text, 'SYSTEM'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.activity_log add constraint activity_log_actor_label_check CHECK ((char_length(actor_label) <= 160));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.activity_log add constraint activity_log_entity_id_check CHECK ((char_length(entity_id) <= 64));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.activity_log add constraint activity_log_summary_check CHECK (((char_length(summary) >= 1) AND (char_length(summary) <= 400)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.app_settings add constraint app_settings_scope_company_key_uniq UNIQUE NULLS NOT DISTINCT (scope, company_id, key);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.application_attachments add constraint application_attachments_bucket_check CHECK ((bucket = ANY (ARRAY['resumes'::text, 'candidate-audio'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.application_attachments add constraint application_attachments_storage_path_key UNIQUE (storage_path);
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
  alter table public.sourced_prospects add constraint sourced_prospects_origin_check CHECK ((origin = ANY (ARRAY['LINKEDIN'::text, 'CSV'::text, 'MANUAL'::text, 'CHATBOT'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.sourced_prospects add constraint sourced_prospects_profile_source_check CHECK ((profile_source = ANY (ARRAY['URL'::text, 'PASTE'::text, 'FILE'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.sourced_prospects add constraint sourced_prospects_stage_check CHECK ((stage = ANY (ARRAY['NEW'::text, 'CONTACTED'::text, 'REPLIED'::text, 'INTERVIEW'::text, 'CONVERTED'::text, 'PASSED'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.tenants_and_companies add constraint tenants_and_companies_benefits_shape CHECK (((benefits IS NULL) OR (jsonb_typeof(benefits) = 'array'::text)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.tenants_and_companies add constraint tenants_and_companies_careers_pitch_length CHECK (((careers_pitch IS NULL) OR (char_length(btrim(careers_pitch)) <= 2000)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.tenants_and_companies add constraint tenants_and_companies_description_length CHECK (((description IS NULL) OR (char_length(btrim(description)) <= 4000)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.tenants_and_companies add constraint tenants_and_companies_founded_year_sane CHECK (((founded_year IS NULL) OR ((founded_year >= 1900) AND (founded_year <= 2200))));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.tenants_and_companies add constraint tenants_and_companies_history_length CHECK (((history IS NULL) OR (char_length(btrim(history)) <= 12000)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.tenants_and_companies add constraint tenants_and_companies_milestones_shape CHECK (((milestones IS NULL) OR (jsonb_typeof(milestones) = 'array'::text)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.tenants_and_companies add constraint tenants_and_companies_slug_key UNIQUE (slug);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.tenants_and_companies add constraint tenants_and_companies_tagline_length CHECK (((tagline IS NULL) OR (char_length(btrim(tagline)) <= 160)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.time_entries add constraint time_entries_category_check CHECK ((category = ANY (ARRAY['SCREENING'::text, 'ASSESSMENT'::text, 'INTERVIEW'::text, 'ONBOARDING'::text, 'SOURCING'::text, 'ADMIN'::text, 'OTHER'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.time_entries add constraint time_entries_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.time_entries add constraint time_entries_span_check CHECK (((ended_at IS NULL) OR (ended_at > started_at)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.time_entries add constraint time_entries_task_check CHECK (((char_length(btrim(task)) >= 1) AND (char_length(btrim(task)) <= 160)));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.user_profiles add constraint user_profiles_auth_user_id_key UNIQUE (auth_user_id);
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.user_profiles add constraint user_profiles_locale_check CHECK ((locale = ANY (ARRAY['en'::text, 'ar'::text, 'ru'::text, 'de'::text])));
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.activity_log add constraint activity_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES user_profiles(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.activity_log add constraint activity_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES tenants_and_companies(id) ON DELETE SET NULL;
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
  alter table public.application_attachments add constraint application_attachments_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.application_attachments add constraint application_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES user_profiles(id) ON DELETE SET NULL;
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
  alter table public.time_entries add constraint time_entries_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.time_entries add constraint time_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES tenants_and_companies(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.time_entries add constraint time_entries_job_id_fkey FOREIGN KEY (job_id) REFERENCES job_openings(id) ON DELETE SET NULL;
exception when duplicate_object or duplicate_table or undefined_object then null; end $$;
do $$ begin
  alter table public.time_entries add constraint time_entries_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
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

alter table public.activity_log enable row level security;
alter table public.ai_model_config enable row level security;
alter table public.app_settings enable row level security;
alter table public.applicants enable row level security;
alter table public.application_attachments enable row level security;
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
alter table public.time_entries enable row level security;
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
CREATE OR REPLACE FUNCTION public.stop_time_entry(entry_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  update public.time_entries
     set ended_at = now()
   where id = entry_id
     and ended_at is null
  returning ended_at;
$function$;
comment on function public.stop_time_entry(entry_id uuid) is 'Ends a running entry with the database clock. Refuses a row that is already finished, and refuses another person''s row through the same UPDATE policy the console uses.';
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

CREATE INDEX IF NOT EXISTS idx_activity_actor_created ON public.activity_log USING btree (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_area_created ON public.activity_log USING btree (area, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_created ON public.activity_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON public.activity_log USING btree (entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_kind_created ON public.activity_log USING btree (actor_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON public.app_settings USING btree (key);
CREATE INDEX IF NOT EXISTS application_attachments_application_id_idx ON public.application_attachments USING btree (application_id);
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
CREATE UNIQUE INDEX IF NOT EXISTS tenants_and_companies_one_group_profile ON public.tenants_and_companies USING btree (is_group_profile) WHERE is_group_profile;
CREATE INDEX IF NOT EXISTS time_entries_application_idx ON public.time_entries USING btree (application_id);
CREATE INDEX IF NOT EXISTS time_entries_company_started_idx ON public.time_entries USING btree (company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_job_idx ON public.time_entries USING btree (job_id);
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_running_idx ON public.time_entries USING btree (staff_id) WHERE (ended_at IS NULL);
CREATE INDEX IF NOT EXISTS time_entries_staff_started_idx ON public.time_entries USING btree (staff_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS user_invites_pending_email_uniq ON public.user_invites USING btree (lower(email)) WHERE (status = 'PENDING'::invite_status);

-- ============================================================================
-- POLICIES
-- ============================================================================

drop policy if exists "activity_staff_read" on public.activity_log;
create policy "activity_staff_read" on public.activity_log
  for SELECT
  to public
  using (has_permission('settings.manage_platform'::text));
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
drop policy if exists "attachments_staff_add" on public.application_attachments;
create policy "attachments_staff_add" on public.application_attachments
  for INSERT
  to authenticated
  with check ((is_staff() AND has_permission('candidates.write'::text) AND (EXISTS ( SELECT 1
   FROM applications ap
  WHERE (ap.id = application_attachments.application_id)))));
drop policy if exists "attachments_staff_read" on public.application_attachments;
create policy "attachments_staff_read" on public.application_attachments
  for SELECT
  to authenticated
  using ((is_staff() AND (is_super_admin() OR (user_tenant_id() IS NULL) OR (EXISTS ( SELECT 1
   FROM (applications ap
     JOIN job_openings jo ON ((jo.id = ap.job_id)))
  WHERE ((ap.id = application_attachments.application_id) AND (jo.tenant_id = user_tenant_id())))))));
drop policy if exists "attachments_staff_remove" on public.application_attachments;
create policy "attachments_staff_remove" on public.application_attachments
  for DELETE
  to authenticated
  using ((is_staff() AND has_permission('candidates.write'::text)));
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
drop policy if exists "time_entries_company_read" on public.time_entries;
create policy "time_entries_company_read" on public.time_entries
  for SELECT
  to authenticated
  using ((is_staff() AND (is_super_admin() OR (user_tenant_id() IS NULL) OR (company_id IS NULL) OR (company_id = user_tenant_id()))));
drop policy if exists "time_entries_own_add" on public.time_entries;
create policy "time_entries_own_add" on public.time_entries
  for INSERT
  to authenticated
  with check ((is_staff() AND has_permission('time.track'::text) AND (staff_id = current_user_profile_id())));
drop policy if exists "time_entries_own_change" on public.time_entries;
create policy "time_entries_own_change" on public.time_entries
  for UPDATE
  to authenticated
  using ((is_staff() AND has_permission('time.track'::text) AND (staff_id = current_user_profile_id())))
  with check ((is_staff() AND has_permission('time.track'::text) AND (staff_id = current_user_profile_id())));
drop policy if exists "time_entries_own_remove" on public.time_entries;
create policy "time_entries_own_remove" on public.time_entries
  for DELETE
  to authenticated
  using ((is_staff() AND has_permission('time.track'::text) AND ((staff_id = current_user_profile_id()) OR is_super_admin())));
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
drop trigger if exists "trg_time_entries_updated" on public.time_entries;
CREATE TRIGGER trg_time_entries_updated BEFORE UPDATE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists "trg_user_invites_email" on public.user_invites;
CREATE TRIGGER trg_user_invites_email BEFORE INSERT OR UPDATE OF email ON public.user_invites FOR EACH ROW EXECUTE FUNCTION normalise_invite_email();

-- ============================================================================
-- COMMENTS
-- ============================================================================

comment on column public.application_attachments.bucket is 'Which private bucket holds the object. Only the two this table was written for; CVs and video pitches keep their own columns on their own tables.';
comment on column public.application_attachments.storage_path is 'Exact storage key, applications/<application id>/<uuid>-<filename>. Unique, so two rows can never claim one object and a delete can find the row from the key.';
comment on column public.application_attachments.file_name is 'The name the uploader chose, kept so the console can show it after the random storage prefix has been stripped.';
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
comment on column public.tenants_and_companies.tagline is 'One line under the company name on the careers page. Public, and blank means the line is not shown.';
comment on column public.tenants_and_companies.description is 'Who this company is, in its own words. Public careers copy, written in Settings → Master data.';
comment on column public.tenants_and_companies.history is 'The company''s story, in paragraphs. Written line by line as the candidate reads it.';
comment on column public.tenants_and_companies.careers_pitch is 'Why someone would want to work here — the paragraph above the open roles.';
comment on column public.tenants_and_companies.founded_year is 'Year the company was founded, used for the timeline and the "since 1996" figure.';
comment on column public.tenants_and_companies.ownership_type is 'Public Company, Private Limited, Family group… A description of governance, not a legal form.';
comment on column public.tenants_and_companies.employee_range is 'Headcount as a band, e.g. 501-1,000. A band rather than a number because nobody can verify a number.';
comment on column public.tenants_and_companies.headquarters is 'Where the company is run from, as a candidate would read it.';
comment on column public.tenants_and_companies.milestones is 'Ordered array of {"year": …, "title": …, "detail": …} objects shown as the history timeline.';
comment on column public.tenants_and_companies.benefits is 'Array of {"title": …, "text": …} objects — the group''s own "Why join us" list. Rendered as cards, never promised as a contract.';
comment on column public.tenants_and_companies.cover_url is 'A banner image for this company''s careers section: a path or an absolute URL. Blank shows no image.';
comment on column public.tenants_and_companies.is_group_profile is 'The row whose profile is the whole group''s. Exactly one; read by the careers page for the group header, and excluded from the pickers a job or a suite is filed under.';
comment on column public.time_entries.task is 'What the person was doing, in their own words, e.g. "Score the four sales pitch recordings". Free text so it can name the real work; the category is the part the reports can group.';
comment on column public.time_entries.application_id is 'The candidate the time went to, when there is one. Set null if the application disappears: hours are not the candidate''s property and must not vanish with them.';
comment on column public.time_entries.started_at is 'When the span began. Set by the database clock, never typed in as a duration, so a timer left running over the weekend reads as the 48 hours it is rather than as a guess.';
comment on column public.time_entries.ended_at is 'When the span ended. Null means still running: the elapsed time is computed from started_at at read time, so the number is always the database''s, not the browser''s.';
comment on index public.applications_one_live_per_job is 'Blocks duplicate live applications to the same job. Rejected, hired and archived applications are outside the index so re-applying is permitted.';

-- ============================================================================
-- GRANTS
-- ============================================================================

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.activity_log to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.activity_log to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.activity_log to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.activity_log to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_model_config to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_model_config to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_model_config to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_model_config to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_settings to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_settings to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_settings to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_settings to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applicants to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applicants to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_attachments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_attachments to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_attachments to service_role;
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
grant execute on function public.stop_time_entry to anon;
grant execute on function public.stop_time_entry to authenticated;
grant execute on function public.stop_time_entry to postgres;
grant execute on function public.stop_time_entry to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants_and_companies to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants_and_companies to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants_and_companies to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenants_and_companies to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.time_entries to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.time_entries to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.time_entries to service_role;
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
-- SEED DATA — the companies, with the profile the careers page reads
-- ============================================================================

insert into public.tenants_and_companies (id, name, slug, sector, country, legal_name, website, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, logo_url, cover_url, is_active, sort_order, is_group_profile) values ('1c8bc8ad-975f-49c1-bd30-0f1abb071d29', 'Sharm Dreams Group', 'sharm-dreams-group', 'HOSPITALITY', 'Egypt', null, 'https://sharmdreamsgroup.com/', 'Building destinations that shape the future of tourism & real estate.', 'Sharm Dreams Group is an Egyptian investment group specializing in tourism, hospitality, and real estate development. Through a diversified portfolio of companies and strategic partnerships, the group delivers integrated destinations designed for long-term value and sustainable growth.

A structured family of tourism and hospitality companies, united by a single standard of excellence — six companies, one shared vision.', 'Since 1996, Sharm Dreams Group has set the gold standard for luxury hospitality in Egypt. Our journey began with the iconic Jaz Sharm Dreams Resort, and over the past two decades, we have redefined the art of gracious living across Egypt''s most breathtaking destinations. Every property in our portfolio is a testament to our unwavering commitment to excellence, elegance, and unforgettable guest experiences.

Today, Sharm Dreams Group stands as a beacon of sophistication and innovation. With a diverse portfolio of hotels and real estate developments, we continue to elevate the standards of luxury, blending world-class amenities with authentic Egyptian hospitality. Our presence in Egypt''s premier coastal cities is a reflection of our vision to inspire and delight guests from around the globe.

Our vision is to elevate Egypt''s tourism landscape by attracting international travelers and setting new benchmarks in guest experience. We are dedicated to innovation, sustainability, and the creation of integrated developments that enrich both our guests and the communities we serve. Our mission is to develop and manage high-quality hospitality and real estate projects that deliver long-term value for investors, partners, and communities — through innovation, integrity, and strategic partnerships.

Looking ahead, Sharm Dreams Group is poised to introduce a new era of entertainment, wellness, and lifestyle destinations. Our future projects will blend global expertise with local charm, offering residents and guests unparalleled experiences in every stay.

The group''s hotels and resorts are managed by world-class operators Hilton and Jaz Hotels, and its portfolio spans Sharm El Sheikh, Sahl Hasheesh, Marsa Alam, Nuweiba and Borg El Arab, with offices in Cairo and operations across the Red Sea and South Sinai.', 'Find your perfect role and grow with us. Join a team that turns coastlines into landmark destinations — explore current opportunities across Sharm Dreams Group companies and locations, then apply directly to our HR team.', '1996', 'Public Company', '501–1,000', 'Cairo, Egypt — with operations across the Red Sea and South Sinai.', '[{"year": 1987, "title": "Rowad Misr is established", "detail": "Rowad Misr for Tourist Investment (Co. S.A.E.) is founded in February 1987 as an Egyptian public shareholding company; it is today held by Sharm Dreams Holding Company for Tourism & Hotels."}, {"year": 1996, "title": "The group is founded", "detail": "Sharm Dreams Company for Tourism Investment is established in September 1996 as an Egyptian public shareholding company, with authorized capital of EGP 1,000,000,000."}, {"year": 1998, "title": "Concord joins the portfolio", "detail": "Concord Company for Tourist Development S.A.E. is established, the vehicle behind Hilton Marsa Alam Nubian Resort."}, {"year": 2000, "title": "Listed, and on the Red Sea coast", "detail": "Sharm Dreams Company for Tourism Investment lists on the Egyptian Exchange in October 2000, and Rowad Misr for Red Sea Hotels Co. is established to own, manage and operate hotels along the Red Sea coast."}, {"year": 2007, "title": "A holding company for the hotels", "detail": "Sharm Dreams Holding Company for Tourism & Hotels is established with authorized capital of EGP 700,000,000, and becomes the shareholder of Rowad Misr for Tourist Investment."}, {"year": 2019, "title": "Abu Dabbab", "detail": "Abu Dabbab Diving Lodge is established near Marsa Alam, in one of the world''s most renowned diving and snorkeling destinations."}, {"year": null, "title": "Today", "detail": "Six portfolio companies and six affiliated businesses — hotels and resorts operated with Hilton and Jaz, plus real-estate developments across Sharm El Sheikh, Sahl Hasheesh, Marsa Alam, Nuweiba and Borg El Arab."}]', '[{"text": "A culture that respects your time and supports wellbeing.", "title": "Work–Life Balance"}, {"text": "Clear paths to advance within a growing group.", "title": "Career Growth"}, {"text": "Training and mentorship from industry leaders.", "title": "Learning & Development"}, {"text": "Rewarding packages that recognise exceptional talent.", "title": "Competitive Benefits"}]', null, null, true, '1', true) on conflict (id) do nothing;
insert into public.tenants_and_companies (id, name, slug, sector, country, legal_name, website, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, logo_url, cover_url, is_active, sort_order, is_group_profile) values ('11111111-1111-1111-1111-111111111101', 'Sharm Dreams Touristic', 'sharm-dreams-touristic', 'HOSPITALITY', 'Egypt', 'Sharm Dreams Company for Tourism Investment', null, 'A legacy of building Egyptian destinations.', 'An Egyptian public shareholding company operating in tourism and entertainment — constructing and managing hotels, resorts, villages, commercial centers, and tourism-related real estate.', 'Established September 1996 and listed on the Egyptian Exchange in October 2000, the company is an Egyptian public shareholding company operating in tourism and entertainment — constructing and managing hotels, resorts, villages, commercial centers, and tourism-related real estate.

Its authorized capital is EGP 1,000,000,000 with EGP 529,854,600 issued. Its shareholders are Dr. Hamada Mohamed Kamal Alldin Abu Al Enein, General Mediterranean Holding, Oval Development Corporation and Suez Canal Bank S.A.E., and it holds investments in Sharm Dreams Holding Company for Tourism & Hotels, Sharm Dreams Real Estate Development and Concord Company for Tourist Development S.A.E.

Its properties are Jaz Sharm Dreams in Sharm El Sheikh, Vacation Club and Cleo Park Sharm El Sheikh, with Cliffs — Curio Collection By Hilton and further projects announced as upcoming.', null, '1996', 'Public shareholding company (listed on EGX)', null, null, null, null, null, null, true, '2', false) on conflict (id) do nothing;
insert into public.tenants_and_companies (id, name, slug, sector, country, legal_name, website, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, logo_url, cover_url, is_active, sort_order, is_group_profile) values ('8096264b-fd2a-439e-a16c-534f6590300c', 'Sharm Dreams Holding', 'sharm-dreams-holding', 'HOSPITALITY', 'Egypt', 'Sharm Dreams Holding Company for Tourism & Hotels', 'https://sharmdreamsgroup.com/en/portfolio/sharm-dreams-holding/', 'Owning, managing and developing hotels, resorts and touristic projects across Egypt.', 'An Egyptian joint-stock company engaged in tourism investment, development, and hospitality — owning, managing, and developing hotels, resorts, and touristic projects across Egypt with a diversified portfolio and strategic investments.', 'Established 2007, Sharm Dreams Holding Company for Tourism & Hotels is an Egyptian joint-stock company engaged in tourism investment, development and hospitality — owning, managing and developing hotels, resorts and touristic projects across Egypt with a diversified portfolio and strategic investments.

Its authorized capital is EGP 700,000,000 with EGP 550,000,000 issued. Its shareholders are Dr. Hamada Mohamed Kamal Alldin Abu Al Enein, Sharm Dreams for Tourism Investment Company, General Mediterranean Holding (GMH), the National Bank of Egypt and Oval Development Corporation, and it holds Rowad Misr for Tourist Investment (Co. S.A.E.).', null, '2007', 'Joint stock company', null, null, '[{"year": 2007, "title": "Established", "detail": "Founded as the holding company for the group''s tourism and hotel investments, with EGP 550,000,000 issued capital."}, {"year": null, "title": "What it holds", "detail": "Rowad Misr for Tourist Investment (Co. S.A.E.), the shareholder of Rowad Misr for Red Sea Hotels Co."}]', null, null, null, true, '3', false) on conflict (id) do nothing;
insert into public.tenants_and_companies (id, name, slug, sector, country, legal_name, website, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, logo_url, cover_url, is_active, sort_order, is_group_profile) values ('11111111-1111-1111-1111-111111111102', 'Rowad Misr Development', 'rowad-misr', 'COMMERCIAL_DEVELOPMENT', 'Egypt', 'Rowad Misr for Tourist Investment (Co. S.A.E.)', null, 'Developing the tourism infrastructure that Egypt''s destinations run on.', 'An Egyptian public shareholding company focused on developing tourism infrastructure — constructing, owning, and managing hotels, resorts, tourist villages, casinos, and related entertainment and real estate projects.', 'Established February 1987 and listed on the Egyptian Exchange, Rowad Misr for Tourist Investment (Co. S.A.E.) is an Egyptian public shareholding company focused on developing tourism infrastructure — constructing, owning, and managing hotels, resorts, tourist villages, casinos, and related entertainment and real estate projects.

Its authorized capital is EGP 250,000,000 with EGP 150,000,000 issued, and it is held by Sharm Dreams Holding Company for Tourism & Hotels. Its subsidiaries are Rowad Misr for Red Sea Hotels Co., Sahl Hasheesh for Touristic Investment, Rowad Dahab for Tourism Development and Rowad El Wahat for Tourism Development.

Its properties are Jaz Fayrouz Resort in Sharm El Sheikh, TIME Coral Nuweiba Resort, Borg El Arab Beach Resort and Life Co.', null, '1987', 'Public shareholding company (listed on EGX)', null, null, '[{"year": 1987, "title": "Established", "detail": "Founded in February 1987 as an Egyptian public shareholding company, later listed on the Egyptian Exchange."}, {"year": null, "title": "Its hotels today", "detail": "Jaz Fayrouz Resort (Sharm El Sheikh), TIME Coral Nuweiba Resort, Borg El Arab Beach Resort and Life Co."}]', null, null, null, true, '4', false) on conflict (id) do nothing;
insert into public.tenants_and_companies (id, name, slug, sector, country, legal_name, website, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, logo_url, cover_url, is_active, sort_order, is_group_profile) values ('8ed5a818-8fc4-4cd7-9ab7-a3650c3bfe74', 'Rowad Misr for Red Sea Hotels', 'rowad-misr-red-sea-hotels', 'HOSPITALITY', 'Egypt', 'Rowad Misr for Red Sea Hotels Co.', 'https://sharmdreamsgroup.com/en/portfolio/rowad-misr-red-sea/', 'Hotels and resorts along the Red Sea coast.', 'A key subsidiary of Rowad Misr for Tourism Investment, established to own, manage, and operate hotels and resorts along the Red Sea coast — central to Egypt''s hospitality sector and tourism infrastructure.', 'Established 2000 as a key subsidiary of Rowad Misr for Tourism Investment, the company owns, manages and operates hotels and resorts along the Red Sea coast, and is described by the group as central to Egypt''s hospitality sector and tourism infrastructure.

Its authorized capital is EGP 100,000,000 with EGP 120,000,000 issued, and its shareholder is Rowad Misr for Tourist Investment (Co. S.A.E.). Its property is Old Palace Resort in Sahl Hasheesh.', null, '2000', null, null, null, '[{"year": 2000, "title": "Established", "detail": "Founded to own, manage and operate Rowad Misr''s hotels along the Red Sea coast."}, {"year": null, "title": "Its resort", "detail": "Old Palace Resort — Sahl Hasheesh."}]', null, null, null, true, '5', false) on conflict (id) do nothing;
insert into public.tenants_and_companies (id, name, slug, sector, country, legal_name, website, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, logo_url, cover_url, is_active, sort_order, is_group_profile) values ('c836d3c4-7d3e-4403-b2e1-f0973ce72aba', 'Concord for Tourist Development', 'concord-tourist-development', 'HOSPITALITY', 'Egypt', 'Concord Company for Tourist Development S.A.E.', 'https://sharmdreamsgroup.com/en/portfolio/concord/', 'Developing, building and managing hotels, resorts and touristic facilities.', 'An Egyptian joint-stock company engaged in tourism and hospitality investment — focused on the development, construction, and management of hotels, resorts, and related touristic facilities.', 'Established 1998, Concord Company for Tourist Development S.A.E. is an Egyptian joint-stock company engaged in tourism and hospitality investment, focused on the development, construction and management of hotels, resorts and related touristic facilities.

Its authorized and issued capital is EGP 500,000,000. Its shareholders include Dr. Hamada Mohamed Kamal Alldin Abu Al Enein, General Mediterranean Holding, Oval Development Corporation, Sharm Dreams for Touristic Investment Co., Suez Canal Bank, Misr Insurance Company, Egypt Life Insurance and the National Bank of Egypt, and it holds Abu Dabbab Diving Lodge. Its property is Hilton Marsa Alam Nubian Resort.', null, '1998', 'Joint stock company (S.A.E.)', null, null, '[{"year": 1998, "title": "Established", "detail": "Founded as a tourism and hospitality development company, fully subscribed at EGP 500,000,000."}, {"year": null, "title": "Its resorts", "detail": "Hilton Marsa Alam Nubian Resort, and Abu Dabbab Diving Lodge as a subsidiary."}]', null, null, null, true, '6', false) on conflict (id) do nothing;
insert into public.tenants_and_companies (id, name, slug, sector, country, legal_name, website, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, logo_url, cover_url, is_active, sort_order, is_group_profile) values ('ed310482-385b-4d2d-b2fc-9f7595e640fa', 'Abu Dabbab Diving Lodge', 'abu-dabbab-diving-lodge', 'HOSPITALITY', 'Egypt', 'Abu Dabbab Diving Lodge', 'https://sharmdreamsgroup.com/en/portfolio/abu-dabbab-lodge/', 'Eco-tourism and marine adventure near Marsa Alam.', 'A Red Sea hospitality property near Marsa Alam in one of the world''s most renowned diving and snorkeling destinations — focused on eco-tourism and marine adventure, operating under the group''s central board for consistent quality and operational excellence.', 'Established 2019, Abu Dabbab Diving Lodge is a Red Sea hospitality property near Marsa Alam, in one of the world''s most renowned diving and snorkeling destinations, focused on eco-tourism and marine adventure and operating under the group''s central board for consistent quality and operational excellence.

Its authorized capital is EGP 490,000,000 with EGP 49,544,000 issued. Its shareholders are Dr. Hamada Mohamed Kamal El Din Abu El Enein, Concord Company for Tourist Development Co. and Bautex Misr Co.', null, '2019', null, null, null, '[{"year": 2019, "title": "Established", "detail": "The lodge opens near Marsa Alam, in one of the world''s most renowned diving and snorkeling destinations."}]', null, null, null, true, '7', false) on conflict (id) do nothing;
insert into public.tenants_and_companies (id, name, slug, sector, country, legal_name, website, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, logo_url, cover_url, is_active, sort_order, is_group_profile) values ('11111111-1111-1111-1111-111111111103', 'Sharm Dreams Real Estate', 'sharm-dreams-realestate', 'REAL_ESTATE', 'Egypt', 'Sharm Dreams Real Estate Development', null, 'Premium developments, commercial centers and residential projects in Egypt.', 'The group''s real-estate arm — premium real estate developments, commercial centers and residential projects in Egypt. The company appears on sharmdreamsgroup.com as Sharm Dreams Real Estate Development, an investment of Sharm Dreams Company for Tourism Investment.', null, null, null, null, null, null, null, null, null, null, true, '8', false) on conflict (id) do nothing;
insert into public.tenants_and_companies (id, name, slug, sector, country, legal_name, website, tagline, description, history, careers_pitch, founded_year, ownership_type, employee_range, headquarters, milestones, benefits, logo_url, cover_url, is_active, sort_order, is_group_profile) values ('11111111-1111-1111-1111-111111111104', 'SDG Corporate Shared Services', 'sdg-corporate', 'CORPORATE', 'Egypt', 'SDG Corporate Shared Services', null, null, null, null, null, null, null, null, null, null, null, null, null, true, '100', false) on conflict (id) do nothing;

-- ============================================================================
-- REFERENCE ROWS — the lookup data the console reads before it can render
-- ============================================================================

insert into public.permissions (key, label, group_name, description) values ('analytics.export', 'Export analytics', 'Analytics', 'Download the Analytics, Reports and Candidates tables as CSV, Excel or PDF') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('analytics.view', 'View analytics', 'Analytics', 'Access dashboards and reports') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('assessments.assign', 'Assign assessments', 'Assessments', 'Send assessments to candidates') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('assessments.create', 'Create assessments', 'Assessments', 'Build and publish test suites') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('assessments.grade', 'Grade assessments', 'Assessments', 'Review and award assessment scores') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('candidates.delete', 'Delete candidates', 'Candidates', 'Permanently remove an application') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('candidates.read', 'View candidates', 'Candidates', 'See candidate profiles and pipelines') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('candidates.view_scores', 'View scores', 'Candidates', 'See AI scores and assessment results') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('candidates.write', 'Edit candidates', 'Candidates', 'Move stages, edit notes and contact details') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('companies.manage', 'Manage companies', 'Administration', 'Add and configure subsidiary companies') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('interviews.schedule', 'Schedule interviews', 'Interviews', 'Book interview slots and send invites') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('jobs.manage', 'Manage jobs', 'Jobs', 'Create, publish and close job openings') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('messages.send', 'Send messages', 'Communications', 'Send WhatsApp and email to candidates') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('scores.view_unmasked', 'View unmasked scores', 'Candidates', 'See scores normally masked for reviewers') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('settings.manage_platform', 'Manage platform settings', 'Administration', 'Edit AI, integration and security settings') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('settings.manage_roles', 'Manage roles', 'Administration', 'Change role permission grants') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('settings.manage_users', 'Manage users', 'Administration', 'Invite, edit and disable staff accounts') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('time.track', 'Track time', 'Time', 'Start, stop and edit your own logged hours') on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('users.create', 'Create users', 'users', null) on conflict (key) do nothing;
insert into public.permissions (key, label, group_name, description) values ('users.manage', 'Manage users', 'users', null) on conflict (key) do nothing;
insert into public.roles (id, key, label, description, is_system) values ('10cd5ce2-bb42-4bc3-982f-7e1a211994b2', 'HIRING_MANAGER', 'Hiring Manager', 'Review and interview candidates for assigned roles', true) on conflict (id) do nothing;
insert into public.roles (id, key, label, description, is_system) values ('35a3562f-7781-4359-9112-c66cad16ce5e', 'RECRUITER', 'Recruiter', 'Manage candidates, jobs and assessments for assigned companies', true) on conflict (id) do nothing;
insert into public.roles (id, key, label, description, is_system) values ('717e27f0-05ec-46c0-ad9e-477e269451c5', 'SUPER_ADMIN', 'Super Admin', 'Unrestricted access across every company and setting', true) on conflict (id) do nothing;
insert into public.roles (id, key, label, description, is_system) values ('7d3bec85-7d6c-4481-8aec-1620b8cede7e', 'CANDIDATE', 'Candidate', 'Portal access to their own application only', true) on conflict (id) do nothing;
insert into public.roles (id, key, label, description, is_system) values ('7dc41a71-ecd6-454f-a173-31b6332e9585', 'INTERVIEWER', 'Interviewer', 'Read-only candidate access with interview scheduling', true) on conflict (id) do nothing;
insert into public.roles (id, key, label, description, is_system) values ('9cebe9b7-9564-4cb2-9ccb-9629cc2d4fb3', 'SUBSIDIARY_HR_MANAGER', 'Subsidiary HR Manager', 'Full HR control within an assigned company only', true) on conflict (id) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'analytics.export', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'analytics.view', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'assessments.assign', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'assessments.create', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'assessments.grade', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'candidates.delete', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'candidates.read', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'candidates.view_scores', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'candidates.write', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'companies.manage', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'interviews.schedule', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'jobs.manage', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'messages.send', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'scores.view_unmasked', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'settings.manage_platform', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'settings.manage_roles', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'settings.manage_users', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'time.track', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'users.create', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUPER_ADMIN', 'users.manage', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'analytics.export', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'analytics.view', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'assessments.assign', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'assessments.create', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'assessments.grade', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'candidates.delete', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'candidates.read', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'candidates.view_scores', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'candidates.write', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'interviews.schedule', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'jobs.manage', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'messages.send', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'settings.manage_users', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'time.track', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'users.create', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('SUBSIDIARY_HR_MANAGER', 'users.manage', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'analytics.view', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'assessments.assign', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'assessments.create', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'candidates.delete', false) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'candidates.read', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'candidates.view_scores', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'candidates.write', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'interviews.schedule', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'jobs.manage', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'messages.send', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('RECRUITER', 'time.track', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('HIRING_MANAGER', 'analytics.view', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('HIRING_MANAGER', 'candidates.read', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('HIRING_MANAGER', 'candidates.view_scores', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('HIRING_MANAGER', 'interviews.schedule', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('HIRING_MANAGER', 'time.track', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('INTERVIEWER', 'candidates.read', true) on conflict (role_key, permission_key) do nothing;
insert into public.role_permissions (role_key, permission_key, granted) values ('INTERVIEWER', 'interviews.schedule', true) on conflict (role_key, permission_key) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('229943e2-f358-448a-8b4d-ba9e79ed4891', 'TRY', '₺', 'Turkish Lira', true, '130') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('4121eaf7-6eb6-4cbd-96ca-519fcef57edf', 'RUB', '₽', 'Russian Ruble', true, '110') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('4ceb97a4-2f93-489d-974b-f6d7f3f6b52e', 'MAD', 'MAD', 'Moroccan Dirham', true, '100') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('58998417-31b8-4d95-b3f2-142a8dec09fa', 'JOD', 'JOD', 'Jordanian Dinar', true, '90') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('60c8e367-78e1-474a-ad7d-513db8007dde', 'AED', 'AED', 'UAE Dirham', true, '50') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('66cc9f29-763b-420b-a171-739701c5774b', 'GBP', '£', 'British Pound', true, '40') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('6ad867fb-f40c-4ae7-9c0a-2cda16fd5250', 'QAR', 'QAR', 'Qatari Riyal', true, '70') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('7f19fdd7-f888-46ed-99c7-d56de1a930cf', 'KWD', 'KWD', 'Kuwaiti Dinar', true, '80') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('7faae9f4-94fb-475f-8c2d-a63f9583213f', 'PLN', 'zł', 'Polish Zloty', true, '100') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('912f8be4-1b56-4132-b6d2-b55fd84a2f78', 'EGP', 'EGP', 'Egyptian Pound', true, '10') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('ca733f64-f263-41d1-a5f5-b9036b2afce6', 'SAR', 'SAR', 'Saudi Riyal', true, '60') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('e6aab0c9-38ac-451a-8409-3edfea873037', 'CHF', 'CHF', 'Swiss Franc', true, '120') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('eba8b286-3112-4bb1-a0a6-e1d8ecf8f44b', 'USD', '$', 'US Dollar', true, '20') on conflict (id) do nothing;
insert into public.currencies (id, code, symbol, label, is_active, sort_order) values ('f2f58ab6-0218-42d4-9034-807a1008f548', 'EUR', '€', 'Euro', true, '30') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('03285f08-782d-4513-ab2e-40578d7c60a4', 'Conflict resolution', 'Soft', 'De-escalation and difficult conversations', true, '130') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('0b557061-3cb7-4323-bfc9-f3ba9732f5b8', 'ATS / HRIS tooling', 'Functional', 'Applicant tracking and HR information systems', true, '170') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('0c946e32-c508-4d23-90e4-27846554cdcc', 'Revenue management', 'Technical', 'Pricing, yield and distribution strategy', true, '60') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('10afbbba-59a9-4e3d-97c6-261cabac422b', 'Guest relations', 'Soft', 'Managing guest expectations and service recovery', true, '120') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('1ec69d45-e061-4ee7-a281-da3c89200c26', 'CRM discipline', 'Commercial', 'Pipeline hygiene and forecasting', true, '150') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('2fb80d63-7ef4-4d03-804c-dc0b02e051b5', 'Project management', 'Technical', 'Delivery, scheduling and contractor management', true, '220') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('3bd76603-11f7-48c5-ad23-a8fe4e4ba189', 'NPV / IRR analysis', 'Technical', 'Discounted cash flow and return calculations', true, '20') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('3c49f772-5ef4-4059-b1c8-6c5c2e72033d', 'Negotiation', 'Commercial', 'Commercial negotiation and closing', true, '140') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('3ed235e1-4cc3-44e9-9e4e-f0901b5bbe4b', 'Hygiene and food safety', 'Functional', 'HACCP and kitchen safety standards', true, '200') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('434340ef-a3d4-4597-9923-924dd989cf02', 'Maintenance planning', 'Technical', 'Preventive maintenance and asset management', true, '210') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('52bfc474-6b7c-4d68-9026-d9cfd4e97787', 'Data analysis', 'Technical', 'Quantitative analysis and reporting', true, '180') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('6c44be0e-d857-4e23-b87b-1b4300dcd6c3', 'Stakeholder communication', 'Soft', 'Presenting to executives and external parties', true, '100') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('6d7d784d-6eab-48e6-b4bb-4e1cb9b6b109', 'Excel (advanced)', 'Technical', 'Formulas, pivot tables, Power Query and macros', true, '50') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('75f500e4-e6d7-4940-a5be-13e070f23a8a', 'Recruiting', 'Functional', 'Sourcing, screening and closing candidates', true, '160') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('85f3689a-e724-4644-a3c9-bff86faf652d', 'Financial modelling', 'Technical', 'Building multi-sheet financial models with linked assumptions', true, '10') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('8a80e3eb-250f-4d28-ab84-cbda939336bd', 'Compliance', 'Functional', 'Regulatory and policy compliance', true, '190') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('8afaa440-822c-4de9-ab43-18601685a3eb', 'Property valuation', 'Technical', 'DCF, cap rates and comparable-sales analysis', true, '70') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('9e64311b-09a2-4dc3-bb5b-46078ea987e4', 'Feasibility studies', 'Technical', 'Development appraisal and market studies', true, '80') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('a03c5478-9ac2-4cbc-9aca-aab8a92874c6', 'Emotional intelligence', 'Soft', 'Self-awareness and relationship management', true, '110') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('ca97d266-6693-45bd-b333-8d2cb4b566e3', 'Team leadership', 'Soft', 'Leading and developing teams', true, '90') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('e49d77ec-ae1b-4f6b-8dbf-677ff9baa886', 'IFRS reporting', 'Technical', 'Financial reporting under IFRS', true, '40') on conflict (id) do nothing;
insert into public.skills (id, name, category, description, is_active, sort_order) values ('ee4bc38d-1746-417c-ab4b-02f99c3f9d43', 'Budgeting', 'Technical', 'Annual budgeting cycles and variance analysis', true, '30') on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('224cdc8a-18b9-4fcf-8777-55313ed04f11', 'assessment_invite', 'WHATSAPP', null, 'Hi {{candidate_name}}, you have been invited to complete an assessment for {{job_title}}. Please open your secure link within 48 hours: {{assessment_link}}', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('247f8a51-9563-4d81-8f5a-60d6311bf7bc', 'stage_ai_screening', 'WHATSAPP', null, 'Hi {{candidate_name}}, your application for {{job_title}} is now being reviewed by our screening team.', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('2593240e-f184-40fd-a281-d203bad159fe', 'stage_rejected', 'WHATSAPP', null, 'Hi {{candidate_name}}, thank you for your interest in {{job_title}}. After careful review we will not be progressing your application this time. We appreciate the time you invested and wish you every success.', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('4262682e-49c4-4c89-9c62-66254eb66cdc', 'stage_interview', 'WHATSAPP', null, 'Hi {{candidate_name}}, you have reached the interview stage for {{job_title}}. We will be in touch shortly to arrange a time.', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('4612ee00-d2c4-49b0-ab69-e112641d69d5', 'status_update', 'WHATSAPP', null, 'Hi {{candidate_name}}, an update on your application for {{job_title}}: your status is now {{stage}}. — {{company_name}}', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('4d1df73f-205d-491a-aaa8-2f4a4788862a', 'prospect_outreach_email', 'EMAIL', 'A role at {{company_name}} — {{job_title}}', 'Hello {{candidate_name}},

I came across your profile and your background looks like a strong match for {{job_title}} at {{company_name}}.

We are hiring for this role now. If you would like to hear more, reply to this email and I will send the details.

Best regards,
{{company_name}} Talent Team', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('70b6ce1a-dfbd-4be8-a44a-39852cfdcf2f', 'offer_letter', 'EMAIL', 'Offer from Sharm Dreams Group', 'Dear {{candidate_name}},

Congratulations! We are pleased to offer you the position of {{job_title}}. The formal documents are attached.

Warm regards,
{{company_name}} Talent Team', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('70fd1eb0-acce-45e6-98b2-dbc7960a20d2', 'stage_hired', 'WHATSAPP', null, 'Welcome aboard, {{candidate_name}}! The {{job_title}} team is looking forward to having you.', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('88ac3d05-0a62-4a36-b2df-e65b8edf8ec2', 'interview_scheduled', 'EMAIL', 'Interview confirmed — {{job_title}}', 'Dear {{candidate_name}},

Your interview for {{job_title}} is confirmed for {{scheduled_at}}. Joining details: {{meeting_link}}

Kind regards,
{{company_name}} Talent Team', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('8b73ba52-cb90-4b8f-aa59-72148c722617', 'prospect_outreach_whatsapp', 'WHATSAPP', null, 'Hi {{candidate_name}}, this is {{company_name}}. Your profile looked like a strong match for {{job_title}} — are you open to hearing more?', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('9972884a-a30a-4bd7-a53c-8712d7b0f72e', 'interview_cancelled', 'WHATSAPP', null, 'Hi {{candidate_name}}, we have cancelled your interview for {{job_title}} that was set for {{interview_when}}. We will be in touch to arrange another time.', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('a274a266-a072-40a4-a756-4a536bd1f3c5', 'stage_new', 'WHATSAPP', null, 'Hi {{candidate_name}}, your application for {{job_title}} is active in our pipeline again. We will keep you updated here.', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('a8e1eb10-eb3c-4ff8-b296-847e95718cfb', 'interview_changed', 'WHATSAPP', null, 'Hi {{candidate_name}}, we have moved your interview for {{job_title}} to {{interview_when}} (about {{interview_duration}} minutes).{{interview_link}}', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('ab829fd0-871a-4b78-9d6c-f954023ee07c', 'interview_scheduled', 'WHATSAPP', null, 'Hi {{candidate_name}}, your interview for {{job_title}} is confirmed for {{interview_when}} (about {{interview_duration}} minutes).{{interview_link}}', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('d72c779d-e047-4005-a24e-85966f1417e0', 'application_received', 'EMAIL', 'We received your application — {{job_title}}', 'Dear {{candidate_name}},

Thank you for applying to {{job_title}} at Sharm Dreams Group. Our team is reviewing your application and you will hear from us shortly.

Best regards,
{{company_name}} Talent Team', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('e3559bbb-6522-4c7e-9345-4ffa65a73373', 'stage_offer', 'WHATSAPP', null, 'Hi {{candidate_name}}, we are excited to move forward with an offer for {{job_title}}. The details are on their way.', true) on conflict (id) do nothing;
insert into public.notification_templates (id, key, channel, subject, body, is_active) values ('f18187d8-33ed-4d20-9c9f-028d8e4a3c1f', 'stage_assessment', 'WHATSAPP', null, 'Hi {{candidate_name}}, good news — you have moved to the assessment stage for {{job_title}}. {{assessment_link}}', true) on conflict (id) do nothing;
insert into public.ai_model_config (capability, primary_model, fallback_model, temperature, max_tokens, is_enabled, updated_by) values ('assistant', 'qoder:qfmodel', 'gemini-3.1-flash-lite', '0.20', '1500', true, null) on conflict (capability) do nothing;
insert into public.ai_model_config (capability, primary_model, fallback_model, temperature, max_tokens, is_enabled, updated_by) values ('case_reasoning', 'qoder:qfmodel', 'google/gemma-4-26b-a4b-it:free', '0.30', '1200', true, null) on conflict (capability) do nothing;
insert into public.ai_model_config (capability, primary_model, fallback_model, temperature, max_tokens, is_enabled, updated_by) values ('feedback', 'qoder:qfmodel', 'google/gemma-4-26b-a4b-it:free', '0.30', '1200', true, null) on conflict (capability) do nothing;
insert into public.ai_model_config (capability, primary_model, fallback_model, temperature, max_tokens, is_enabled, updated_by) values ('interview_questions', 'qoder:qfmodel', 'google/gemma-4-31b-it:free', '0.30', '1200', true, null) on conflict (capability) do nothing;
insert into public.ai_model_config (capability, primary_model, fallback_model, temperature, max_tokens, is_enabled, updated_by) values ('resume_screening', 'qoder:qfmodel', 'google/gemma-4-26b-a4b-it:free', '0.30', '1200', true, null) on conflict (capability) do nothing;
insert into public.ai_model_config (capability, primary_model, fallback_model, temperature, max_tokens, is_enabled, updated_by) values ('soft_skills', 'qoder:qfmodel', 'google/gemma-4-31b-it:free', '0.30', '1200', true, null) on conflict (capability) do nothing;
insert into public.ai_model_config (capability, primary_model, fallback_model, temperature, max_tokens, is_enabled, updated_by) values ('transcription', 'qoder:qfmodel', 'google/gemma-4-26b-a4b-it:free', '0.30', '1200', true, null) on conflict (capability) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('1d857a23-d215-492d-b321-67e89a0d0e73', null, 'Sales & Marketing', 'sales-marketing', 'Revenue, reservations, digital and brand', null, true, '70') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('26eb6bbc-9953-4aeb-aedf-8a4aded104a6', null, 'Maintenance & Engineering', 'maintenance-engineering', 'Technical services, projects and facilities', null, true, '90') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('2966c2ae-608e-4ce6-9680-b1a7241e8c94', null, 'Rooms Division', 'rooms-division', 'Housekeeping and room operations', null, true, '50') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('2a2a5316-4f46-4319-9210-8e00c9f205bc', null, 'Legal & Compliance', 'legal-compliance', 'Contracts, governance and regulatory affairs', null, true, '120') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('37dcfed8-f31c-4174-9fa6-1f86401ad697', null, 'Food & Beverage', 'food-beverage', 'Restaurants, bars, banqueting and culinary teams', null, true, '40') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('451bf349-75e5-4153-9411-ce4c72554602', null, 'Human Resources', 'human-resources', 'Talent acquisition, L&D and people operations', null, true, '20') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('7012a011-aa13-4e36-a67b-0ad46da2d821', null, 'Real Estate & Development', 'real-estate-development', 'Acquisition, design, construction and handover', null, true, '80') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('9ed9eba5-2b53-4ad5-9da2-5204110fafc1', null, 'Commercial & Procurement', 'commercial-procurement', 'Sourcing, supplier management and cost control', null, true, '130') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('9faf5e98-d3bd-4ecd-94a6-c442fda00aa4', null, 'Finance & Investment', 'finance-investment', 'FP&A, treasury, audit and investment analysis', null, true, '10') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('a99228ae-3b6e-4186-b970-8fd4a316f315', null, 'Spa & Wellness', 'spa-wellness', 'Spa, fitness and recreation services', null, true, '60') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('c5883db4-3e95-4647-8d07-08303dcde41a', null, 'Information Technology', 'information-technology', 'Platform, infrastructure and digital products', null, true, '110') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('daaa1e79-45a1-4974-b520-afb63df23b59', null, 'Front Office & Guest Relations', 'front-office', 'Reception, concierge and guest experience leadership', null, true, '30') on conflict (id) do nothing;
insert into public.departments (id, tenant_id, name, slug, description, head_profile_id, is_active, sort_order) values ('fe5d8e30-0391-4d17-872d-c419e4c58a42', null, 'Operations & Administration', 'operations-administration', 'Resort operations, admin and procurement', null, true, '100') on conflict (id) do nothing;
insert into public.locations (id, tenant_id, name, city, governorate, country, timezone, address, is_active, sort_order) values ('9741a70a-bc4a-4205-831f-6a9b0397a732', null, 'Marsa Alam', 'Marsa Alam', 'Red Sea', 'Egypt', 'Africa/Cairo', null, true, '30') on conflict (id) do nothing;
insert into public.locations (id, tenant_id, name, city, governorate, country, timezone, address, is_active, sort_order) values ('99378870-91a1-459b-b3b8-54ab3d022d45', null, 'Sharm El Sheikh', 'Sharm El Sheikh', 'South Sinai', 'Egypt', 'Africa/Cairo', null, true, '10') on conflict (id) do nothing;
insert into public.locations (id, tenant_id, name, city, governorate, country, timezone, address, is_active, sort_order) values ('a12c082a-ed5c-48d6-8af5-3632290414ce', null, 'Hurghada', 'Hurghada', 'Red Sea', 'Egypt', 'Africa/Cairo', null, true, '50') on conflict (id) do nothing;
insert into public.locations (id, tenant_id, name, city, governorate, country, timezone, address, is_active, sort_order) values ('a5da8c33-7c0c-4c1f-a51f-affade3bd3a0', null, 'Cairo (Head Office)', 'Cairo', 'Cairo', 'Egypt', 'Africa/Cairo', null, true, '40') on conflict (id) do nothing;
insert into public.locations (id, tenant_id, name, city, governorate, country, timezone, address, is_active, sort_order) values ('ba4e7c27-b6d7-4bf9-9201-9adcb4ca5bd3', null, 'Sahl Hasheesh', 'Hurghada', 'Red Sea', 'Egypt', 'Africa/Cairo', null, true, '20') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('11d30530-7713-4e82-9e9b-0f99d3c72c42', 'FOOD_BEVERAGE', 'Food & Beverage', 'Culinary and beverage service leadership', null, true, '50') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('1cfad917-8d8f-424e-9536-ad865c13515d', 'ENGINEERING', 'Engineering & Maintenance', 'Technical services, HVAC, electrical and projects', null, true, '100') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('29ca01d4-3484-4a5a-b6c6-aeeff73527f1', 'SALES', 'Sales', 'Consultative selling and revenue generation', null, true, '70') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('324e685c-2af1-4f48-a219-7d8307e6edc0', 'GENERAL', 'General', 'Any role without a specific family', null, true, '900') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('3d2a7ba7-5f9d-439e-a848-1c68d9599d79', 'IT', 'Information Technology', 'Software, infrastructure and support', 'c5883db4-3e95-4647-8d07-08303dcde41a', true, '120') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('56d17859-e419-46dd-bf63-6b2f75fa75bc', 'REAL_ESTATE', 'Real Estate & Development', 'Property development, design and delivery', '7012a011-aa13-4e36-a67b-0ad46da2d821', true, '110') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('75b109fe-2934-4e5c-a839-13d1ac5c00b7', 'HR', 'Human Resources', 'People operations, L&D and employee relations', null, true, '90') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('84332352-3cd8-4948-9e35-4107b2917068', 'INVESTMENTS', 'Investments', 'Deal analysis, valuation and portfolio management', '9faf5e98-d3bd-4ecd-94a6-c442fda00aa4', true, '20') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('b1a407a6-f121-4318-81c4-6690dd555236', 'HOUSEKEEPING', 'Housekeeping', 'Rooms and public-area housekeeping supervision', null, true, '60') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('b54151a9-5f9f-4c94-b56c-c41b6756056e', 'LEGAL', 'Legal & Compliance', 'Contracts and regulatory affairs', '2a2a5316-4f46-4319-9210-8e00c9f205bc', true, '130') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('c595bcb8-3ef3-43bd-9bc8-7dd08ba456e0', 'RECRUITING', 'Recruiting & Talent Acquisition', 'Sourcing, screening and talent pipeline ownership', null, true, '80') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('cc1259e7-8148-46d6-b0f2-40342f8a8194', 'HOSPITALITY_OPS', 'Hospitality Operations', 'Front office, rooms, F&B and guest experience operations', 'daaa1e79-45a1-4974-b520-afb63df23b59', true, '40') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', 'FINANCE', 'Finance', 'Financial planning, analysis, controlling and investment roles', '9faf5e98-d3bd-4ecd-94a6-c442fda00aa4', true, '10') on conflict (id) do nothing;
insert into public.role_families (id, key, label, description, department_id, is_active, sort_order) values ('fa65ab11-0fd6-49d3-849a-7496fdf8acc7', 'ACCOUNTING', 'Accounting', 'Bookkeeping, reporting, audit and statutory compliance', '9faf5e98-d3bd-4ecd-94a6-c442fda00aa4', true, '30') on conflict (id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('84332352-3cd8-4948-9e35-4107b2917068', '3bd76603-11f7-48c5-ad23-a8fe4e4ba189', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('84332352-3cd8-4948-9e35-4107b2917068', '3c49f772-5ef4-4059-b1c8-6c5c2e72033d', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('84332352-3cd8-4948-9e35-4107b2917068', '52bfc474-6b7c-4d68-9026-d9cfd4e97787', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('84332352-3cd8-4948-9e35-4107b2917068', '6c44be0e-d857-4e23-b87b-1b4300dcd6c3', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('84332352-3cd8-4948-9e35-4107b2917068', '85f3689a-e724-4644-a3c9-bff86faf652d', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('84332352-3cd8-4948-9e35-4107b2917068', '8afaa440-822c-4de9-ab43-18601685a3eb', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('84332352-3cd8-4948-9e35-4107b2917068', '9e64311b-09a2-4dc3-bb5b-46078ea987e4', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('c595bcb8-3ef3-43bd-9bc8-7dd08ba456e0', '0b557061-3cb7-4323-bfc9-f3ba9732f5b8', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('c595bcb8-3ef3-43bd-9bc8-7dd08ba456e0', '3c49f772-5ef4-4059-b1c8-6c5c2e72033d', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('c595bcb8-3ef3-43bd-9bc8-7dd08ba456e0', '52bfc474-6b7c-4d68-9026-d9cfd4e97787', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('c595bcb8-3ef3-43bd-9bc8-7dd08ba456e0', '6c44be0e-d857-4e23-b87b-1b4300dcd6c3', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('c595bcb8-3ef3-43bd-9bc8-7dd08ba456e0', '75f500e4-e6d7-4940-a5be-13e070f23a8a', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('c595bcb8-3ef3-43bd-9bc8-7dd08ba456e0', 'a03c5478-9ac2-4cbc-9aca-aab8a92874c6', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('cc1259e7-8148-46d6-b0f2-40342f8a8194', '03285f08-782d-4513-ab2e-40578d7c60a4', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('cc1259e7-8148-46d6-b0f2-40342f8a8194', '10afbbba-59a9-4e3d-97c6-261cabac422b', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('cc1259e7-8148-46d6-b0f2-40342f8a8194', '8a80e3eb-250f-4d28-ab84-cbda939336bd', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('cc1259e7-8148-46d6-b0f2-40342f8a8194', 'a03c5478-9ac2-4cbc-9aca-aab8a92874c6', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('cc1259e7-8148-46d6-b0f2-40342f8a8194', 'ca97d266-6693-45bd-b333-8d2cb4b566e3', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', '0c946e32-c508-4d23-90e4-27846554cdcc', '3', '1.00') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', '3bd76603-11f7-48c5-ad23-a8fe4e4ba189', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', '52bfc474-6b7c-4d68-9026-d9cfd4e97787', '3', '1.00') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', '6c44be0e-d857-4e23-b87b-1b4300dcd6c3', '3', '1.00') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', '6d7d784d-6eab-48e6-b4bb-4e1cb9b6b109', '4', '1.00') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', '85f3689a-e724-4644-a3c9-bff86faf652d', '5', '1.50') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', '8a80e3eb-250f-4d28-ab84-cbda939336bd', '3', '1.00') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', 'ca97d266-6693-45bd-b333-8d2cb4b566e3', '3', '1.00') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', 'e49d77ec-ae1b-4f6b-8dbf-677ff9baa886', '4', '1.00') on conflict (role_family_id, skill_id) do nothing;
insert into public.role_family_skills (role_family_id, skill_id, required_level, weight) values ('f7ecd8d2-d33c-46f0-a318-f48875376621', 'ee4bc38d-1746-417c-ab4b-02f99c3f9d43', '4', '1.00') on conflict (role_family_id, skill_id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('04f20d3a-1484-421f-a4a5-245dd3472962', 'GLOBAL', null, 'notifications.whatsapp_enabled', 'true', 'Send candidate WhatsApp updates', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('05729e75-55eb-4dde-9455-331e7352782e', 'GLOBAL', null, 'ai.enabled', 'true', 'Master switch for all AI features', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('35211a06-533e-4ade-aa8d-f178254b381a', 'GLOBAL', null, 'organisation.timezone', '"Africa/Cairo"', 'Used for interview scheduling and reports', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('4072e650-dc25-464b-8270-b00466027b08', 'GLOBAL', null, 'security.require_oauth', 'false', 'Force single sign-on for all staff', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('43b38a61-746d-4d81-87d9-a03e813198a2', 'GLOBAL', null, 'assessment.autosave_interval_seconds', '20', 'Draft save frequency during a test', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('50455f6d-0281-48e6-aa62-930cb688fbb3', 'GLOBAL', null, 'security.session_timeout_minutes', '480', 'Idle timeout for staff sessions', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('51fee2b4-2967-4c49-b853-1ad16989ebf4', 'GLOBAL', null, 'assessment.default_duration_minutes', '60', 'Default test time limit', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('538937c1-123a-4176-9e2a-4557a06cf6da', 'GLOBAL', null, 'ai.auto_screen_applications', 'true', 'Run CV screening automatically on new applications', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('5c794bea-4a8d-47c7-acae-3407b862540a', 'GLOBAL', null, 'assessment.lock_on_expiry', 'true', 'Auto-submit when the countdown reaches zero', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('5fd68a52-b2b0-4b84-ba0d-06c150be0597', 'GLOBAL', null, 'notifications.notify_on_stage_change', 'true', 'Alert candidates when their stage changes', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('67b3f924-e946-4e62-886f-a951fd509a92', 'GLOBAL', null, 'security.mask_scores_for_reviewers', 'true', 'Hide AI scores from interviewers', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('69f16093-d155-42a6-950c-c7765dc08e43', 'GLOBAL', null, 'ai.generate_feedback', 'true', 'Send personalised feedback after each decision', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('75560bc5-4d93-45ea-981e-229ff185aac5', 'GLOBAL', null, 'ai.match_threshold_reject', '40', 'Match score below which a candidate is auto-rejected', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('7bb8f2e2-c9a9-4cac-b781-34e6c94c68b5', 'GLOBAL', null, 'notifications.email_enabled', 'true', 'Send candidate email updates', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('7f5bc615-6f7e-40ee-ab0c-8de32ed8e180', 'GLOBAL', null, 'notifications.in_app_enabled', 'true', null, false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('9796dfed-16fc-4e9f-b1c7-913e1aa3f33b', 'GLOBAL', null, 'assessment.track_focus_changes', 'true', 'Record focus changes for integrity review', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('9a38bac0-3b9c-4418-b9d8-c68c540a9d3b', 'GLOBAL', null, 'ai.interview_questions', 'true', 'Generate targeted interview questions from resume gaps', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('b33fa688-45c1-4923-ba91-6ed1f731a14e', 'GLOBAL', null, 'branding.logo_url', '"/sdg-icon.png"', 'Wordmark shown on portals and assessments', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('b3cd7f66-1dad-4d16-beb2-b4b79a2a12bd', 'GLOBAL', null, 'assessment.link_validity_hours', '48', 'How long an invitation link stays usable', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('b5ccefdb-d60a-4291-a3fb-1ae433fb512c', 'GLOBAL', null, 'security.password_min_length', '12', 'Minimum password length for staff accounts', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('b8147133-74db-4639-9a1c-708c883fa689', 'GLOBAL', null, 'ai.match_threshold_advance', '75', 'Minimum match score to auto-advance a candidate', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('b87d6fad-65cb-4223-a378-bd9749f6d22b', 'GLOBAL', null, 'organisation.name', '"Sharm Dreams Group"', 'Displayed across portals and email templates', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('d97511eb-cc7f-468f-aab3-f6d02155c402', 'GLOBAL', null, 'organisation.support_email', '"careers@sharmdreamsgroup.com"', 'Reply-to address for candidate communications', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('e318c32b-c1da-471e-98f1-201675eb1a1b', 'GLOBAL', null, 'ai.bias_reduction', 'true', 'Strip demographic markers before sending CVs to models', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('e677f3b8-6fd5-4c53-9c4f-2cdcc9302b02', 'GLOBAL', null, 'organisation.enabled_locales', '["en", "ar"]', 'Languages offered to candidates', false, null) on conflict (id) do nothing;
insert into public.app_settings (id, scope, company_id, key, value, description, is_secret, updated_by) values ('f60b515b-fd34-493b-acda-02ad08f06880', 'GLOBAL', null, 'organisation.locale', '"en"', 'Default interface language', false, null) on conflict (id) do nothing;
-- 226 reference rows above. Their order is load-bearing: parents before children.

-- ============================================================================
-- FILES — OUR OWN STORAGE TABLE (authored, not dumped)
-- Added by Plan 2 Task 2 (spec §15). The eight policies below mirror, one for
-- one, the eight `storage.objects` policies that used to sit in this file, so a
-- candidate video kept the same rule it always had: the anonymous attempt token
-- that is the first path segment. The predicates differ only in shape —
-- `(storage.foldername(name))[1]` became `split_part(path, '/', 1)` because the
-- foldername function belonged to the vendor's storage schema.
--
-- Task 10 deleted those eight policies, the `storage` grants and the four
-- `storage.buckets` rows. Nothing in this file needs the `storage` schema now,
-- and nothing under `src` ever queried it after the cut-over: `files` is the
-- only metadata table, the disk under `UPLOADS_ROOT` the only byte store.
--
-- Bytes live on disk under /data/uploads/<bucket>/<path>; this table is what
-- makes a path listable, sized and typed. There is no `owner` column: the
-- FileStore carries no session, so no writer could fill it and no reader would
-- ever query it (spec §7 correction 4).
--
-- Writes go through the app's own pool, so these policies bind the PostgREST
-- door — the File Manager's listings and metadata reads. No UPDATE policy
-- exists because nothing updates a row in place: a re-upload replaces the bytes
-- and upserts the same key.
-- ============================================================================

create table if not exists public.files (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  mime text,
  bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint files_bucket_path_key unique (bucket, path)
);

-- The listing walks a prefix, which a plain btree on text cannot serve without
-- operator classes: text_pattern_ops makes `starts_with` an index scan.
create index if not exists files_bucket_path_prefix_idx on public.files (bucket, path text_pattern_ops);

alter table public.files enable row level security;

grant select, insert on table public.files to anon;
grant select, insert, update, delete on table public.files to authenticated;
grant all on table public.files to service_role;

drop policy if exists "candidate video uploads" on public.files;
create policy "candidate video uploads" on public.files
  for insert
  to anon, authenticated
  with check (((bucket = 'candidate-videos'::text) AND (split_part(path, '/'::text, 1) = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'attempt_token'::text))));
drop policy if exists "candidates upload cvs" on public.files;
create policy "candidates upload cvs" on public.files
  for insert
  to anon, authenticated
  with check ((bucket = 'candidate-cvs'::text));
drop policy if exists "public resume uploads" on public.files;
create policy "public resume uploads" on public.files
  for insert
  to anon
  with check (((bucket = 'resumes'::text) AND (split_part(path, '/'::text, 1) = 'public'::text)));
drop policy if exists "staff delete candidate cvs" on public.files;
create policy "staff delete candidate cvs" on public.files
  for delete
  to authenticated
  using (((bucket = 'candidate-cvs'::text) AND is_staff()));
drop policy if exists "staff delete candidate media" on public.files;
create policy "staff delete candidate media" on public.files
  for delete
  to authenticated
  using (((bucket = ANY (ARRAY['candidate-videos'::text, 'candidate-audio'::text, 'resumes'::text])) AND is_staff()));
drop policy if exists "staff read candidate cvs" on public.files;
create policy "staff read candidate cvs" on public.files
  for select
  to authenticated
  using (((bucket = 'candidate-cvs'::text) AND is_staff()));
drop policy if exists "staff read candidate media" on public.files;
create policy "staff read candidate media" on public.files
  for select
  to authenticated
  using (((bucket = ANY (ARRAY['candidate-videos'::text, 'candidate-audio'::text, 'resumes'::text])) AND is_staff()));
drop policy if exists "staff upload candidate media" on public.files;
create policy "staff upload candidate media" on public.files
  for insert
  to authenticated
  with check (((bucket = ANY (ARRAY['resumes'::text, 'candidate-audio'::text])) AND is_staff() AND has_permission('candidates.write'::text) AND (split_part(path, '/'::text, 1) = 'applications'::text)));
