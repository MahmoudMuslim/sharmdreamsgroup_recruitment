# Database

The whole application runs on **PostgreSQL 18.6 plus PostgREST 16.5, both containers this repo configures** (`docker/docker-compose.yml`), with the schema created idempotently in [`db/schema.sql`](../db/schema.sql). Every table lives in the `public` schema and is protected by **Row Level Security**. The authoritative definition is that file — this document is a map of it.

Counts below are measured from that file, not from a snapshot:

- **42 tables** (`grep -c '^create table if not exists public\.'`)
- **RLS enabled** on application tables — **88 policies** across them (`grep -c '^create policy'`)
- **15 functions** and **15 triggers** (`set_updated_at`, `assign_tracking_code`, and the RLS helpers `is_staff()` / `has_permission()` / `auth.uid()` …)
- **55 indexes**, **18 Postgres enums** for closed value sets
- **No storage buckets.** Files are rows in `public.files` plus bytes on a mounted volume — see [Files](#files-formerly-storage).

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
| `user_profiles` | `id uuid`, `auth_user_id` | Maps a row of our own `auth.users` directory to `role user_role`, `tenant_id`, `full_name`, `locale`. `auth_user_id` is the bearer's `sub`. |
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

## Files (formerly storage)

There are no buckets and no object store. A file is **a row in `public.files`** (`bucket`, `path`, `mime`, `bytes`, `unique (bucket, path)`) plus **bytes under `$UPLOADS_ROOT/<bucket>/<path>`** on the `uploads` volume. `bucket` is one of four directory names (`src/lib/config.ts` → `storageConfig.buckets`); the `/files` console lists rows and walks prefixes, and `files_bucket_path_prefix_idx` (`bucket, path text_pattern_ops`) makes that prefix walk an index scan rather than a sequential one.

| Bucket | Holds |
|--------|-------|
| `resumes` | Candidate CVs (public upload) + recruiter-attached documents. |
| `candidate-audio` | Voice notes attached to a candidate record. |
| `candidate-videos` | Video-response takes from the assessment runner. |
| `candidate-cvs` | The CV uploaded on the public apply form (`applications/<jobId>/<uuid>-<name>`), which the submit action then downloads, extracts text from, and hands to AI screening. |

Everything a byte passes through is our own code: `src/lib/files/paths.ts` resolves a `(bucket, path)` pair inside its bucket and refuses anything that escapes it, `src/app/api/files/upload/route.ts` and the careers/attempt routes validate size and MIME against the module rules **before** writing, `src/lib/files/signed-link.ts` mints an HMAC link (`/api/files/link`, staff + `candidates.read`), and `/api/files/f/[token]` streams it with range support. `public.files` carries 8 RLS policies; the vendor's `storage` schema is gone from the create path, and a local apply drops it if a re-dump ever restores it.

---

## Row Level Security

RLS is the enforcement layer for every read/write. Notable postures:

- **`provider_credentials`** — enabled, **no policies**: only the service-role client can read it. Secrets never reach a browser.
- **`assistant_sessions` / `assistant_messages`** — owner-only.
- **`currencies`** — explicit read/admin-write policies (the auto-enable helper only turns RLS on, it does not grant access).
- **Candidate attempts** — five policies key on `request.jwt.claims ->> 'attempt_token'` matching `candidate_attempts.access_token` (one of them the `files` upload rule that a path may only start with the token it was issued for). They are a **backstop, not the live path**: every `/api/attempt/[token]/*` route validates the unguessable token in code and then writes through the service client, so no HTTP caller in production presents an `attempt_token` bearer. `scripts/prove-files-rls.mjs` mints one anyway to prove the policies really fire.
- **Staff queries** run on the caller's bearer, so a Hiring Manager's live fingerprint and reports cover only the rows their role + tenant may see.

> Prefer the **request client** (`src/lib/data-api/server.ts`) so RLS applies. The **service-role** client (`src/lib/data-api/service.ts`) bypasses RLS via the `bypassrls` DB role and is used only for privileged server operations after a permission is re-checked in code.

---

## Migrations & seeding

- `db/schema.sql` — the consolidated, idempotent schema **and** the console's reference data: every table, policy, function, trigger, index, plus 235 `insert … on conflict (id) do nothing` rows: 9 company rows in a `SEED DATA` section, then the 226 rows the `REFERENCE ROWS` section header introduces (roles, permissions, model config, `app_settings`, master data). The in-file comment at the end of that section says "226 reference rows above" and means the section, not the file — companies come first because parents precede children. This is the file the running stack is built from.
- `npm run db:apply-local` → `scripts/apply-local-schema.mjs` — applies it to the local `db` container as one atomic script. It pre-flights the `supabase_vault` create (a vanilla image cannot provide it, so it exits 1 with the file and remedy named), then drops a restored `storage` schema before the SQL runs — so a re-dump that silently resurrected a vendor policy fails loudly on a missing relation instead of quietly keeping a dead shim alive. Then `npm run db:seed-local` (staff logins) and `npm run stack:prove` (the parity gate).
- `db/migrations/0xx_*.sql` — the 30 authored, ordered changes that grew the schema (RBAC, provider credentials, WhatsApp jobs, sourcing, activity log, time entries, company profiles, …; 026 was never written). They are history, not the apply path: the local stack runs `schema.sql` alone, which already contains their effect.
- `db/seed.sql` — demo data (fake applications and candidates). **Not applied automatically by anything**; apply by hand when you want a populated-looking board.
- **There is no hosted door left.** The five scripts that read the vendor project — `apply-schema.mjs`, `apply-migration.mjs`, `dump-schema.mjs`, `verify-schema.mjs`, `extract-vendor-files.mjs` — are deleted, and the credentials they read are gone from `.env.local`. `db/schema.sql` is therefore the source of record rather than a capture of a database someone else runs: it is edited by hand, applied by `apply-local-schema.mjs`, and the parity it must reach is proven by `stack:prove`, which checks behaviour instead of comparing a catalog.
