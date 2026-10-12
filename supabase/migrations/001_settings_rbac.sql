-- ============================================================================
-- Settings, RBAC (roles/permissions) and notification templates
-- Sharm Dreams Group — Talent Cloud
-- Idempotent: safe to re-run.
-- ============================================================================

do $$ begin
  create type app_role as enum (
    'SUPER_ADMIN',
    'SUBSIDIARY_HR_MANAGER',
    'RECRUITER',
    'HIRING_MANAGER',
    'INTERVIEWER',
    'CANDIDATE'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type settings_scope as enum ('GLOBAL', 'TENANT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invite_status as enum ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- app_settings — one row per setting key, optionally scoped to a company
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  scope settings_scope not null default 'GLOBAL',
  company_id uuid references tenants_and_companies (id) on delete cascade,
  key text not null,
  value jsonb not null default 'null'::jsonb,
  description text,
  is_secret boolean not null default false,
  updated_by uuid references user_profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Postgres treats NULL as distinct in unique constraints, so a plain
-- `unique (scope, company_id, key)` would never match GLOBAL rows (whose
-- company_id is NULL) and `ON CONFLICT` would fall through to an INSERT,
-- colliding on the primary key. Partial indexes give each scope its own
-- conflict target:
--   GLOBAL -> ON CONFLICT (key) WHERE scope = 'GLOBAL'
--   TENANT -> ON CONFLICT (company_id, key) WHERE scope = 'TENANT'
create unique index if not exists app_settings_global_key_uniq
  on app_settings (key)
  where scope = 'GLOBAL';

create unique index if not exists app_settings_tenant_key_uniq
  on app_settings (company_id, key)
  where scope = 'TENANT';

create index if not exists idx_app_settings_key on app_settings (key);

-- ---------------------------------------------------------------------------
-- settings_audit_log — who changed what, for compliance review
-- ---------------------------------------------------------------------------
create table if not exists settings_audit_log (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  company_id uuid references tenants_and_companies (id) on delete set null,
  previous_value jsonb,
  next_value jsonb,
  changed_by uuid references user_profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_settings_audit_key on settings_audit_log (key, changed_at desc);

-- ---------------------------------------------------------------------------
-- user_invites — staff onboarding without an existing auth account
-- ---------------------------------------------------------------------------
create table if not exists user_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  role app_role not null default 'RECRUITER',
  company_id uuid references tenants_and_companies (id) on delete set null,
  status invite_status not null default 'PENDING',
  invited_by uuid references user_profiles (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (email)
);

-- ---------------------------------------------------------------------------
-- notification_templates — email + WhatsApp copy with {{placeholders}}
-- ---------------------------------------------------------------------------
create table if not exists notification_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  channel text not null check (channel in ('EMAIL', 'WHATSAPP', 'IN_APP')),
  subject text,
  body text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_notification_templates_updated on notification_templates;
create trigger trg_notification_templates_updated before update on notification_templates
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RBAC — roles, permissions, and their mapping
-- ---------------------------------------------------------------------------
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  key app_role not null unique,
  label text not null,
  description text,
  is_system boolean not null default true
);

create table if not exists permissions (
  key text primary key,
  label text not null,
  group_name text not null,
  description text
);

create table if not exists role_permissions (
  role_key app_role not null references roles (key) on delete cascade,
  permission_key text not null references permissions (key) on delete cascade,
  granted boolean not null default true,
  primary key (role_key, permission_key)
);

-- Core roles
insert into roles (key, label, description) values
  ('SUPER_ADMIN', 'Super Admin', 'Unrestricted access across every company and setting'),
  ('SUBSIDIARY_HR_MANAGER', 'Subsidiary HR Manager', 'Full HR control within an assigned company only'),
  ('RECRUITER', 'Recruiter', 'Manage candidates, jobs and assessments for assigned companies'),
  ('HIRING_MANAGER', 'Hiring Manager', 'Review and interview candidates for assigned roles'),
  ('INTERVIEWER', 'Interviewer', 'Read-only candidate access with interview scheduling'),
  ('CANDIDATE', 'Candidate', 'Portal access to their own application only')
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description;

-- Granular permissions
insert into permissions (key, label, group_name, description) values
  ('candidates.read', 'View candidates', 'Candidates', 'See candidate profiles and pipelines'),
  ('candidates.write', 'Edit candidates', 'Candidates', 'Move stages, edit notes and contact details'),
  ('candidates.delete', 'Delete candidates', 'Candidates', 'Permanently remove an application'),
  ('candidates.view_scores', 'View scores', 'Candidates', 'See AI scores and assessment results'),
  ('scores.view_unmasked', 'View unmasked scores', 'Candidates', 'See scores normally masked for reviewers'),
  ('assessments.create', 'Create assessments', 'Assessments', 'Build and publish test suites'),
  ('assessments.grade', 'Grade assessments', 'Assessments', 'Review and award assessment scores'),
  ('assessments.assign', 'Assign assessments', 'Assessments', 'Send assessments to candidates'),
  ('jobs.manage', 'Manage jobs', 'Jobs', 'Create, publish and close job openings'),
  ('interviews.schedule', 'Schedule interviews', 'Interviews', 'Book interview slots and send invites'),
  ('messages.send', 'Send messages', 'Communications', 'Send WhatsApp and email to candidates'),
  ('analytics.view', 'View analytics', 'Analytics', 'Access dashboards and reports'),
  ('analytics.export', 'Export analytics', 'Analytics', 'Download data as CSV or PDF'),
  ('settings.manage_users', 'Manage users', 'Administration', 'Invite, edit and disable staff accounts'),
  ('settings.manage_roles', 'Manage roles', 'Administration', 'Change role permission grants'),
  ('settings.manage_platform', 'Manage platform settings', 'Administration', 'Edit AI, integration and security settings'),
  ('companies.manage', 'Manage companies', 'Administration', 'Add and configure subsidiary companies')
on conflict (key) do update
  set label = excluded.label,
      group_name = excluded.group_name,
      description = excluded.description;

-- Default grants (SUPER_ADMIN implicitly holds everything)
insert into role_permissions (role_key, permission_key, granted)
select r.key, p.key, true
from roles r cross join permissions p
where r.key = 'SUPER_ADMIN'
on conflict do nothing;

insert into role_permissions (role_key, permission_key, granted) values
  -- Subsidiary HR manager: everything inside one company, no platform settings
  ('SUBSIDIARY_HR_MANAGER','candidates.read',true),
  ('SUBSIDIARY_HR_MANAGER','candidates.write',true),
  ('SUBSIDIARY_HR_MANAGER','candidates.delete',true),
  ('SUBSIDIARY_HR_MANAGER','candidates.view_scores',true),
  ('SUBSIDIARY_HR_MANAGER','assessments.create',true),
  ('SUBSIDIARY_HR_MANAGER','assessments.grade',true),
  ('SUBSIDIARY_HR_MANAGER','assessments.assign',true),
  ('SUBSIDIARY_HR_MANAGER','jobs.manage',true),
  ('SUBSIDIARY_HR_MANAGER','interviews.schedule',true),
  ('SUBSIDIARY_HR_MANAGER','messages.send',true),
  ('SUBSIDIARY_HR_MANAGER','analytics.view',true),
  ('SUBSIDIARY_HR_MANAGER','analytics.export',true),
  ('SUBSIDIARY_HR_MANAGER','settings.manage_users',true),

  -- Recruiter: day-to-day pipeline work
  ('RECRUITER','candidates.read',true),
  ('RECRUITER','candidates.write',true),
  ('RECRUITER','candidates.view_scores',true),
  ('RECRUITER','assessments.create',true),
  ('RECRUITER','assessments.assign',true),
  ('RECRUITER','jobs.manage',true),
  ('RECRUITER','interviews.schedule',true),
  ('RECRUITER','messages.send',true),
  ('RECRUITER','analytics.view',true),

  -- Hiring manager: review and interview only
  ('HIRING_MANAGER','candidates.read',true),
  ('HIRING_MANAGER','candidates.view_scores',true),
  ('HIRING_MANAGER','interviews.schedule',true),
  ('HIRING_MANAGER','analytics.view',true),

  -- Interviewer: narrow read access
  ('INTERVIEWER','candidates.read',true),
  ('INTERVIEWER','interviews.schedule',true)
on conflict (role_key, permission_key) do update set granted = excluded.granted;

-- ---------------------------------------------------------------------------
-- has_permission() — consumed by RLS policies and server actions
-- ---------------------------------------------------------------------------
create or replace function has_permission(permission_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from user_profiles up
    join role_permissions rp on rp.role_key::text = up.role::text
    where up.auth_user_id = auth.uid()
      and rp.permission_key = permission_name
      and rp.granted
  );
$$;

create or replace function has_role(role_names text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from user_profiles
    where auth_user_id = auth.uid()
      and role::text = any (role_names)
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table app_settings enable row level security;
alter table settings_audit_log enable row level security;
alter table user_invites enable row level security;
alter table notification_templates enable row level security;
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;

-- Roles/permissions are readable by any signed-in staff member.
drop policy if exists roles_read on roles;
create policy roles_read on roles for select using (is_staff());

drop policy if exists permissions_read on permissions;
create policy permissions_read on permissions for select using (is_staff());

drop policy if exists role_permissions_read on role_permissions;
create policy role_permissions_read on role_permissions for select using (is_staff());

drop policy if exists role_permissions_write on role_permissions;
create policy role_permissions_write on role_permissions
  for all using (has_permission('settings.manage_roles')) with check (has_permission('settings.manage_roles'));

-- Settings: read for staff, write requires platform-settings permission.
drop policy if exists app_settings_read on app_settings;
create policy app_settings_read on app_settings
  for select using (is_staff());

drop policy if exists app_settings_write on app_settings;
create policy app_settings_write on app_settings
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));

drop policy if exists settings_audit_read on settings_audit_log;
create policy settings_audit_read on settings_audit_log
  for select using (has_permission('settings.manage_platform'));

drop policy if exists settings_audit_write on settings_audit_log;
create policy settings_audit_write on settings_audit_log
  for insert with check (has_permission('settings.manage_platform'));

drop policy if exists user_invites_read on user_invites;
create policy user_invites_read on user_invites
  for select using (has_permission('settings.manage_users'));

drop policy if exists user_invites_write on user_invites;
create policy user_invites_write on user_invites
  for all using (has_permission('settings.manage_users'))
  with check (has_permission('settings.manage_users'));

-- Notification templates readable by staff (needed to preview copies).
drop policy if exists notification_templates_read on notification_templates;
create policy notification_templates_read on notification_templates
  for select using (is_staff());

drop policy if exists notification_templates_write on notification_templates;
create policy notification_templates_write on notification_templates
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));

