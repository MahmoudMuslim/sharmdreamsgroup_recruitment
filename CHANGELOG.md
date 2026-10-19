# Changelog

All notable changes to **Sharm Dreams Talent Cloud** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> This history is **reconstructed from the Supabase migration sequence** (`supabase/migrations/`) and the current `package.json` version (`0.1.0`). The project has not yet published tagged releases, so everything below is grouped under the initial `0.1.0` milestone. Future entries should be added per release.

---

## [0.1.0] — Initial platform

The first complete build of the AI-driven HRMS / ATS / skill-assessment platform for Sharm Dreams Group: Next.js 16 (App Router, Turbopack) + React 19 on Supabase (PostgreSQL 17, Auth, Storage, RLS).

### Added — Platform & shell
- Multi-tenant company/group model (`tenants_and_companies`) with a public careers profile per company.
- Admin portal with **16 routed pages** (dashboard, analytics, reports, time, activity, candidates, sourcing, jobs, questions, assessments, interviews, onboarding, files, whatsapp, assistant, settings).
- CSS-token theming: **Base** and **Liquid-glass** parents × **Light**/**Dark** tones, applied pre-paint and persisted to `localStorage`; build guard `check-themes.mjs`.
- Build guard `check-staff-routes.mjs` keeping route dirs, `STAFF_ROUTES`, and the rail `NAV` in sync.
- i18n for candidate-facing surfaces (`en`, `ar`, `ru`, `de`), RTL-aware.

### Added — Auth & RBAC
- Supabase Auth sessions with a per-request cached `getSessionUser()` and the `requireStaff()` page guard.
- Role-based access control: `roles`, `permissions`, `role_permissions` with **20 permission keys** and seeded grants for `SUPER_ADMIN`, `SUBSIDIARY_HR_MANAGER`, `RECRUITER`, `HIRING_MANAGER`, `INTERVIEWER`, `CANDIDATE` (`001_settings_rbac`).
- Staff invite / re-invite flow with expiring invites (`005_invite_reinvite`).
- Settings stored per scope with nulls-not-distinct uniqueness (`002_settings_nulls_not_distinct`).

### Added — Secrets & provider credentials
- AES-256-GCM envelope encryption for provider credentials, `server-only` (`006_provider_credentials`, `008_extra_secrets`).
- Multi-key, priority-based credential store with verification status (`012_provider_keys_and_models`).
- Credential audit trail (`credential_audit_log`).

### Added — AI gateway & routing
- Multi-provider gateway with **model + credential failover** across OpenRouter, Google AI Studio, OpenCode, Qoder, Cloudflare Workers AI, NVIDIA NIM.
- Per-capability model routing stored in `ai_model_config`, writable from Settings (`007_ai_model_config_write`).
- Eight capabilities: resume screening, soft skills, case reasoning, feedback, interview questions, transcription, admin assistant, careers chatbot.
- Case-reasoning routing profile (`014_case_reasoning_routing`).
- Model catalogues with cost-tier classification.

### Added — Assessments & integrity
- Assessment authoring: templates + typed questions (choice / written / spreadsheet / video), randomization, per-question timing.
- Tokenized candidate attempt runner with autosave, submit, and gated AI grading.
- Integrity/anti-cheat events: tab-switch, copy, device/session fingerprinting (`003_assessment_integrity`, `integrity_events`).
- Spreadsheet questions via Handsontable + HyperFormula; video responses with inline transcription.

### Added — Careers (public)
- Public job board, single-role page, and apply form (`010_public_careers`).
- CV upload + parse-to-prefill; content/size validation before storage.
- Application gate questions with pass/fail rejection at submit (`009_currencies_and_questions`, `018_application_gate_questions`).
- Currencies for salary denomination (`009`, `011_currencies_rls`).
- Grounded careers assistant (stateless Q&A from what the page publishes) + lead capture.
- Company careers profiles sourced from the group site (`027_company_careers_profile`, `028_company_profiles_from_site`).

### Added — Omnichannel
- WhatsApp Business Cloud connector with a scheduled outbox drained by a secret-guarded cron (`013_scheduled_whatsapp_jobs`).
- WhatsApp + email notification templates (`015_whatsapp_notification_templates`).
- Email (SMTP) and in-app messaging channels (`016_email_and_in_app_messaging`).

### Added — Sourcing
- LinkedIn prospect sourcing and import (`017_linkedin_sourcing`).
- Prospect profile capture/reader (`019_prospect_profiles`).

### Added — Assistant
- In-app agentic assistant with tool calls, approvals, sessions and transcripts (`020_assistant_sessions`), backed by the Qoder agent runtime.

### Added — Operations
- Master data: departments, locations, skills, role families (`004_master_data`).
- Activity/audit log (`024_activity_log`) and CSV/Excel/PDF exports for reports, time, and the trail.
- Time tracking ledger with a running timer (`025_time_entries`).
- Candidate archive (`021_candidate_archive`) and staff media delete/writer controls (`022`, `023`).

### Tooling
- `scripts/` for schema apply/verify/dump, staff creation, encryption-key generation, and secret auditing.
- Documentation set under `docs/` (architecture, API, database, authentication, AI integration, deployment, testing) plus `README.md`, `CONTRIBUTING.md`, and this changelog.

---

## [Unreleased]

- **Question Bank** shipped as the routed `/questions` console (`src/modules/questions/bank.ts`, `src/app/(admin)/questions/`): one CRUD surface over both real question stores — `application_gate_questions` and `assessment_questions` — with store tabs, search, live/kind/effect rails, place grouping, and a Kanban board beside the list. It owns no table; a form question is edited and moved here, a test question opens the suite's own editor, and a board drop moves a form question but only *copies* a test question, because an issued paper is answered against the suite it was sat in.
- **Removed `/apply-questions`.** Its search, rails, effect filter and groupings were ported into the Question Bank rather than dropped, and every registration that named it (`STAFF_ROUTES`, `NAV`, quick keys, page guide, live watch, activity trail, assistant links and tools) now points at `/questions?store=gate`.

---

## Known documentation-vs-code notes

These are called out in the docs and left as-is so the documentation matches the running code:

- `STAFF_ROLES` gates the admin portal to `SUPER_ADMIN`, `RECRUITER`, `HIRING_MANAGER`; `SUBSIDIARY_HR_MANAGER` and `INTERVIEWER` have DB grants but cannot currently pass the page guard (see [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)).
- `.env.example` has drifted from what the code reads (`WHATSAPP_CLOUD_API_TOKEN` vs `WHATSAPP_TOKEN`, a non-existent `/api/webhooks/whatsapp`, unused `ENABLE_*` flags, and a missing `CRON_SECRET`) — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
