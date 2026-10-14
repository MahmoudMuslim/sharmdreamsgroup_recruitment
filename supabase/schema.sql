-- ============================================================================
-- Sharm Dreams Group — HRMS / ATS / Skill Assessment Platform
-- Complete schema: DDL + RLS + storage buckets + seed data
-- Target: Supabase project lbxdeceropsxwohnzinl (PostgreSQL 17)
-- Idempotent: safe to re-run.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- ENUMS
-- ============================================================================

do $$ begin
  create type user_role as enum ('SUPER_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'CANDIDATE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type business_sector as enum ('HOSPITALITY', 'REAL_ESTATE', 'COMMERCIAL_DEVELOPMENT', 'CORPORATE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type application_stage as enum ('NEW', 'AI_SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type application_source as enum ('LINKEDIN', 'WHATSAPP', 'JOB_BOARD', 'CAREER_SITE', 'REFERRAL', 'ATS_IMPORT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type question_type as enum ('EXCEL_MODEL', 'VIDEO_PITCH', 'CASE_STUDY', 'MULTIPLE_CHOICE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attempt_status as enum ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'GRADED', 'EXPIRED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ats_provider as enum ('GREENHOUSE', 'LEVER', 'FRAPPE_HR', 'LINKEDIN_APPLY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type integration_status as enum ('CONNECTED', 'PENDING', 'ERROR', 'DISCONNECTED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_channel as enum ('WHATSAPP', 'EMAIL', 'IN_APP');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_direction as enum ('INBOUND', 'OUTBOUND');
exception when duplicate_object then null; end $$;

do $$ begin
  create type interview_status as enum ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
exception when duplicate_object then null; end $$;

do $$ begin
  create type calendar_provider as enum ('GOOGLE', 'MICROSOFT', 'MANUAL');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

create table if not exists tenants_and_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sector business_sector not null,
  country text not null default 'Egypt',
  created_at timestamptz not null default now()
);

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  tenant_id uuid references tenants_and_companies (id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  role user_role not null default 'CANDIDATE',
  avatar_url text,
  locale text not null default 'en' check (locale in ('en', 'ar', 'ru', 'de')),
  created_at timestamptz not null default now()
);

create table if not exists job_openings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants_and_companies (id) on delete cascade,
  title text not null,
  department text not null,
  sector business_sector not null,
  location text not null,
  employment_type text not null default 'FULL_TIME' check (employment_type in ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP')),
  description text not null,
  requirements jsonb not null default '[]'::jsonb,
  min_salary_usd integer,
  max_salary_usd integer,
  status job_status not null default 'DRAFT',
  posted_at timestamptz,
  closing_at timestamptz,
  created_by uuid references user_profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_openings_tenant on job_openings (tenant_id);
create index if not exists idx_job_openings_status on job_openings (status);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job_openings (id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  cv_file_path text,
  cv_text text,
  tracking_code text not null unique,
  stage application_stage not null default 'NEW',
  source application_source not null default 'CAREER_SITE',
  ai_match_score numeric,
  ai_screening_summary text,
  ai_strengths jsonb,
  ai_gaps jsonb,
  ai_soft_skills jsonb,
  ai_feedback text,
  diversity_flags jsonb,
  rejection_reason text,
  hired_at timestamptz,
  -- Staff filing door: set means hidden from every staff read, never deleted.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_applications_job on applications (job_id);
create index if not exists idx_applications_stage on applications (stage);
create index if not exists idx_applications_created on applications (created_at);
create index if not exists idx_applications_live on applications (created_at desc)
  where archived_at is null;

create table if not exists assessment_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants_and_companies (id) on delete cascade,
  name text not null,
  description text not null default '',
  role_family text not null default 'GENERAL',
  time_limit_minutes integer not null default 60 check (time_limit_minutes between 5 and 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists assessment_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references assessment_templates (id) on delete cascade,
  question_type question_type not null,
  title text not null,
  prompt text not null,
  config jsonb not null default '{}'::jsonb,
  points integer not null default 10 check (points > 0),
  position integer not null default 0
);

create index if not exists idx_assessment_questions_template on assessment_questions (template_id);

create table if not exists candidate_attempts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  template_id uuid not null references assessment_templates (id) on delete restrict,
  access_token text not null unique,
  status attempt_status not null default 'NOT_STARTED',
  time_limit_minutes integer not null default 60,
  started_at timestamptz,
  expires_at timestamptz,
  submitted_at timestamptz,
  total_score numeric,
  max_score numeric,
  draft_saved_at timestamptz,
  current_index_hint integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_candidate_attempts_application on candidate_attempts (application_id);
create index if not exists idx_candidate_attempts_token on candidate_attempts (access_token);

create table if not exists candidate_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references candidate_attempts (id) on delete cascade,
  question_id uuid not null references assessment_questions (id) on delete cascade,
  answer_text text,
  spreadsheet_state jsonb,
  video_path text,
  video_duration_seconds integer,
  transcript text,
  score numeric,
  max_score integer not null default 10,
  ai_evaluation jsonb,
  updated_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index if not exists idx_candidate_responses_attempt on candidate_responses (attempt_id);

create table if not exists ats_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants_and_companies (id) on delete cascade,
  provider ats_provider not null,
  status integration_status not null default 'PENDING',
  credentials jsonb,
  webhook_secret text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table if not exists communication_logs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications (id) on delete cascade,
  channel message_channel not null,
  direction message_direction not null,
  recipient text not null,
  -- EMAIL only: the subject line the candidate was actually sent, so the
  -- outbox can re-send a failed row without re-rendering a template.
  subject text,
  -- IN_APP only: null means the candidate has not opened the notice yet.
  read_at timestamptz,
  body text not null,
  delivered boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_communication_logs_application on communication_logs (application_id);
create index if not exists idx_communication_logs_unread
  on communication_logs (application_id, created_at desc)
  where channel = 'IN_APP' and read_at is null;

create table if not exists interview_schedules (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  interviewer_profile_id uuid references user_profiles (id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 45 check (duration_minutes between 15 and 240),
  calendar_provider calendar_provider not null default 'MANUAL',
  calendar_event_id text,
  meeting_link text,
  status interview_status not null default 'SCHEDULED',
  created_at timestamptz not null default now()
);

create index if not exists idx_interview_schedules_application on interview_schedules (application_id);

create table if not exists onboarding_plans (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  tenant_id uuid not null references tenants_and_companies (id) on delete cascade,
  checklist jsonb not null default '[]'::jsonb,
  skill_gaps jsonb not null default '[]'::jsonb,
  internal_mobility_suggestions jsonb not null default '[]'::jsonb,
  retention_risk_score numeric,
  progress numeric not null default 0 check (progress between 0 and 100),
  generated_by_ai boolean not null default false,
  created_at timestamptz not null default now(),
  unique (application_id)
);

-- updated_at trigger
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists trg_applications_updated_at on applications;
create trigger trg_applications_updated_at before update on applications
  for each row execute function set_updated_at();

drop trigger if exists trg_candidate_responses_updated_at on candidate_responses;
create trigger trg_candidate_responses_updated_at before update on candidate_responses
  for each row execute function set_updated_at();

-- ============================================================================
-- HELPERS: auth + RBAC
-- ============================================================================

create or replace function current_user_profile()
returns user_profiles
language sql stable security definer set search_path = public
as $$
  select * from user_profiles where auth_user_id = auth.uid();
$$;

create or replace function is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role in ('SUPER_ADMIN', 'RECRUITER', 'HIRING_MANAGER')
     from user_profiles where auth_user_id = auth.uid()),
    false
  );
$$;

create or replace function is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role = 'SUPER_ADMIN' from user_profiles where auth_user_id = auth.uid()),
    false
  );
$$;

create or replace function user_tenant_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select tenant_id from user_profiles where auth_user_id = auth.uid();
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table tenants_and_companies enable row level security;
alter table user_profiles enable row level security;
alter table job_openings enable row level security;
alter table applications enable row level security;
alter table assessment_templates enable row level security;
alter table assessment_questions enable row level security;
alter table candidate_attempts enable row level security;
alter table candidate_responses enable row level security;
alter table ats_integrations enable row level security;
alter table communication_logs enable row level security;
alter table interview_schedules enable row level security;
alter table onboarding_plans enable row level security;

-- --- tenants ---
drop policy if exists tenants_read on tenants_and_companies;
create policy tenants_read on tenants_and_companies
  for select using (true); -- public showcase of the group's companies

drop policy if exists tenants_admin_write on tenants_and_companies;
create policy tenants_admin_write on tenants_and_companies
  for all using (is_super_admin()) with check (is_super_admin());

-- --- user_profiles ---
drop policy if exists profiles_self_read on user_profiles;
create policy profiles_self_read on user_profiles
  for select using (auth_user_id = auth.uid() or is_staff());

drop policy if exists profiles_self_update on user_profiles;
create policy profiles_self_update on user_profiles
  for update using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

drop policy if exists profiles_admin_insert on user_profiles;
create policy profiles_admin_insert on user_profiles
  for insert with check (is_super_admin() or is_staff());

-- --- job_openings ---
drop policy if exists jobs_public_read on job_openings;
create policy jobs_public_read on job_openings
  for select using (status = 'PUBLISHED' or is_staff());

drop policy if exists jobs_staff_write on job_openings;
create policy jobs_staff_write on job_openings
  for all using (is_staff()) with check (is_staff());

-- --- applications ---
-- Staff see applications for jobs within their tenant (super admin sees all).
drop policy if exists applications_staff_read on applications;
create policy applications_staff_read on applications
  for select using (
    is_staff() and (
      is_super_admin()
      or user_tenant_id() is null
      or user_tenant_id() in (select tenant_id from job_openings where job_openings.id = applications.job_id)
    )
  );

drop policy if exists applications_staff_write on applications;
create policy applications_staff_write on applications
  for all using (
    is_staff() and (
      is_super_admin()
      or user_tenant_id() is null
      or user_tenant_id() in (select tenant_id from job_openings where job_openings.id = applications.job_id)
    )
  ) with check (
    is_staff() and (
      is_super_admin()
      or user_tenant_id() is null
      or user_tenant_id() in (select tenant_id from job_openings where job_openings.id = applications.job_id)
    )
  );

-- Public apply: anyone may INSERT an application (server action uses anon key).
drop policy if exists applications_public_insert on applications;
create policy applications_public_insert on applications
  for insert with check (true);

-- Candidates (logged-in CANDIDATE role) may read their own applications by email.
drop policy if exists applications_candidate_self on applications;
create policy applications_candidate_self on applications
  for select using (
    exists (
      select 1 from user_profiles up
      where up.auth_user_id = auth.uid()
        and up.role = 'CANDIDATE'
        and lower(up.email) = lower(applications.email)
    )
  );

-- --- assessment_templates / questions ---
drop policy if exists templates_staff_read on assessment_templates;
create policy templates_staff_read on assessment_templates
  for select using (is_active or is_staff());

drop policy if exists templates_staff_write on assessment_templates;
create policy templates_staff_write on assessment_templates
  for all using (is_staff()) with check (is_staff());

drop policy if exists questions_read on assessment_questions;
create policy questions_read on assessment_questions
  for select using (
    exists (
      select 1 from assessment_templates t
      where t.id = assessment_questions.template_id
        and (t.is_active or is_staff())
    )
  );

drop policy if exists questions_staff_write on assessment_questions;
create policy questions_staff_write on assessment_questions
  for all using (is_staff()) with check (is_staff());

-- --- candidate_attempts ---
-- Candidates access their attempt ONLY via the secure access token, supplied
-- as `attempt_token=...` query parameter. The token is an unguessable
-- 128-bit secret (gen_random_uuid + sha256).
drop policy if exists attempts_token_read on candidate_attempts;
create policy attempts_token_read on candidate_attempts
  for select using (
    is_staff()
    or (select current_setting('request.jwt.claims', true)::jsonb ->> 'attempt_token' = access_token)
  );

-- Anonymous start/submit with token: handled by server actions using the
-- service role, so no direct anon write policy is exposed.
drop policy if exists attempts_staff_write on candidate_attempts;
create policy attempts_staff_write on candidate_attempts
  for all using (is_staff()) with check (is_staff());

-- --- candidate_responses ---
drop policy if exists responses_token_read on candidate_responses;
create policy responses_token_read on candidate_responses
  for select using (
    is_staff()
    or (
      select current_setting('request.jwt.claims', true)::jsonb ->> 'attempt_token'
    ) in (
      select access_token from candidate_attempts where candidate_attempts.id = candidate_responses.attempt_id
    )
  );

drop policy if exists responses_token_update on candidate_responses;
create policy responses_token_update on candidate_responses
  for update using (
    (select current_setting('request.jwt.claims', true)::jsonb ->> 'attempt_token') in (
      select access_token from candidate_attempts where candidate_attempts.id = candidate_responses.attempt_id
    )
  ) with check (true);

drop policy if exists responses_token_insert on candidate_responses;
create policy responses_token_insert on candidate_responses
  for insert with check (
    (select current_setting('request.jwt.claims', true)::jsonb ->> 'attempt_token') in (
      select access_token from candidate_attempts where candidate_attempts.id = candidate_responses.attempt_id
    )
  );

drop policy if exists responses_staff_all on candidate_responses;
create policy responses_staff_all on candidate_responses
  for all using (is_staff()) with check (is_staff());

-- --- ats_integrations ---
drop policy if exists ats_read on ats_integrations;
create policy ats_read on ats_integrations
  for select using (is_super_admin() or (is_staff() and tenant_id = user_tenant_id()));

drop policy if exists ats_write on ats_integrations;
create policy ats_write on ats_integrations
  for all using (is_super_admin()) with check (is_super_admin());

-- --- communication_logs ---
drop policy if exists comms_staff_read on communication_logs;
create policy comms_staff_read on communication_logs
  for select using (is_staff());

drop policy if exists comms_staff_write on communication_logs;
create policy comms_staff_write on communication_logs
  for all using (is_staff()) with check (is_staff());

-- --- interview_schedules ---
drop policy if exists interviews_staff_all on interview_schedules;
create policy interviews_staff_all on interview_schedules
  for all using (is_staff()) with check (is_staff());

-- --- onboarding_plans ---
drop policy if exists onboarding_staff_all on onboarding_plans;
create policy onboarding_staff_all on onboarding_plans
  for all using (is_staff()) with check (is_staff());

-- ============================================================================
-- REALTIME
-- ============================================================================

do $$ begin
  alter publication supabase_realtime add table applications;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table candidate_attempts;
exception when duplicate_object then null; end $$;

-- ============================================================================
-- STORAGE BUCKETS + POLICIES
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('candidate-videos', 'candidate-videos', false, 52428800, array['video/webm', 'video/mp4']),
  ('candidate-audio', 'candidate-audio', false, 20971520, array['audio/webm', 'audio/mpeg', 'audio/mp4']),
  ('resumes', 'resumes', false, 10485760, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Videos/audio upload only while holding the attempt token (draft path is
-- service-role on the server; this policy covers direct candidate uploads).
drop policy if exists "candidate video uploads" on storage.objects;
create policy "candidate video uploads" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'candidate-videos'
    and (storage.foldername(name))[1] = current_setting('request.jwt.claims', true)::jsonb ->> 'attempt_token'
  );

-- Resumes uploaded through the public application form (path prefix "public/").
drop policy if exists "public resume uploads" on storage.objects;
create policy "public resume uploads" on storage.objects
  for insert to anon
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = 'public');

-- Staff read all candidate media.
drop policy if exists "staff read candidate media" on storage.objects;
create policy "staff read candidate media" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('candidate-videos', 'candidate-audio', 'resumes')
    and is_staff()
  );

-- ============================================================================
-- SEED DATA — Sharm Dreams Group companies
-- ============================================================================

insert into tenants_and_companies (id, name, slug, sector, country) values
  ('11111111-1111-1111-1111-111111111101', 'Sharm Dreams Touristic', 'sharm-dreams-touristic', 'HOSPITALITY', 'Egypt'),
  ('11111111-1111-1111-1111-111111111102', 'Rowad Misr Development', 'rowad-misr', 'COMMERCIAL_DEVELOPMENT', 'Egypt'),
  ('11111111-1111-1111-1111-111111111103', 'Sharm Dreams Real Estate', 'sharm-dreams-realestate', 'REAL_ESTATE', 'Egypt'),
  ('11111111-1111-1111-1111-111111111104', 'SDG Corporate Shared Services', 'sdg-corporate', 'CORPORATE', 'Egypt')
on conflict (slug) do nothing;