-- ---------------------------------------------------------------------------
-- Seed notification templates
-- ---------------------------------------------------------------------------
insert into notification_templates (key, channel, subject, body) values
  ('application_received', 'EMAIL', 'We received your application — {{job_title}}',
   'Dear {{candidate_name}},

Thank you for applying to {{job_title}} at Sharm Dreams Group. Our team is reviewing your application and you will hear from us shortly.

Best regards,
{{company_name}} Talent Team'),

  ('assessment_invite', 'WHATSAPP', null,
   'Hi {{candidate_name}}, you have been invited to complete an assessment for {{job_title}}. Please open your secure link within 48 hours: {{assessment_link}}'),

  ('interview_scheduled', 'EMAIL', 'Interview confirmed — {{job_title}}',
   'Dear {{candidate_name}},

Your interview for {{job_title}} is confirmed for {{scheduled_at}}. Joining details: {{meeting_link}}

Kind regards,
{{company_name}} Talent Team'),

  ('status_update', 'WHATSAPP', null,
   'Hi {{candidate_name}}, an update on your application for {{job_title}}: your status is now {{stage}}. — {{company_name}}'),

  ('offer_letter', 'EMAIL', 'Offer from Sharm Dreams Group',
   'Dear {{candidate_name}},

Congratulations! We are pleased to offer you the position of {{job_title}}. The formal documents are attached.

Warm regards,
{{company_name}} Talent Team')
on conflict (key) do update
  set subject = excluded.subject,
      body = excluded.body,
      channel = excluded.channel;

-- ---------------------------------------------------------------------------
-- Seed default platform settings
-- ---------------------------------------------------------------------------
insert into app_settings (scope, company_id, key, value, description) values
  ('GLOBAL', null, 'organisation.name', '"Sharm Dreams Group"', 'Displayed across portals and email templates'),
  ('GLOBAL', null, 'organisation.support_email', '"careers@sharmdreamsgroup.com"', 'Reply-to address for candidate communications'),
  ('GLOBAL', null, 'organisation.locale', '"en"', 'Default interface language'),
  ('GLOBAL', null, 'organisation.enabled_locales', '["en","ar","ru","de"]', 'Languages offered to candidates'),
  ('GLOBAL', null, 'organisation.timezone', '"Africa/Cairo"', 'Used for interview scheduling and reports'),
  ('GLOBAL', null, 'branding.logo_url', '"/sdg-icon.png"', 'Wordmark shown on portals and assessments'),

  ('GLOBAL', null, 'ai.enabled', 'true', 'Master switch for all AI features'),
  ('GLOBAL', null, 'ai.auto_screen_applications', 'true', 'Run CV screening automatically on new applications'),
  ('GLOBAL', null, 'ai.bias_reduction', 'true', 'Strip demographic markers before sending CVs to models'),
  ('GLOBAL', null, 'ai.match_threshold_advance', '75', 'Minimum match score to auto-advance a candidate'),
  ('GLOBAL', null, 'ai.match_threshold_reject', '40', 'Match score below which a candidate is auto-rejected'),
  ('GLOBAL', null, 'ai.generate_feedback', 'true', 'Send personalised feedback after each decision'),
  ('GLOBAL', null, 'ai.interview_questions', 'true', 'Generate targeted interview questions from resume gaps'),

  ('GLOBAL', null, 'assessment.default_duration_minutes', '60', 'Default test time limit'),
  ('GLOBAL', null, 'assessment.link_validity_hours', '48', 'How long an invitation link stays usable'),
  ('GLOBAL', null, 'assessment.autosave_interval_seconds', '20', 'Draft save frequency during a test'),
  ('GLOBAL', null, 'assessment.lock_on_expiry', 'true', 'Auto-submit when the countdown reaches zero'),
  ('GLOBAL', null, 'assessment.track_focus_changes', 'true', 'Record focus changes for integrity review'),

  ('GLOBAL', null, 'notifications.email_enabled', 'true', 'Send candidate email updates'),
  ('GLOBAL', null, 'notifications.whatsapp_enabled', 'false', 'Send candidate WhatsApp updates'),
  ('GLOBAL', null, 'notifications.notify_on_stage_change', 'true', 'Alert candidates when their stage changes'),

  ('GLOBAL', null, 'integrations.greenhouse.enabled', 'false', 'Push candidates to Greenhouse'),
  ('GLOBAL', null, 'integrations.lever.enabled', 'false', 'Push candidates to Lever'),
  ('GLOBAL', null, 'integrations.frappe_hr.enabled', 'false', 'Push candidates to Frappe HR'),
  ('GLOBAL', null, 'integrations.google_calendar.enabled', 'false', 'Sync interview slots with Google Calendar'),
  ('GLOBAL', null, 'integrations.microsoft_calendar.enabled', 'false', 'Sync interview slots with Microsoft 365'),

  ('GLOBAL', null, 'security.session_timeout_minutes', '480', 'Idle timeout for staff sessions'),
  ('GLOBAL', null, 'security.password_min_length', '12', 'Minimum password length for staff accounts'),
  ('GLOBAL', null, 'security.require_oauth', 'false', 'Force single sign-on for all staff'),
  ('GLOBAL', null, 'security.mask_scores_for_reviewers', 'true', 'Hide AI scores from interviewers')
on conflict do nothing;