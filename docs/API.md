# API

Two server-side surfaces exist in this app:

1. **Route handlers** under `src/app/api/**/route.ts` — HTTP endpoints for things a Server Action cannot do (multipart uploads, streaming, `GET` downloads, cron callbacks, the live SSE channel).
2. **Server Actions** — `"use server"` functions exported from `*/actions.ts` files, invoked directly from client components. These carry the bulk of the read/write traffic.

There is no separately deployed REST API *for the app*: both run inside the Next.js runtime and talk to **our own PostgREST** (`rest` in `docker/docker-compose.yml`) through `src/lib/data-api/*`, which is a thin seam over `src/lib/rest/*`. PostgREST is the database's HTTP face, not a second application tier — it exposes the `public` schema and applies RLS as the caller's role. The app also has two doors that bypass HTTP entirely: the `pg` pool (`src/lib/auth/db.ts`, for the `auth` schema and pgcrypto) and the disk (`UPLOADS_ROOT`, for file bytes).

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [AUTHENTICATION.md](AUTHENTICATION.md) · [DATABASE.md](DATABASE.md)

---

## Authentication model (applies to everything below)

| Caller | How they authenticate | Enforcement |
|--------|----------------------|-------------|
| **Staff** | Our own HS256 bearer in the httpOnly `sdg_session` cookie → `guardRequest` in `src/proxy.ts`, then `requireStaff(route)` / `getSessionUser()` + `isStaff(role)` | Role gate + per-permission `hasPermissionForUser(key)`; RLS on every query |
| **Candidate (test taker)** | Unguessable per-attempt `access_token` in the URL path | Token validated **in the route**, which then writes through the service client. The `attempt_token` RLS policies exist as a backstop but no production caller presents that bearer. |
| **Public (careers)** | None — the anon client (`token: null`, so Postgres runs it as the `anon` role) | Public RLS (insert applications/attachments/leads, read published jobs) |
| **Cron / scheduler** | `x-cron-secret` header matching `CRON_SECRET` | Fails **closed** (503) when the secret is unset |

---

## Route handlers

### Public — careers

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| `POST` | `/api/careers/chat` | public | Grounded Q&A for the careers assistant. Stateless: the widget owns the transcript and replays it each turn. Answers are built from the same cached reads the page rendered, so the assistant can only repeat what the page publishes (or say a fact is unstated). |
| `POST` | `/api/careers/lead` | public | Saves a name + contact + the conversation as a lead (`sourced_prospects`, origin `CHATBOT`). |
| `POST` | `/api/careers/upload` | public | CV upload as multipart. Validated against `modules/careers/cv-rules` (size/type) before it reaches storage. Two-step flow: upload, then submit via the apply action. |
| `POST` | `/api/careers/prefill` | public | Parses an uploaded CV to prefill the apply form; same content/size guards as upload. |
| `GET` | `/api/careers/questions` | public | Returns a role's gate questions for the apply form (`application_gate_questions`). 404 if the role is not accepting applications. |
| `POST` | `/api/careers/about-me` | public | Drafts the apply form's "About me" box from a LinkedIn profile link or the applicant's own CV. Reads only — no row is written and no file is stored, because the upload route owns storage. A LinkedIn link that returns the login wall, and a CV with no readable text, are each reported as themselves and pointed at the doors this form has; only `linkedin.com` / `linkedin.cn` hosts are fetched, and the model's prose is clamped to the field's own limits. |

### Staff — files, branding, live

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| `GET` | `/api/branding/logo` | public | Resolves the configured company logo and `302`-redirects to it. |
| `GET` | `/api/files/link` | staff + `candidates.read` | Mints a short-lived signed URL for a stored candidate file. 403 without the permission; 404 for unknown files. |
| `POST` | `/api/files/upload` | staff | Stores a file a recruiter attaches to a candidate record (multipart; bucket rules checked first). |
| `GET` `HEAD` | `/api/files/f/[token]` | the signed link itself — **no session check** | The byte door that replaced `storage.createSignedUrl` and the vendor's CDN: one HMAC-signed, expiring URL opens exactly one file, exactly one way. The token carries its own expiry and its own content type (taken from the `files` row at mint time, because a directory entry has none), and `resolveObjectPath` refuses a key that resolves outside its bucket — so a token minted by an older build cannot read a path this build would not sign. `206` + `Content-Range` and the `HEAD` probe are load-bearing, not niceties: without them a pitch recording cannot seek, and Safari shows it unplayable. Everything is `no-store`; the links it honours are minted by the guarded doors above. |
| `GET` | `/api/live` | staff session | The portal's live channel. Fingerprints the watched hiring tables on the caller's own session client and names which areas moved; the browser re-reads affected data through its own RLS-scoped queries. No row content crosses this channel. |

### Staff — exports (the "one door" pattern)

Every download re-reads from the database and re-checks its permission server-side, so a hidden button never becomes a decorative grant.

| Method | Route | Permission | Purpose |
|--------|-------|-----------|---------|
| `GET` | `/api/reports/export` | `analytics.export` | Hiring/assessment reports as CSV / Excel / PDF. |
| `GET` | `/api/time/export` | `time.track` | A person's time ledger as a file (own hours, RLS-scoped). |
| `GET` | `/api/activity/export` | `settings.manage_platform` | The audit trail as a file. |

### Cron — scheduled sweeps

