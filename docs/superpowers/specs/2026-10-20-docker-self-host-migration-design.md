# Docker self-host migration — design spec

**Date:** 2026-10-20
**Status:** Approved by the product owner; ready for the implementation plan.
**Audience:** the owner (solo) and any agent picking this up later.
**Scope:** move `sharm_dreams_group` completely off Supabase and Vercel onto a
self-hosted Docker stack — dev on this Windows device first, production on a
Hostinger KVM2 VPS.

This document is the design, not the task list. The ordered build plan lives
alongside it (produced by the writing-plans skill).

---

## 1. Why, and what "done" means

The driver is sovereignty: plain Postgres plus auth, storage and scheduling the
owner runs themselves, with no `@supabase/*` package or `vercel.*` dependency left
in the tree. Self-hosting Supabase's own images (GoTrue, its PostgREST) does not
count as leaving — that option was ruled out on principle, not cost.

"Done" is the live portal running on the owner's own host, on the migrated data,
with the existing 94 row-level-security policies still doing the enforcing, and
nothing imported from the two vendors. The migration itself is finished only by
the cut-over in §9.

### Locked decisions (from the brainstorming gate)

| Area | Decision | Rejected alternatives |
| --- | --- | --- |
| Driver | Sovereignty / anti-lock-in | — |
| Host | One Linux VPS (Hostinger KVM2: 2 vCPU, 8 GB, 100 GB NVMe, self-managed), Docker Compose | managed hosts |
| Sequencing | **Approach A** — build the stack alongside the app, port in ordered slices; dev on this device first | B (port against the VPS), C (leave hosts first, own code later) |
| Local data | **Restore the live `pg_dump` into the local dev DB too** (owner's deliberate non-recommended pick) | fresh start, seed-only dev DB |
| Data layer | **Self-host PostgREST; leave the query call sites alone** | `pg` + hand-written SQL; a PostgREST-shaped shim over `pg` |
| Row-level trust | Port the 94 RLS policies unchanged behind a `auth`/`storage` schema shim | rewrite policies |
| Sign-in | Hand-rolled signed-cookie sessions over the migrated `auth.users` bcrypt hashes | `better-auth`, GoTrue |
| Files | `/data/uploads` volume + a `files` table replacing `storage.objects`; own short-lived signed links | MinIO, split-by-size hybrid |
| Cut-over | One planned freeze with DNS rollback | logical replication, freeze-writes-only |

---

## 2. Measured seams (these size the hand-written work)

All figures re-derived from the working tree on 2026-10-20. They are the reason
the migration is a re-point, not a rebuild.

| Coupling | Count | Where |
| --- | --- | --- |
| `.from("table")` reads against PostgREST | **442** across 65 files | the query layer — kept as-is |
| `.from(variable)` bucket/table refs | **26** | dynamic table/bucket names |
| `createSupabaseServerClient()` constructions | **129** across 46 files | per-request; re-point one seam, not 129 |
| Files importing `@supabase/*` | **13** | the only build-time vendor deps |
| `supabase.auth.*` call sites | **24** (13 are `auth.admin.*`) | 13 in `src/modules/settings/application/user-actions.ts` |
| `supabase.storage.from(bucket)` accessor lines | **5** | files slice |
| RPC names to expose on PostgREST | **2** | `stop_time_entry`, `refresh_attempt_integrity` |
| Inbound webhooks | **0** | no `hub.verify_token`/`x-hub-signature` anywhere in `src/` |
| Realtime / Edge Functions / Vault / `generateLink` | **0** | unused — the port is smaller than it looks |

Behaviour that changes on a persistent process (was serverless): **8** `after()`
sites and **22** `await connection()` sites, plus module-global singletons at
`anon.ts:5`, `service.ts:5`, `middleware.ts:34`. Audited in the sessions slice.

---

## 3. The constraint that fixes the order of work

Supabase's managed PostgREST validates JWTs against the project secret, so a token
we sign ourselves can never be accepted there. The identity half is **only provable
against a PostgREST we own.** Therefore a local `docker/` stack is a prerequisite,
not a nicety — and "convert all the code on Vercel first, then lift" is impossible.
Everything below is ordered around that fact.

---

## 4. Slice 1 — Local stack topology

Docker Compose on a private bridge network. The app runs **outside** Docker with
`next dev` on the host, on **port 3000** (the owner's existing dev server on 3001
is left untouched).

| Service | Image | Role | Host port |
| --- | --- | --- | --- |
| `db` | `postgres:17-alpine` | plain Postgres; the restored dump | `54320 → 5432` |
| `rest` | `postgrest/postgrest` | serves the 442 reads; turns our JWT into `request.jwt.claims` | `54321 → 3000` |
| `web` | host `next dev` | the app | **3000** |
| `cron` | thin `curl`/node image | scheduler hitting `/api/cron/grading` + `/api/cron/whatsapp` | outbound only |

No MinIO, no Redis, no GoTrue. On KVM2 the same file gains a Caddy/Nginx TLS front,
`web` becomes a built image, and the browser reaches PostgREST through the reverse
proxy at `/rest/v1` (locally the app talks to `localhost:54321` directly).

`package.json:4` is bare `next dev` and `.env.local` already points `APP_URL` /
`NEXT_PUBLIC_APP_URL` at 3000, so slice 1 only adds the new `SUPABASE_*`-shaped
names pointing at the local stack (see §11).

---

## 5. Slice 2 — Identity + RLS foundation (the prerequisite)

Stand in, in plain Postgres, everything Supabase hosts outside `public`, so the
restored dump's policies run unchanged. The existing
`scripts/local-supabase-stub.sql` + `scripts/apply-proof-schema.mjs` already do
this and already pass.

- **Roles** `anon`, `authenticated`, `service_role` (`service_role` `bypassrls`),
  created before any grant parses. PostgREST's `db-anon-role` is `authenticated`.
- **`auth` schema**: `auth.users` carrying the migrated `encrypted_password`
  (bcrypt), plus `auth.uid()` reading our own claim —
  `nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'uid'`.
  That single function is the door 80 of the 94 policies reach identity through
  (via `is_staff()` 66, `has_permission()` 41, `is_super_admin()` 12,
  `current_user_profile_id()` 12, `user_tenant_id()` 11).
- **`storage` schema** shimmed so its 8 policies parse, then replaced in §7.
- **PG17 is forced by the dump** — every grant carries the `maintain` privilege
  (PG17+ only). `pg_stat_statements` needs `shared_preload_libraries`.
- **Delete, don't port**: `create schema vault` + `supabase_vault` (schema.sql:30-31)
  and the two `alter publication supabase_realtime …` lines — nothing uses them.
- **`jobs` / `applicants`** currently get `grant … to anon` with `using (true)`
  policies and are referenced by no code. **Lock them down during this slice** —
  revoke + drop the `true` policies. Free win; it is the one place "RLS on 41/41"
  ≠ "RLS protecting 41/41".
- PostgREST config: `db-uri`, `db-schemas = public`, `jwt-secret = <our secret>`,
  expose the 2 RPC names.

**Definition of done:** the throwaway proof still passes (41 tables / 94 policies
atomic + idempotent), and a signed request against the local PostgREST returns the
same rows an equivalent Supabase request returns for the same `uid`.

---

## 6. Slice 3 — Sessions + cookies (replacing `@supabase/ssr`)

Re-point **one** seam — `src/lib/supabase/server.ts:10` — so
`createSupabaseServerClient()` returns a client of the same shape pointed at our
PostgREST with a bearer from our cookie. The 129 call sites keep working.

- **Sign in:** verify the submitted password against the migrated bcrypt hash in
  `auth.users` (staff passwords keep working). Mint a short-lived (~15 min) signed
  token carrying `{ uid, attempt_token? }` and nothing else — role and tenant come
  from `user_profiles`, never claims, and `raw_app_meta_data` is never written.
- **Carry it:** an httpOnly, SameSite=Lax cookie; the seam reads it and the client
  sends it as `Authorization: Bearer`, which is what makes `request.jwt.claims` land
  in PostgREST.
- **Idle sign-out:** port the proven logic in `middleware.ts:81 updateSession` (the
  `sdg_staff_last_active` cookie, the `session_timeout_minutes` read, the `sb-*`
  cleanup) into our own proxy; reconsider the 60 s `timeoutMemo` process-global,
  which no longer self-resets on a long-lived container.
- **Candidates** have no `auth.users` row — their session *is* the `attempt_token`,
  so the bearer path (5 policies reading `request.jwt.claims ->> 'attempt_token'`)
  serves them, unchanged. **The candidate portal is off-limits — do not edit it.**

**Definition of done:** staff can sign in on 3000, the cookie round-trips to a
correct `auth.uid()`, RLS admits exactly the right rows, and the idle timeout
signs out as it does today.

---

## 7. Slice 4 — Files (drop `storage.objects`)

Small, contained surface: 5 `.storage.from(bucket)` lines + 26 `.from(variable)`
refs. Replace with a `files` table (bucket, path, owner, mime, size, created)
guarded by the same `is_staff()` / `candidates.write` predicates, a
`/data/uploads/<bucket>/<path>` volume, and our own HMAC-signed short-lived links
(every browser-facing file URL is already minted server-side). Buckets:
`candidate-videos`, `candidate-audio`, `resumes`, **plus `candidate-cvs`**, which
`config.ts:48-52` omits — a latent bug the port would otherwise inherit.

---

## 8. Slice 5 — Staff CRUD (the 13 `auth.admin.*` sites)

All 13 live in `user-actions.ts` (create/delete/list users, `ban_duration`, password
reset, email change with rollback). With GoTrue gone these become direct writes to
`auth.users` through the service-role seam; the `listUsers({page:1,perPage:1000})`
whole-directory assumption becomes a plain `select`. `scripts/create-staff.mjs`
(GoTrue admin API) is rewritten against the same path. Pair with **#334** (the
role-permissions editor gate that does not match its RLS policy) while the boundary
is open.

