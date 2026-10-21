# Authentication & Authorization

Auth is layered. No single check is trusted alone — a request must pass through **the signed bearer → session resolution → the staff route gate → RBAC permissions → Row Level Security** before data moves.

There is no auth service in this stack. Identity is a bearer we mint and verify ourselves, over the `auth.users` table that lives in our own Postgres.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [DATABASE.md](DATABASE.md) · [API.md](API.md) · [AI_INTEGRATION.md](AI_INTEGRATION.md)

---

## The five layers

| Layer | Where | What it decides |
|-------|-------|-----------------|
| **1. Identity** | `src/lib/auth/token.ts` + `src/lib/auth/cookies.ts` | Is there a valid signed-in user? An HS256 bearer (`sub`, `role`, `exp`, `iss`, `aud`) minted from `AUTH_JWT_SECRET` and stored in the httpOnly `sdg_session` cookie. |
| **2. Session** | `src/lib/auth/session.ts` → `getSessionUser()` | Maps the bearer's `sub` to a `user_profiles` row (role, tenant, name) — read *through* that bearer, so RLS still decides. Cached per request. |
| **3. Route gate** | `requireStaff(route)` + `src/lib/auth/staffRoutes.ts` | May this role be in the admin portal at all? |
| **4. RBAC** | `src/modules/settings/infrastructure/permissions.ts` | Does this role hold the specific permission for this action? |
| **5. RLS** | `supabase/schema.sql` policies | Which *rows* may this user see, evaluated by Postgres on every query using `auth.uid()`? |

Layers 3–4 are application checks; **layer 5 (RLS) is the backstop** — even a bug that skips a code check still hits the database policy.

`auth.uid()` is our own function: `docker/db/initdb/02-auth-users.sql` stands in the `auth` schema and defines it to read the `request.jwt.claims` GUC, which PostgREST sets from the bearer on every request. That is the whole bridge between the cookie and the 88 policies on `public`.

---

## Session flow

```
/login form ──►  signInAction(formData)          src/app/login/actions.ts
                    │  bcrypt check against auth.users.password over the pg pool
                    │  (src/lib/auth/passwords.ts, pgcrypto extensions.crypt)
                    ▼
                startSession(userId)              src/lib/auth/cookies.ts
                    │  mints the bearer, sets the httpOnly sdg_session cookie
                    ▼
Next request ──►  src/proxy.ts → guardRequest()   bearer + idle window
                    │  getSessionUser(): verify locally, then read user_profiles through the bearer
                    ▼
                SessionUser { authUserId, profileId, email, fullName, role, tenantId }
                    │
                    ▼
                requireStaff(route)  ──►  page renders / action runs
```

- **Sign-in is a Server Action, not an HTTP auth endpoint.** By design this stack exposes no browser-reachable auth API: `auth` is deliberately kept out of `PGRST_DB_SCHEMAS`, so no REST route can reach `auth.users`, and the admin verbs (`src/lib/auth/admin-users.ts`) go over the `pg` pool instead.
- **`getSessionUser()`** is wrapped in React's `cache()`. Verifying the bearer is local now, but the `user_profiles` read below it is still a round trip, and one admin page asks half a dozen times.
- **`requireStaff(nextPath)`**:
  - no session → `redirect('/login' + returnPath)`
  - session but not a staff role → `redirect('/portal?denied=staff-only')`
  - otherwise returns the `SessionUser`.
