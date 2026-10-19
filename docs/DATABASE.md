# Database

The whole application runs on **Supabase PostgreSQL 17**. Every table lives in the `public` schema, is created idempotently in [`supabase/schema.sql`](../supabase/schema.sql), and is protected by **Row Level Security**. The authoritative definition is that file — this document is a map of it.

- **41 tables**
- **RLS enabled** on application tables — **94 policies** across them
- **3 storage buckets**: `resumes`, `candidate-audio`, `candidate-videos`
- **18 Postgres enums** for closed value sets

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [AUTHENTICATION.md](AUTHENTICATION.md) · [API.md](API.md)

---

## How to read this

`schema.sql` carries **two parallel shapes** for the recruiting data:

- The **native** tables (`job_openings`, `applications`, `candidate_attempts`, …) use `uuid` primary keys and drive the live app (public careers board, assessment runner, pipeline).
- The **import** tables (`jobs`, `applicants`) use `text` primary keys and hold externally-sourced records (e.g. an ATS/LinkedIn import) with denormalised, JSONB-heavy columns. They are a separate surface — do not assume a `jobs.id` joins to `job_openings.id`.

Relationships below are described logically; the schema enforces most of them with `references` FKs and `check` constraints applied in guarded `do $$ … $$` blocks (idempotent, so re-running is safe).

---

## Tenant & master data

| Table | Key | Purpose |
|-------|-----|---------|
| `tenants_and_companies` | `id uuid` | The company/group. Doubles as the public careers profile: `logo_url`, `tagline`, `history`, `careers_pitch`, `milestones`/`benefits` (jsonb), `founded_year`, `is_group_profile`. Maps to the group's subsidiaries. |
| `departments` | `id uuid`, `tenant_id` | Grouping for jobs and role families; `head_profile_id`, `slug`. |
| `locations` | `id uuid`, `tenant_id` | Sites (Sharm El Sheikh, Cairo, …) with `timezone` (default `Africa/Cairo`). |
| `skills` | `id uuid` | Skill catalogue used by role families and candidate matches. |
| `role_families` | `id uuid`, `key` | Job families; optional `department_id`. |
| `role_family_skills` | `(role_family_id, skill_id)` | Which skills a family expects, with `required_level` and `weight`. |
| `currencies` | `id uuid`, `code` | ISO-4217 currencies salaries can be denominated in. **RLS with explicit policies** (readable, admin-writable). |

## Jobs & applications (native)

| Table | Key | Purpose |
|-------|-----|---------|
| `job_openings` | `id uuid`, `tenant_id` | A posted role. `sector business_sector`, `status job_status` (DRAFT…), `min/max_salary_usd`, `salary_currency`, `requirements jsonb`. |
| `application_gate_questions` | `id uuid`, `job_id` | No-points viability questions on the public apply form; a failing answer rejects the application at submit. |
| `applications` | `id uuid`, `job_id` | A candidate's submission. `tracking_code` (unique), `stage application_stage`, `source application_source`, `cv_file_path`, `cv_text`, AI columns (`ai_match_score`, `ai_screening_summary`, `ai_strengths`, `ai_gaps`, `ai_soft_skills`, `ai_feedback`), `gate_answers jsonb`, `archived_at`. |
| `application_attachments` | `id uuid`, `application_id` | Files a recruiter attaches after the application landed. `bucket` **constrained to `resumes` \| `candidate-audio`**; `storage_path` unique. |
| `candidate_skills` | `(application_id, skill_id)` | Matched skills with `proficiency` and `source` (default `AI_SCREENING`). |
| `interview_schedules` | `id uuid`, `application_id` | Panels: `scheduled_at`, `duration_minutes`, `calendar_provider calendar_provider` (default MANUAL), `meeting_link`, `status interview_status`. |
| `onboarding_plans` | `id uuid`, `application_id`, `tenant_id` | New-hire checklist (`jsonb`), `skill_gaps`, `retention_risk_score`, `generated_by_ai`. |

## Assessments (authoring → attempt → grading)