---

## 9. Slice 6 — Cron, then cut-over

`/api/cron/grading` and `/api/cron/whatsapp` exist and work when called, but
**nothing calls them** — the top live risk. The `cron` container (or a host crontab
on KVM2) hits both URLs on an interval with a service-role bearer. This is the one
place leaving serverless makes the product better, and it finally lets us prove
#236 (a queue write reaching the Live badge).

**Cut-over script (KVM2), not code:** read-only flag → `pg_dump` live → restore →
port identity + files → verify row counts → signed-in smoke test → DNS flip. On any
smoke-test failure, roll DNS back to Supabase and retry another day.

---

## 10. PII on this device (the owner's explicit choice)

A full copy of candidate PII sits on this Windows box for the life of the port.
Non-negotiables, not arguments:

- dump/restore files live **only** under `docker/data/`, git-ignored, never in the
  repo tree;
- each re-dump overwrites the prior local copy; `docker compose down -v` is the
  documented wipe;
- the `db` data dir is a Docker volume, not a bind-mount into the repo;
- at-rest encryption is unchanged — provider creds are app-side AES-256-GCM
  (`src/lib/crypto/secrets.ts`), so a `pg_dump` carries opaque ciphertext only Node
  can open and the key never enters Postgres. No vault re-wrap.

