# Changelog

All notable changes to **Sharm Dreams Talent Cloud** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> This history is **reconstructed from the Supabase migration sequence** (`supabase/migrations/`) and the current `package.json` version (`0.1.0`). The project has not yet published tagged releases, so everything below is grouped under the initial `0.1.0` milestone. Future entries should be added per release.
>
> Read `0.1.0` as the platform *as it was built*: on a hosted backend, with the vendor's auth, storage and REST. [`Unreleased`](#unreleased) carries the move off it — the app now runs on its own Docker Compose stack with its own token, transport and disk — so `0.1.0`'s vendor-era wording is history, not a description of what ships today.

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

Everything below this line has landed on `migrate/identity-spine` and has not been tagged. The
largest entry is the platform one: the app no longer runs on a hosted backend.

### Added — Platform: the stack is ours now

- **Docker Compose owns the data plane** (`docker/docker-compose.yml`): `db` (`postgres:18.6-alpine3.24`, published on loopback `54320` only), `rest` (`postgrest/postgrest:v16.5`), `gateway` (`caddy:2.11.7-alpine`, `127.0.0.1:54321` → `/rest/v1`), `cron`, `app` (`node:24.22.0-alpine3.24`) and `nginx` (`127.0.0.1:3000`), over named `db-data` and `uploads` volumes. `PG17+` is forced by the `maintain` privilege every grant in `supabase/schema.sql` uses. Driven by `npm run docker:up | docker:down | docker:logs | docker:psql | docker:wipe`.
- **The identity spine replaces the auth service**: an `auth.users` shim with pgcrypto bcrypt hashes, our own HS256 bearer minted per request (`src/lib/auth/token.ts`), sign-in through a server action behind an httpOnly cookie, the idle-session timeout enforced in `src/proxy.ts` without a network round trip, password verification over a direct `pg` pool (`src/lib/auth/db.ts`), and Team-console user management with no auth admin API.
- **One REST transport of our own** (`src/lib/rest/`) behind the three clients the portal already called (`src/lib/supabase/{anon,server,service}.ts` — the directory keeps its name so its call sites did not have to change). The service-role bearer is minted locally with a 60-second lifetime per call, so no bearer outlives its expiry.
- **Files are rows plus bytes on our own disk**: `public.files` and `$UPLOADS_ROOT/<bucket>/<path>` on the `uploads` volume, path containment in `src/lib/files/paths.ts`, HMAC-signed expiring links, and range reads. The storage shim and its policies are retired.
- **The vendor is out of the deploy surface**: `@supabase/supabase-js`, `@supabase/ssr` and `@vercel/speed-insights` are uninstalled and nothing in `src` or `scripts` imports them; the vendor credentials are dropped from config; `scripts/audit-secrets.mjs` now runs in `prebuild`, so a vendor credential re-entering the surface fails the build.
- **Reproducible proofs, not manual checks**: `npm run stack:prove` (identity + RLS parity through our own gateway), `files:prove` (the `public.files` policies over the HTTP door), `files:paths`, `files:links`, `files:serve`. Schema and staff fixtures come from `npm run db:apply-local` and `db:seed-local`.
- **The two cron routes finally have a scheduler**: a `cron` container calls the grading sweep and the WhatsApp outbox, with `CRON_SECRET` kept out of the command line and the heartbeat bounded.

### Added — Question bank

- **Question Bank** shipped as the routed `/questions` console (`src/modules/questions/bank.ts`, `src/app/(admin)/questions/`): one CRUD surface over both real question stores — `application_gate_questions` and `assessment_questions` — with store tabs, search, live/kind/effect rails, place grouping, and a Kanban board beside the list. It owns no table; a form question is edited and moved here, a test question opens the suite's own editor, and a board drop moves a form question but only *copies* a test question, because an issued paper is answered against the suite it was sat in.

### Added — Recruiting and grading

