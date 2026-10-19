# Authentication & Authorization

Auth is layered. No single check is trusted alone — a request must pass through **Supabase Auth → session resolution → the staff route gate → RBAC permissions → Row Level Security** before data moves.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [DATABASE.md](DATABASE.md) · [API.md](API.md) · [AI_INTEGRATION.md](AI_INTEGRATION.md)

---

## The five layers

| Layer | Where | What it decides |
|-------|-------|-----------------|
| **1. Identity** | Supabase Auth (`@supabase/ssr`) | Is there a valid signed-in user? JWT lives in cookies. |
| **2. Session** | `src/lib/auth/session.ts` → `getSessionUser()` | Maps the auth user to a `user_profiles` row (role, tenant, name). Cached per request. |
| **3. Route gate** | `requireStaff(route)` + `src/lib/auth/staffRoutes.ts` | May this role be in the admin portal at all? |
| **4. RBAC** | `src/modules/settings/infrastructure/permissions.ts` | Does this role hold the specific permission for this action? |
| **5. RLS** | `supabase/schema.sql` policies | Which *rows* may this user see, evaluated by Postgres on every query using `auth.uid()`? |

Layers 3–4 are application checks; **layer 5 (RLS) is the backstop** — even a bug that skips a code check still hits the database policy.

---

## Session flow

```
POST /login  ──►  supabase.auth.signInWithPassword()
                    │  sets auth cookies (JWT)
                    ▼
Next request ──►  getSessionUser()   (React cache: one auth.getUser() per request)
                    │  reads user_profiles by auth_user_id
                    ▼
                SessionUser { authUserId, profileId, email, fullName, role, tenantId }
                    │
                    ▼
                requireStaff(route)  ──►  page renders / action runs
```

- **`getSessionUser()`** is wrapped in React's `cache()` so a page that checks auth half a dozen times (guard + each read + each permission) verifies the JWT once, not repeatedly.
- **`requireStaff(nextPath)`**:
  - no session → `redirect('/login' + returnPath)`
  - session but not a staff role → `redirect('/portal?denied=staff-only')`
  - otherwise returns the `SessionUser`.
- **`src/lib/supabase/middleware.ts`** refreshes the session on every request and enforces the idle session timeout; a candidate hitting a staff path is bounced to their portal.

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

The omnichannel connector uses `WHATSAPP_VERIFY_TOKEN` (default `sharm-dreams-verify`) and the Graph API (`v21.0`) with `WHATSAPP_CLOUD_API_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`.

### Invites

New staff are invited into `user_invites` (role + company + `expires_at`, default +7 days). Accepting an invite provisions the Supabase Auth user and their `user_profiles` row.

---

## Candidate & public auth

- **Candidates** authenticate to the portal with their tracking code (and email); RLS limits them to their own application.
- **Assessment attempts** are reached only through an unguessable `access_token` in `/api/attempt/[token]/*`; RLS scopes a candidate's reads/writes to that attempt.
- **Public careers** surfaces use the anon client under public RLS (insert applications/attachments/leads, read published jobs). No session is created or required.

---

## Checklist for a new protected action

1. Call `requireStaff(route)` (staff) or validate the token (candidate).
2. Check the specific permission with `hasPermissionForUser('…')`.
3. Query with the **session client** so RLS applies; use the service client only for a privileged write after re-checking in code.
4. Validate input with Zod.
5. Record an audit row (`activity_log` / `settings_audit_log` / `credential_audit_log`) and publish a `live` change.