---

## 11. Environment surface

`src/lib/config.ts` and `.env.example` are renamed and re-pointed, not redesigned.
The two genuinely browser-read values stay `NEXT_PUBLIC_` (PostgREST base URL + a
static anon JWT minted with our secret, role `anon`); `SUPABASE_SERVICE_ROLE_KEY`
and `SUPABASE_DB_PASSWORD` become server-only names for our own service-role token
and the Postgres URI. The old `NEXT_PUBLIC_SUPABASE_URL`, anon/service keys and DB
password all stop existing as Supabase artefacts.

---

## 12. Explicit non-goals

Realtime, Edge Functions, Vault, `generateLink` (all zero-use); the candidate portal
and its `NoticeInbox` / `communication_logs` read/dismiss design (off-limits); and
any LinkedIn login automation.

---

## 13. Foundation evidence (already proven, 2026-10-20)

`node scripts/apply-proof-schema.mjs` against a throwaway `postgres:17-alpine`
applied `supabase/schema.sql` as one atomic script on vanilla PG17 behind the stub
shim → **41 tables, 94 policies, 15 functions, 15 triggers, 4 buckets**, idempotent
on re-apply, and the **only** skipped statement is `supabase_vault`. So "port the 94
policies unchanged behind a shim" is demonstrated end-to-end with zero PII. The
live-dump restore remains a separate, explicitly-gated step later in slice 2.

---

## 14. Open items to raise before the freeze

- where the browser is allowed to reach PostgREST (reverse-proxy `/rest/v1` on
  KVM2 vs a host port locally) and the anon JWT's expiry;
- #376 (Settings → Languages console) and the 21 session-gated live proofs must not
  regress during the port; the data-layer debts #330/#331 intersect this work.