- **Blind marking** (`security.blind_marking`, `src/modules/assessment/domain/blindMarking.ts`): with the switch on, a paper whose marks can still change is read on the issued-links board and in its answers by its `SDG-…` tracking code rather than by its candidate, and the name returns when the last mark is saved. A closed link is exempt, the withheld state is printed on screen, and the answers themselves are never anonymised. Off by default and it applies to every staff reader — there is no role permission that overrides it.
- **Score benchmark** (#263): a graded paper is ranked against everyone who sat the same suite, in the grading report, the answers drawer, and the assistant's answer — with the population it was computed over named, and no percentile claimed the sample cannot support.
- **Hiring demand per opening** (#255): the grid card and `list_jobs` pair a `positions_needed` target with who is in pipeline and who is hired, so "4 hired" reads as a filled role or an open one. The target is a nullable column, so a demand line says "not recorded" rather than inventing a zero — and on the local stack's cluster it says that for every opening, because `031_job_headcount.sql` is applied to no database yet.
- **The offer email carries an offer letter**: a generated PDF attached at the OFFER stage and re-attached when a failed email is retried, with default copy shipped in code and the portal notice corrected so it no longer promises an attachment the notice never sends.
- **Settings → Languages** (`src/modules/i18n/`): one console over the locale reader that already existed, wired through the nav, the change trail, the page guide and the assistant.
- **The assistant reads files and writes one back**: Excel, CSV and PowerPoint attachments in a turn, and a generated document offered for download from either engine; a turn can also look up what is outside the portal, with the lookups recorded as chips; answers may carry a chart, not only a table.
- **The apply form asks one screen at a time**, with an About-you step that drafts itself from the applicant's own CV.
- **Interface wording is editable data**: the strings the root layout ships are held for the Languages console to change.

### Changed — Shape

- The 3,440-line assistant tool registry is now one file per section, and every screen action the registry calls routes through a single seam (#331) that broke its dependency on `@/app`.
- The oversized client files were split by responsibility (#332): the app bar into its five panels, the sourcing board into its five drawers and helpers, the chat into seven parts, the dashboard into tiles, rows and popups, the candidate profile drawer and the bulk composer, each apply step, and the routing console's helpers and tiles.
- Dead components and the five packages nothing imported are gone (#333).

### Removed

- **Removed `/apply-questions`.** Its search, rails, effect filter and groupings were ported into the Question Bank rather than dropped, and every registration that named it (`STAFF_ROUTES`, `NAV`, quick keys, page guide, live watch, activity trail, assistant links and tools) now points at `/questions?store=gate`.

### Performance

- The unbounded page reads are bounded and paged (#328): the openings grid, the activity trail, and the dashboard's attempts read now come back to the rows the board actually shows.
- The page guard's staff-role read is memoized per session (#327), so one request stops paying for the same lookup twice.

### Fixed

- A wrapped `select` that collapsed into a `PGRST100` broke `/assessments`; the projection now reaches the grammar.
- nginx had too small a response-header buffer for a signed-in page, and the app image could not build with no database and no secrets present.
- An anonymous oversized upload was accepted, then refused for the wrong reason.
- The cookie `Secure` flag is decided from the advertised origin, and the token `iss`/`aud` are derived from the environment rather than hardcoded.
- The role-permissions editor is gated on the same checks the key's RLS policy makes; `analytics.export` now says what it actually downloads.
- The local database, the app port and the gateway stay on loopback; `LOCAL_PGRST_PASSWORD` is authoritative without editing a literal in the compose file.
- Assessment links are sent on the host the app actually runs on, so a candidate can open the link they received.

---

## Known documentation-vs-code notes

These are called out in the docs and left as-is so the documentation matches the running code:

- `STAFF_ROLES` gates the admin portal to `SUPER_ADMIN`, `RECRUITER`, `HIRING_MANAGER`; `SUBSIDIARY_HR_MANAGER` and `INTERVIEWER` have DB grants but cannot currently pass the page guard (see [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)).
- **`supabase/schema.sql` is ahead of the cluster it describes.** It carries `job_openings.positions_needed` from `031_job_headcount.sql`, which has not been applied to any database — measured on the running local stack, `public.job_openings` has 17 columns and that is not one of them. The dump is the schema *of record*, so a re-applied cluster gains the column while the current one keeps showing "not recorded" for every demand target. Applying `031` is the owner's call, not a docs fix.
- The root `.env.example` (untracked, so a fresh clone has none — `docker/.env.example` is the tracked one) has drifted from what the code reads: `WHATSAPP_CLOUD_API_TOKEN` vs `WHATSAPP_TOKEN`, a non-existent `/api/webhooks/whatsapp`, unused `ENABLE_*` flags, and a missing `CRON_SECRET` — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **The tree still carries 53 tracked copies of a vendored `supabase-server` agent skill**, one per editor directory, each re-prescribing an SDK this app no longer depends on. `scripts/audit-secrets.mjs` counts them on every build and says where they are rather than claiming they are gone; they never enter the shipped artifact. Deleting them is the owner's call.