- **`src/proxy.ts`** (Next.js 16's name for the former `middleware` file) delegates to `src/lib/auth/guard.ts`: it refuses a bearer whose verified role is not `authenticated`, refreshes `sdg_staff_last_active`, enforces the `security.session_timeout_minutes` window, and bounces a candidate hitting a staff path to their portal.

### What replaced the auth service's guarantees

| The vendor gave you | What the stack has now |
|---|---|
| Session refresh / rotation | Nothing to refresh: a session *is* a signed bearer with an `exp`, and `sdg_session`'s `max-age` is set equal to it (`src/lib/auth/cookies.ts`). |
| Server-side session record, revocable on sign-out | **No sessions table.** Sign-out clears the cookie (`endSession`), but a bearer already handed to a client stays valid until its `exp` (24 h). Revoking early is done by removing the `user_profiles` row: layer 2 re-reads it through the bearer on every request, so a deleted profile stops resolving immediately. |
| A rate limiter on the password endpoint | A per-process attempt map in `src/app/login/actions.ts` (charged *before* the bcrypt await, because 250 ms of bcrypt let a concurrent burst all read an under-limit count). It is per container, so it is a floor, not a wall. |
| Bearer validation by the managed data plane | `PGRST_JWT_SECRET` is the same `AUTH_JWT_SECRET` the app signs with, so PostgREST accepts exactly the tokens this process mints. `AUTH_TOKEN_ISSUER` / `AUTH_TOKEN_AUDIENCE` are per environment, and the audience reaches PostgREST through `PGRST_JWT_AUD` so the two cannot disagree. |

---

## Roles

The `app_role` enum and `roles` table define **six** roles:

| Role | Intent | Can enter admin portal? |
|------|--------|------------------------|
| `SUPER_ADMIN` | Unrestricted across every company and setting | ✅ |
| `SUBSIDIARY_HR_MANAGER` | Full HR control within one assigned company | ⚠️ not in `STAFF_ROLES` |
| `RECRUITER` | Candidates, jobs, assessments for assigned companies | ✅ |
| `HIRING_MANAGER` | Review & interview candidates for assigned roles | ✅ |
| `INTERVIEWER` | Read-only candidate access + interview scheduling | ⚠️ not in `STAFF_ROLES` |
| `CANDIDATE` | Portal access to their own application only | ❌ (candidate surface) |

> **Known gap:** `STAFF_ROLES` in `src/lib/auth/session.ts` lists only `SUPER_ADMIN`, `RECRUITER`, `HIRING_MANAGER`. A user holding `SUBSIDIARY_HR_MANAGER` or `INTERVIEWER` therefore has permission grants in the database but is bounced by `requireStaff` before reaching any admin page. Adding those roles to `STAFF_ROLES` is the one-line change that would activate them — deliberately left as-is here so this doc matches the code.

---

## Permissions (RBAC)

Grants live in `role_permissions (role_key, permission_key, granted)`. A `granted = false` row is an explicit deny (e.g. `RECRUITER → candidates.delete = false`). Checks run through `hasPermissionForUser(key)` / `permissionsForCurrentUser()`.

The **20** permission keys, grouped:

| Group | Keys |
|-------|------|
| Analytics | `analytics.view`, `analytics.export` |
| Candidates | `candidates.read`, `candidates.write`, `candidates.view_scores`, `candidates.delete` |
| Scores | `scores.view_unmasked` |
| Jobs | `jobs.manage` |
| Assessments | `assessments.create`, `assessments.assign`, `assessments.grade` |
| Interviews | `interviews.schedule` |
| Communications | `messages.send` |
| Time | `time.track` |
| Administration | `companies.manage`, `settings.manage_platform`, `settings.manage_roles`, `settings.manage_users`, `users.create`, `users.manage` |

### Default grants (from the seed)

| Permission | SUPER_ADMIN | SUBSIDIARY_HR_MGR | RECRUITER | HIRING_MGR | INTERVIEWER |
|---|:--:|:--:|:--:|:--:|:--:|
| analytics.view | ✅ | ✅ | ✅ | ✅ | — |
| analytics.export | ✅ | ✅ | — | — | — |
| candidates.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| candidates.write | ✅ | ✅ | ✅ | — | — |
| candidates.view_scores | ✅ | ✅ | ✅ | ✅ | — |
| candidates.delete | ✅ | ✅ | ❌ (denied) | — | — |
| jobs.manage | ✅ | ✅ | ✅ | — | — |
| assessments.create / assign | ✅ | ✅ | ✅ | — | — |
| assessments.grade | ✅ | ✅ | — | — | — |
| interviews.schedule | ✅ | ✅ | ✅ | ✅ | ✅ |
| messages.send | ✅ | ✅ | ✅ | — | — |
| time.track | ✅ | ✅ | ✅ | ✅ | — |
| companies.manage | ✅ | — | — | — | — |
| settings.manage_platform / roles | ✅ | — | — | — | — |
| settings.manage_users, users.create/manage | ✅ | ✅ | — | — | — |
| scores.view_unmasked | ✅ | — | — | — | — |

`SUPER_ADMIN` holds every permission. Editing grants is itself gated by `settings.manage_roles` (Settings → Roles).

---

## Credential & secret handling

### Provider API keys — encrypted at rest

Third-party secrets (AI keys, WhatsApp token, SMTP password) are stored in `provider_credentials` / `app_settings` (`is_secret`) as **AES-256-GCM** envelopes (`src/lib/crypto/secrets.ts`):

- Key derived via SHA-256 from the `SETTINGS_ENCRYPTION_KEY` env var (must be ≥ 32 chars; generate with `scripts/generate-encryption-key.mjs`).
- Stored blob: `base64( iv(12) ‖ ciphertext ‖ authTag(16) )` — GCM authenticates, so a tampered row fails to decrypt instead of returning garbage.
- The module is `server-only`: importing it from a Client Component is a **build error**, which is what guarantees secrets never enter the browser bundle.
- `provider_credentials` has **RLS enabled with zero policies** — only the service-role client can read it. Writes go through `settings/application/credential-actions*.ts`, which audit every change to `credential_audit_log`.

### Cron endpoints — shared secret

`/api/cron/whatsapp` and `/api/cron/grading` require an `x-cron-secret` header equal to `CRON_SECRET`, and **fail closed (503)** when it is unset.

### WhatsApp webhook — verification token

The omnichannel connector uses `WHATSAPP_VERIFY_TOKEN` (default `sharm-dreams-verify`) and the Graph API (`v21.0`). The access token and sender id are resolved through `resolveSecret("whatsapp")` / `resolveConfig("whatsapp")` — a key stored in Settings → API keys wins, falling back to the `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` env vars.

### Invites

New staff are invited into `user_invites` (role + company + `expires_at`, default +7 days). Accepting an invite provisions the `auth.users` row and their `user_profiles` row — through `authAdmin` (`src/lib/auth/admin-users.ts`, four parameterised statements over the `pg` pool), because `auth` is not exposed over REST. `src/modules/settings/application/user-actions.ts` is the only caller of the `auth.admin` surface, and `listUsers({ page, perPage })` now resolves to `limit`/`offset` over `auth.users` rather than one page of an admin API.

---

## Candidate & public auth

- **Candidates** authenticate to the portal with their tracking code (and email); RLS limits them to their own application.
- **Assessment attempts** are reached only through an unguessable `access_token` in `/api/attempt/[token]/*`; RLS scopes a candidate's reads/writes to that attempt.
- **Public careers** surfaces use the anon client (`src/lib/supabase/anon.ts` — the same PostgREST transport with `token: null`, so Postgres runs the query as the `anon` role) under public RLS: insert applications/attachments/leads, read published jobs. No session is created or required, and there is no anon *key* anywhere in the tree.

---

## Checklist for a new protected action

1. Call `requireStaff(route)` (staff) or validate the token (candidate).
2. Check the specific permission with `hasPermissionForUser('…')`.
3. Query with the **session client** so RLS applies; use the service client only for a privileged write after re-checking in code.
4. Validate input with Zod.
5. Record an audit row (`activity_log` / `settings_audit_log` / `credential_audit_log`) and publish a `live` change.