Both accept `GET` **and** `POST` and require the `x-cron-secret` header. The scheduler is the `cron` container in this repo — a supervised busybox loop (PID 1, not crond) that polls `$APP_URL` every `WHATSAPP_EVERY` (default 60 s) and hits grading every `GRADING_EVERY` (default 300 s). Nothing uses `pg_cron` (the vanilla image has no extension to schedule with) and nothing external is required.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` `POST` | `/api/cron/whatsapp` | Drains the scheduled WhatsApp outbox (`processDueWhatsAppJobs`); batch size `WHATSAPP_CRON_BATCH_SIZE` (default 50). |
| `GET` `POST` | `/api/cron/grading` | Re-grades submitted attempts whose AI grading failed during a provider outage; batch size `GRADING_CRON_BATCH_SIZE` (default 10). |

### Candidate — attempt runner (`/api/attempt/[token]/…`)

All gated by the unguessable `access_token`; the candidate never sees staff data and RLS restricts them to their own attempt.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/attempt/[token]` | Load the built paper + attempt state. |
| `POST` | `/api/attempt/[token]/start` | Start the timed session (locks the paper, stamps start time). |
| `PUT` | `/api/attempt/[token]/draft` | Persist in-progress answers (autosave). |
| `POST` | `/api/attempt/[token]/integrity` | Record an integrity event (tab switch, copy, etc.) to `integrity_events`. |
| `POST` | `/api/attempt/[token]/video` | Upload a video-response take. |
| `POST` | `/api/attempt/[token]/submit` | Final submit → triggers gated AI grading. |

---

## Server Actions

Server Actions are plain `export async function`s in a `"use server"` module, called from client components like RPCs. They always re-check the session and, where relevant, a permission before writing, and record side effects to the audit logs.

### Per-page actions under `src/app/(admin)/*`

| Area | Action files |
|------|-------------|
| `dashboard` | `actions.ts` |
| `analytics` | `actions.ts` |
| `reports` | `actions.ts` |
| `activity` | `actions.ts` |
| `time` | `actions.ts` |
| `candidates` | `actions.ts`, `candidate-actions.ts`, `assessment-actions.ts`, `attempt-actions.ts`, `attachment-actions.ts`, `cv-actions.ts`, `dossier-actions.ts`, `integrity-actions.ts`, `interview-actions.ts` |
| `sourcing` | `actions.ts`, `profile-actions.ts` |
| `jobs` | `job-actions.ts`, `applicant-actions.ts` |
| `questions` | `actions.ts` |
| `assessments` | `actions.ts`, `assessment-actions.ts`, `question-actions.ts`, `suite-authoring-actions.ts` |
| `interviews` | `actions.ts` |
| `onboarding` | `actions.ts`, `onboarding-actions.ts`, `task-actions.ts` |
| `files` | `actions.ts` |
| `whatsapp` | `actions.ts` |
| `assistant` | `actions.ts` |
| `settings` | `actions.ts` |

### Shared module actions (`src/modules/*`)

| File | Responsibility |
|------|---------------|
| `settings/application/settings-actions` (`(admin)/settings/actions.ts`) | Load/save settings, role↔permission grants, notification templates. |
| `settings/application/user-actions.ts` | Staff user management (invite, role assignment). |
| `settings/application/credential-actions.ts` · `credential-actions-ai.ts` | Write encrypted provider credentials + AI model routing. |
| `settings/application/master-data-actions.ts` | Departments, locations, skills, currencies, role families. |
| `settings/application/settings-trail-actions.ts` | Read the settings/credential audit trails. |
| `shell/application/shell-actions.ts` | Admin shell chrome (theme/preference persistence, quick keys). |
| `assessment/application/buildPaper.ts` | Deterministically assemble a candidate's paper from a suite. |
| `i18n/application/translationWrites.ts` | The Languages console's two writes — store a screen of reviewed wording as one JSONB map per locale under `i18n.<locale>`, and ask the model for a draft (which only fills the fields; nothing reaches the DB until a person saves). Both gated on `settings.manage_platform`, because RLS silently refuses an `app_settings` UPDATE without it. |

### Public + candidate actions

| File | Auth | Responsibility |
|------|------|---------------|
| `src/app/login/actions.ts` | public (pre-session) | Staff sign-in / sign-out — `signInAction` verifies the bcrypt password, mints the `sdg_session` bearer + cookie, and holds an in-process brute-force floor (the vendor's rate limiter is gone); `signOutAction` tears the session down. |
| `src/app/careers/actions.ts` | public | Published job/company reads, apply submission. |
| `src/app/(candidate)/portal/actions.ts` | candidate token/email | Application tracking lookups. |

> **The Question Bank** (`src/app/(admin)/questions/`) owns no table of its own: it reads `application_gate_questions` and `assessment_questions` and writes whichever one a control touches. Form questions go through its own `actions.ts`; a test question is opened in the suite editor, which writes through `(admin)/assessments/question-actions.ts`. The pure half — the projection, rails, search, groups, place lookups and copy targets — is in `src/modules/questions/bank.ts`. It replaced the `/apply-questions` console.

---

## Conventions

- **Validate at the boundary** with Zod before touching the database.
- **Prefer the request client** (`src/lib/data-api/server.ts`) so RLS is the enforcement layer; use the service-role client only for privileged writes after re-checking permissions in code.
- **Fail closed**: a missing secret or permission returns an error, never a permissive default.
- **Record side effects**: writes that matter emit to `activity_log` / `settings_audit_log` / `credential_audit_log`. No write notifies the portal — `/api/live` finds the change on its next fingerprint poll.