| Table | Key | Purpose |
|-------|-----|---------|
| `assessment_templates` | `id uuid`, `tenant_id` | A suite: `role_family`, `time_limit_minutes`, `randomize_questions/options`, `block_copy_paste`. |
| `assessment_questions` | `id uuid`, `template_id` | A question: `question_type question_type` (choice/written/spreadsheet/video), `config jsonb`, `points`, `time_limit_minutes`, `shuffle_options`. |
| `candidate_attempts` | `id uuid`, `application_id`, `template_id` | One timed run. `access_token` (unguessable, the candidate's only credential), `status attempt_status`, `expires_at`, `total_score/max_score`, `integrity_score/flags`, frozen `question_order uuid[]` + `option_order jsonb`. |
| `candidate_responses` | `id uuid`, `attempt_id`, `question_id` | The answer: `answer_text`, `spreadsheet_state jsonb`, `video_path` + `transcript`, `score`, `ai_evaluation jsonb`. |
| `integrity_events` | `id uuid`, `attempt_id` | Anti-cheat signals: `event_type integrity_event_type`, `severity integrity_severity`, `session_fingerprint`, `device_label`. |

## Sourcing & outreach

| Table | Key | Purpose |
|-------|-----|---------|
| `sourced_prospects` | `id uuid` | Off-pipeline people (LinkedIn, events, referrals) and **chatbot leads** (`origin`, default `LINKEDIN`; leads use `CHATBOT`). `stage`, `linkedin_url`, captured `profile jsonb`. *Not* applications — no tracking code / portal until converted. |
| `communication_logs` | `id uuid`, `application_id`/`prospect_id` | Sent/received messages: `channel message_channel`, `direction message_direction`, `delivered`, `read_at`, `subject`. |
| `scheduled_whatsapp_jobs` | `id uuid`, `application_id` | The outbox drained by `/api/cron/whatsapp`: `recipient_phone`, `scheduled_for`, `payload jsonb`, `status`, `attempts`, `error_log`. |
| `notification_templates` | `id uuid`, `key` | Reusable WhatsApp + email copy per `channel`; `subject`, `body`, `is_active`. |

## AI configuration

| Table | Key | Purpose |
|-------|-----|---------|
| `provider_credentials` | `id uuid`, `provider` | Multiple API keys per provider with `priority` failover. `secret_encrypted` + `extra_secrets_encrypted` (AES-256-GCM), `secret_hint`, verification status. **RLS enabled, zero policies → service-role only.** |
| `provider_models` | `id uuid`, `provider` | Per-provider model catalogue: pricing (`prompt/completion_price_per_million`), `context_length`, `is_free`, `capabilities text[]`. |
| `ai_model_config` | `capability` (PK) | The chosen `primary_model` / `fallback_model`, `temperature`, `max_tokens`, `is_enabled` for each AI capability. |

## Assistant

| Table | Key | Purpose |
|-------|-----|---------|
| `assistant_sessions` | `id uuid`, `owner_id` | One saved conversation per staff member. **RLS: owner only.** |
| `assistant_messages` | `id uuid`, `session_id`, `owner_id` | Turns with `role`, `content`, tool `steps jsonb`, `model`/`provider`, optional attachment. |

## Time & activity

| Table | Key | Purpose |
|-------|-----|---------|
| `time_entries` | `id uuid`, `staff_id` | Worked time, one row per span; `category`, `task`, optional `job_id`/`application_id`. **No `ended_at` = the running timer.** |
| `activity_log` | `id uuid` | The audit trail: `actor_kind` (`STAFF`/`AI`/`CANDIDATE`/`SYSTEM`), `via`, `area`, `action`, `entity`/`entity_id`, `summary`, `detail jsonb`. |

## RBAC (see [AUTHENTICATION.md](AUTHENTICATION.md))

| Table | Key | Purpose |
|-------|-----|---------|
| `roles` | `id uuid`, `key app_role` | SUPER_ADMIN, RECRUITER, HIRING_MANAGER (+ CANDIDATE as a `user_role`). `is_system`. |
| `permissions` | `key` (PK) | The catalogue of permission keys, grouped. |
| `role_permissions` | `(role_key app_role, permission_key)` | Which permissions each role holds (`granted`). |
| `user_profiles` | `id uuid`, `auth_user_id` | Maps a Supabase Auth user to `role user_role`, `tenant_id`, `full_name`, `locale`. |
| `user_invites` | `id uuid` | Pending staff invites: `email`, `role app_role`, `status invite_status`, `expires_at` (default +7 days). |

## Settings & audit

| Table | Key | Purpose |
|-------|-----|---------|
| `app_settings` | `id uuid`, unique `(scope, company_id, key)` | Key/value settings, `scope settings_scope` (GLOBAL/company), `value jsonb`, `is_secret`. |
| `settings_audit_log` | `id uuid` | Before/after of a settings change: `previous_value`/`next_value jsonb`, `changed_by`. |
| `credential_audit_log` | `id uuid` | Who touched a provider credential: `provider`, `action`, `actor_id`. |

## Import surface (external ATS)

| Table | Key | Purpose |
|-------|-----|---------|
| `jobs` | `id text` | Externally-imported openings (denormalised `company`, `business_sector`, skill arrays as jsonb, `applicants_count`). |
| `applicants` | `id text` | Externally-imported candidates: scores (`custom_ai_score`, `skill_match_score`, `cultural_fit_score`, `soft_skills_score`), `radar_scores`/`matched_skills`/`missing_skills` jsonb, `custom_raw_cv_text`, `custom_whatsapp_chat_id`. |
| `ats_integrations` | `id uuid`, `tenant_id` | Config rows for external ATS sync (`provider ats_provider`, `status integration_status`, `credentials jsonb`, `webhook_secret`). **Present but not wired to a live sync in the current build.** |

---

## Enums (closed value sets)

`settings_scope`, `application_stage`, `application_source`, `question_type`, `attempt_status`, `integrity_event_type`, `integrity_severity`, `message_channel`, `message_direction`, `calendar_provider`, `interview_status`, `job_status`, `business_sector`, `ats_provider`, `integration_status`, `app_role`, `user_role`, `invite_status`.

---

## Storage

Three buckets (names from `src/lib/config.ts`):

| Bucket | Holds |
|--------|-------|
| `resumes` | Candidate CVs (public upload) + recruiter-attached documents. |
| `candidate-audio` | Voice notes attached to a candidate record. |
| `candidate-videos` | Video-response takes from the assessment runner. |

Uploads go through route handlers (`/api/careers/upload`, `/api/files/upload`, `/api/attempt/[token]/video`) that validate size/type against the module rules **before** touching the bucket, and signed read URLs are minted by `/api/files/link` (staff + `candidates.read`).

---

## Row Level Security

RLS is the enforcement layer for every read/write. Notable postures:

- **`provider_credentials`** — enabled, **no policies**: only the service-role client can read it. Secrets never reach a browser.
- **`assistant_sessions` / `assistant_messages`** — owner-only.
- **`currencies`** — explicit read/admin-write policies (the auto-enable helper only turns RLS on, it does not grant access).
- **Candidate attempts** — a candidate's queries are scoped to their own attempt via the `access_token` claim.
- **Staff queries** run on the caller's JWT, so a Hiring Manager's live fingerprint and reports cover only the rows their role + tenant may see.

> Prefer the **session (JWT) client** so RLS applies. The **service-role** client (`src/lib/supabase/service.ts`) bypasses RLS and is used only for privileged server operations after a permission is re-checked in code.

---

## Migrations & seeding

- `supabase/schema.sql` — the consolidated, idempotent schema (applied via `scripts/apply-schema.mjs`).
- `supabase/migrations/0xx_*.sql` — incremental, ordered changes (RBAC, provider credentials, WhatsApp jobs, sourcing, activity log, time entries, company profiles, …).
- `supabase/seed.sql` — demo/first-run data (companies, roles, permissions, model config).
- `scripts/verify-schema.mjs` — checks the applied schema matches expectations.
