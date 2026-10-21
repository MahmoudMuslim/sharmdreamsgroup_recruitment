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
with the existing 88 row-level-security policies still doing the enforcing, and
nothing imported from the two vendors. The migration itself is finished only by
the cut-over in §9.

> **Policy count, corrected 2026-10-21.** This section said 94. The file says 88 —
> `grep -c "^create policy" supabase/schema.sql` → **88** — and the live database
> agrees: `select count(*) from pg_policies` on the restored local stack → **88**
> (80 on `public`, 8 on `storage`). The six gone are the three `to public … using
> (true)` and three `with check (true)` policies that Plan 1 Task 5 dropped off the
> legacy `jobs` / `applicants` pair, and revoked `anon`'s table grants on both. The
> 94 was true when this spec was approved; it is not what the port carried.

### Locked decisions (from the brainstorming gate)

| Area | Decision | Rejected alternatives |
| --- | --- | --- |
| Driver | Sovereignty / anti-lock-in | — |
| Host | One Linux VPS (Hostinger KVM2: 2 vCPU, 8 GB, 100 GB NVMe, self-managed), Docker Compose | managed hosts |
| Sequencing | **Approach A** — build the stack alongside the app, port in ordered slices; dev on this device first | B (port against the VPS), C (leave hosts first, own code later) |
| Local data | **Restore the live `pg_dump` into the local dev DB too** (owner's deliberate non-recommended pick) | fresh start, seed-only dev DB |
| Data layer | **Self-host PostgREST; leave the query call sites alone** | `pg` + hand-written SQL; a PostgREST-shaped shim over `pg` |
| Row-level trust | Port the RLS policies unchanged behind a `auth`/`storage` schema shim — 88 at execution time, not the 94 this table first said (see §1's correction) | rewrite policies |
| Sign-in | Hand-rolled signed-cookie sessions over the migrated `auth.users` bcrypt hashes | `better-auth`, GoTrue |
| Files | `/data/uploads` volume + a `files` table replacing `storage.objects`; own short-lived signed links | MinIO, split-by-size hybrid |
| Cut-over | One planned freeze with DNS rollback | logical replication, freeze-writes-only |

---

## 2. Measured seams (these size the hand-written work)

All figures re-derived from the working tree on 2026-10-20, **and re-measured on
2026-10-21 after Plan 1 landed**, because several of them moved. They are the
reason the migration is a re-point, not a rebuild. Each row is checkable with the
command printed beside it.

| Coupling | Count (2026-10-21) | Check | Where |
| --- | --- | --- | --- |
| `.from("table")` reads against PostgREST | **442** across 65 files | `grep -rn '\.from("' src/ \| wc -l` | the query layer — kept as-is |
| `.from(variable)` bucket/table refs | **17** (was 26) | the non-literal half of `grep -rn '\.from([A-Za-z_$]' src/`, after dropping `Array/Buffer/String/Number/Object.from` and comment hits | 12 dynamic table names + the 5 bucket refs now inside the files seam |
| `createSupabaseServerClient()` call sites | **128** across 45 files, plus the definition at `src/lib/supabase/server.ts:12` (was 129 across 46 — the deleted file was the `middleware.ts` that became `src/proxy.ts`) | `grep -rn 'createSupabaseServerClient()' src/ \| wc -l` | per-request; re-point one seam, not 128 |
| Files importing `@supabase/*` | **2** in `src/`, **3** repo-wide (was 13) | `grep -rl "@supabase/" src/` → `src/app/(candidate)/portal/actions.ts`, `src/lib/files/store.ts`; `grep -rln @supabase/supabase-js --include=*.{ts,tsx,mjs} . \| grep -v node_modules` adds `scripts/create-staff.mjs` | the vendor package survives Plan 1 exactly because these three still import it |
| `supabase.auth.*` call sites | **15** — 13 are `auth.admin.*`, all in `user-actions.ts`, plus 2 `supabase.auth.getUser()` (`job-actions.ts:141`, `transcriptStore.ts:71`) (was 24) | `grep -roh 'supabase\.auth\.[a-zA-Z]*' src/ \| sort \| uniq -c` | the 13 became direct `auth.users` writes in Task 14; the 2 `getUser()` reads still resolve against the vendor client |
| Storage accessors — `supabase.storage.from(bucket)` lines | **5, and they all live in one file now** (`src/lib/files/store.ts:70,76,81,90,94` — one each of `upload`, `createSignedUrl`, `download`, `remove`, `list`) | `grep -c "from(bucket)" src/lib/files/store.ts` → 5; `grep -rn "supabase\.storage" src/ \| wc -l` → **0** | files slice — and this is **not** the 16 the plan told Task 18 to write. Task 10 pulled every bucket call behind `getFileStore()`, so the 16 pre-seam accessor sites became 5 here plus 14 seam callers; quoting 16 now would be the same class of error as the original 5 |
| …reached from | **14** `await getFileStore()` call sites across **14** files | `grep -rln "getFileStore()" src/ \| grep -v "src/lib/files/store.ts" \| wc -l` → 14 | the seam Task 10 built |
| …and the naive grep | `grep -rn "\.storage" src/ \| wc -l` → **7** | five are `storage_path` **column** reads (attachment, CV, dossier, profile, files actions), one is a display template string (`attachment-actions.ts:72`) and one is a comment naming the column (`files/actions.ts:291`) — none is an accessor call. The plan's older naive figure of **23** was this same 7 plus the 16 pre-seam accessor lines; both halves are gone from that count now, which is why the seam, not the grep, is the metric |
| RPC names the app calls | **2** — `stop_time_entry`, `refresh_attempt_integrity` | `grep -rn "\.rpc(" src/` | `timelog/application/ledger.ts:323`, `api/attempt/[token]/integrity/route.ts:88` |
| …vs the RPC surface actually exposed | **15** | every `public` function carries `execute` for `anon` and `authenticated`, so PostgREST lists all 15 as `/rpc/*` | an exposure to decide about in Plan 2, not a call site |
| Inbound webhooks | **0** | no `hub.verify_token` / `x-hub-signature` anywhere in `src/` | unchanged |
| Realtime / Edge Functions / Vault / `generateLink` | **0** each | `grep -rn '\.channel(\|supabase\.realtime\|functions\.invoke\|generateLink' src/` → 0 | unchanged — the port is smaller than it looks |

Behaviour that changes on a persistent process (was serverless): **10** `after()`
sites (was 8) and **25** `await connection()` sites (was 22). Quote the count with
its pattern: `grep -rn '\bafter(' src/ | wc -l` prints **11**, and the eleventh hit
is prose, not a call — a comment at `src/modules/settings/infrastructure/settingsReader.ts:9`. The module-global
singletons this section named at `anon.ts:5`, `service.ts:5` and `middleware.ts:34`
have moved or gone: measured 2026-10-21, the two that remain are
`src/lib/supabase/anon.ts:3` (`let anonClient: RestClient | null`) and
`src/lib/auth/db.ts:12` (the `pg` `Pool`); `service.ts` mints per call and holds no
singleton, and `middleware.ts` no longer exists — it is `src/proxy.ts`.

---

## 3. The constraint that fixes the order of work

Supabase's managed PostgREST validates JWTs against the project secret, so a token
we sign ourselves can never be accepted there. The identity half is **only provable
against a PostgREST we own.** Therefore a local `docker/` stack is a prerequisite,
not a nicety — and "convert all the code on Vercel first, then lift" is impossible.
Everything below is ordered around that fact.

---

## 4. Slice 1 — Local stack topology

Docker Compose on a private bridge network. Slice 1 ran the app **outside**
Docker with `next dev` on the host, on **port 3000** (the owner's existing dev
server on 3001 is left untouched); the app is now built into the `app` container
behind nginx on that same 3000, and the host `next dev` remains available by
pointing the cron container at `host.docker.internal:3000`.

| Service | Image | Role | Host port |
| --- | --- | --- | --- |
| `db` | `postgres:18.6-alpine3.24` | plain Postgres; the restored dump | `54320 → 5432` |
| `rest` | `postgrest/postgrest:v16.5` | serves the 442 reads; turns our JWT into `request.jwt.claims` | none — gateway/nginx only |
| `gateway` | `caddy:2.11.7-alpine` | `/rest/v1` for the host's `next dev` | `54321 → 8080` |
| `app` | built from `docker/app/Dockerfile`, `node:24.22.0-alpine3.24` | the built Next.js app | none — nginx only |
| `nginx` | `nginx:1.30.6-alpine3.24` | the public front for app + `/rest/v1` | **3000** → 80 |
| `cron` | built from `docker/cron/Dockerfile`, `alpine:3.24.2` | scheduler hitting `/api/cron/grading` + `/api/cron/whatsapp` | outbound only |

_Image policy, set 2026-10-21: every base is patch-pinned to the newest **stable**
release on one Alpine (3.24) so a single CVE sweep covers the stack. Postgres 19
is excluded as `19rc1` only, nginx 1.31 as mainline (1.30 is the stable branch),
and Node 26 as `current` (the `lts` alias still resolves to 24). Bump none of
these from memory — re-read the registry tag list._

No MinIO, no Redis, no GoTrue. On KVM2 this same file gains TLS at nginx and
secrets that never enter the repo; Caddy goes away when the host's `.env.local`
`SUPABASE_REST_BASE` line does. **As of 2026-10-21 that line is still in the file
(`grep -c SUPABASE_REST_BASE .env.local` → 1, and it still names port 54321), so
Caddy runs beside nginx deliberately** — nginx serves its own `/rest/v1/` on 3000
(`docker/nginx/nginx.conf:125`, `location /rest/v1/ { proxy_pass http://sdg_rest/; }`),
and the two gateways are not in conflict: the container reads nginx, the host's
`next dev` reads Caddy. Retiring Caddy is a Plan 2 item, not an oversight.

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
  created before any grant parses. PostgREST's `db-anon-role` is **`anon`**
  (`docker/docker-compose.yml:74`, `PGRST_DB_ANON_ROLE: anon`).
  > This line said `authenticated`. That was wrong, and the wrongness was the
  > dangerous kind: `db-anon-role` is the role PostgREST uses for a request that
  > carries **no** JWT, so setting it to `authenticated` would have made every
  > unauthenticated read arrive as the staff role. RLS would still have answered —
  > and answered wrongly, because the policies key off the claims, not the role.
  > `anon` is what makes "no token" mean "no identity" in the database.
- **`auth` schema**: `auth.users` carrying the migrated `encrypted_password`
  (bcrypt), plus `auth.uid()` reading our own claim —
  `nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'`.
  > This line read `->> 'uid'`. The function actually deployed reads **`'sub'`**,
  > verbatim from the live database:
  > `select pg_get_functiondef(p.oid) … where n.nspname='auth' and p.proname='uid'`
  > returns `select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid`.
  > Our own token mints `sub`, so `'uid'` would have made `auth.uid()` return NULL
  > and every identity-bearing policy admit nobody — silently, with no error.
  That single function is the door 80 of the 88 policies reach identity through
  (via `is_staff()` 66, `has_permission()` 41, `is_super_admin()` 12,
  `current_user_profile_id()` 12, `user_tenant_id()` 11 — those five are
  **occurrence** counts of the call text inside the file's `create policy`
  statements, re-verified 2026-10-21 by splitting `supabase/schema.sql` on `;\n`
  and counting per function). Only **3** policies call `auth.uid()` itself
  (4 occurrences: `profiles_self_read`, `applications_candidate_self`, and
  `profiles_self_update` which uses it in both `using` and `with check`); the rest
  reach it transitively through the five helpers, which is what "the door 80 reach
  identity through" actually means.
- **`storage` schema** shimmed so its 8 policies parse, then replaced in §7.
- **PG17 or newer is forced by the dump** — every grant carries the `maintain`
  privilege (PG17+ only). `pg_stat_statements` needs `shared_preload_libraries`.
  The stack runs 18.6: nothing in the dump needs 18, and nothing in it breaks on
  18, but a major bump means the `db-data` volume must be recreated, not reused.
- **Delete, don't port**: `create schema vault` + `supabase_vault` (schema.sql:30-31)
  and the two `alter publication supabase_realtime …` lines — nothing uses them.
- **`jobs` / `applicants`** currently get `grant … to anon` with `using (true)`
  policies and are referenced by no code. **Lock them down during this slice** —
  revoke + drop the `true` policies. Free win; it is the one place "RLS on 41/41"
  ≠ "RLS protecting 41/41".
  > **Done in Plan 1 Task 5, and it is where the 94 became 88.** Measured on the
  > live stack 2026-10-21: both tables now hold **0** policies, and a bearer request
  > for them is refused at the grant, not the policy — `scripts/prove-local-stack.mjs`
  > records HTTP 403 with PostgreSQL `42501` and "0 policies" for each. The
  > reconciled partition of the surviving 88: **78** admit an identity and nothing
  > else, **3** read only the `attempt_token` claim, **2** do both, **5** carry
  > neither term (`tenants_read using (true)`, `applications_public_insert with
  > check (true)`, `provider_models_public_read` on `is_active`, and the two
  > `storage.objects` upload checks keyed on `bucket_id`). So the honest sentence is
  > "80 of 88 reach identity, 5 read the attempt-token claim, 2 read both, and 5
  > read neither" — not a set of buckets that sums to 88.
- PostgREST config: `db-uri`, `db-schemas = public`, `jwt-secret = <our secret>`,
  expose the 2 RPC names.

**Definition of done:** the throwaway proof still passes (41 tables / 88 policies
atomic + idempotent), and a signed request against the local PostgREST returns the
same rows an equivalent Supabase request returns for the same `uid`.

---

## 6. Slice 3 — Sessions + cookies (replacing `@supabase/ssr`)

Re-point **one** seam — `src/lib/supabase/server.ts:12` (this section said `:10`;
the function is on line 12 today) — so
`createSupabaseServerClient()` returns a client of the same shape pointed at our
PostgREST with a bearer from our cookie. The 128 call sites keep working.

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

> **Measured 2026-10-21, three changes to this section.** (1) The `candidate-cvs`
> omission is **already fixed**: `src/lib/config.ts:72-80` lists all four buckets,
> `candidateCvs: "candidate-cvs"` included, with its own comment naming the broken CV
> link as the reason. No Plan 2 task should re-fix it. (2) The vendor surface this slice
> has to swallow is now measured exactly, and it is small: **5 accessor lines**
> (`src/lib/files/store.ts:70,76,81,90,94`) behind **14** `getFileStore()` call sites in
> 14 files, and **17 objects / 3.8 MB** still physically in the hosted buckets
> (`candidate-cvs` 13, `candidate-videos` 2, `resumes` 2, `candidate-audio` 0) — listed
> read-only with the service key on 2026-10-21. (3) `.from(variable)` refs are **17**,
> not the 26 this section's first line quotes; §2's row carries the re-measurement.
> (4) The `files` table drops `owner`: `FileStore` carries no session, so no call
> site could fill it and no reader would ever query it — the columns are
> `(bucket, path, mime, bytes, created_at, updated_at)`, and a column nothing reads
> is debt, not foresight. (5) The five accessor lines are at
> `src/lib/files/store.ts:69,75,81,90,94` as of this re-read, not `70,76` — the file
> is unchanged, the earlier pair was counted from a pre-correction read.

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

> **Measured 2026-10-21, and this section's premise is half wrong.** No browser reads
> anything here: walking every `"use client"` file in `src/` for `supabaseConfig`,
> `SUPABASE_REST_BASE` or `NEXT_PUBLIC_SUPABASE` returns **0 files**, and the four
> `SUPABASE_REST_BASE` consumers (`supabase/{anon,server,service}.ts`, `auth/guard.ts`)
> are all server-only. So "the two genuinely browser-read values stay `NEXT_PUBLIC_`"
> describes the design Plan 1 intended, not the one that shipped — every REST read goes
> through a server action. Worse, `docker/docker-compose.yml:143-144` still passes
> `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as **build args**, which
> inlines the vendor URL and the anon key into the client bundle for a value nothing in
> the bundle reads. Plan 2 deletes both build args; that is a real exposure closing, not
> a rename.
>
> Renamed stays, with one exception measured rather than assumed: `SUPABASE_REST_BASE` →
> `REST_BASE_URL` (12 references, all server-side, mechanical), and
> `SUPABASE_DB_PASSWORD` retires with the three hosted scripts that parse it
> (`apply-schema.mjs`, `dump-schema.mjs`, `verify-schema.mjs` — they re-aim at the local
> stack's existing `LOCAL_DB_PASSWORD`). The four vendor credentials
> (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
> `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF`) have **0 readers left** once the
> files seam and the portal's dead branch are gone: `supabaseConfig.url` is read by
> exactly two places today — `src/lib/files/store.ts:60` and
> `src/app/(candidate)/portal/actions.ts:104`.
>
> What does **not** rename: `src/lib/supabase/` and `createSupabaseServerClient()`.
> Those carry **128 call sites across 45 files** (§2), and after Plan 1 they build a
> `pg`/PostgREST client that never touches the vendor. Renaming them is 45 files of
> churn that changes no dependency; the name is now historical, and the module comment
> says so. `supabase/schema.sql` and `scripts/local-supabase-stub.sql` keep their paths
> for the same reason — `apply-local-schema.mjs` reads the first and the 88 RLS policies
> evaluate through the second.

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

> That 94 is a record of what the throwaway run measured on 2026-10-20, and it is
> left as written rather than edited away. Slice 2 then dropped six policies — the
> three `to public … using (true)` and three `with check (true)` on the legacy
> `jobs` / `applicants` pair (§5) — so the same command run today prints **88**
> (`grep -c "^create policy" supabase/schema.sql`), which is the number §1 now uses.

---

## 14. Open items to raise before the freeze

- where the browser is allowed to reach PostgREST (reverse-proxy `/rest/v1` on
  KVM2 vs a host port locally) and the anon JWT's expiry;
- #376 (Settings → Languages console) and the 21 session-gated live proofs must not
  regress during the port; the data-layer debts #330/#331 intersect this work.

---

## 15. Plan 2 — off the vendor completely (scope approved 2026-10-21)

Plan 1 moved the *rows* and the *identity* onto the self-hosted stack and left the
*bytes* with the vendor. Plan 2 moves those bytes, and then removes the vendor from
the dependency graph, the environment surface and the image build. The owner's
directive is the scope, in their words: *"stop using Supabase and Vercel Completely
… remove Supabase and vercel Completely."*

### What "done" means — five claims, each mechanically checkable

1. `npm ls @supabase/supabase-js @vercel/speed-insights` answers "not installed", and
   `grep -rn 'from "@supabase/' src scripts` returns **0**.
2. A clean image build contains no vendor project reference — grepping the built
   `.next/` for the hosted project's ref returns **0 files**. §11 measured that
   nothing in the client bundle reads the two `NEXT_PUBLIC_SUPABASE_*` values today,
   so this claim is the proof that the build args were pure exposure.
3. Every byte the portal reads or writes lives under `/data/uploads/<bucket>/<path>`
   on a named volume with a matching `files` row, and no accessor can resolve a path
   outside its own bucket.
4. The environment carries **zero** vendor credentials: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_DB_PASSWORD` no longer exist in any env file, example, build arg or
   `src/lib/config.ts` field; `scripts/audit-secrets.mjs` asserts their *absence*.
5. The identity spine is untouched: the Plan 1 gates still pass as they did at
   `28a9467`, with only the storage shim's **8** `storage.objects` policies retired
   (88 → 80 in `supabase/schema.sql`).

### The vendor surface, measured 2026-10-21 — this is the whole job

| what | how many | where |
| --- | --- | --- |
| storage accessor lines left | **5** | `src/lib/files/store.ts:69,75,81,90,94` (upload, signedUrl, download, remove, list) |
| seam call sites that must not change | **14** in **14** files | every `await getFileStore()` in `src` (the two other grep hits are the definition at `:65` and the comment at `:44`) |
| objects still at the vendor | **17**, **3.8 MB** | `candidate-cvs` 13, `candidate-videos` 2, `resumes` 2, `candidate-audio` 0 |
| `@supabase/supabase-js` importers | **3** | `src/lib/files/store.ts`, the dead anon fallback at `src/app/(candidate)/portal/actions.ts:104` (deletion granted by the owner 2026-10-21), `scripts/create-staff.mjs` |
| `@vercel/speed-insights` importers | **0** | `package.json:29` only — an unused dependency, so its removal is one `npm uninstall`, no code edit |
| vendor credentials still read in `src` | `url` **2**, `anonKey` **1**, `serviceRoleKey` **1** | all three are the two rows above; after Plan 2 each has 0 readers |
| `supabaseConfig.buckets` readers | **4** | all four read `candidateVideos` — these stay, they name *our* buckets |
| `storage.objects` policies to retire | **8** | `supabase/schema.sql:1759-1795` |
| build args to delete | **2** | `docker/app/Dockerfile:31-34`, `docker/docker-compose.yml:138-144` |
| `SUPABASE_REST_BASE` refs to rename | **12** | → `REST_BASE_URL` (§11) |

One afternoon of extraction, not a migration: the entire payload is 3.8 MB.

### The ordering rule — extract first, delete last

Deleting the vendor dependency is irreversible in a way the rest of this port is not:
after it, a byte exists only where we put it. So the sequence is fixed and no step
may be reordered — **extract** the 17 objects and a hosted `pg_dump` into git-ignored
`docker/data/`, **prove** the extraction by opening every file back, **cut over** the
code to the disk store and prove the running app, and only **then** delete the
package, the credentials and the shim. The hosted Supabase project and the Vercel
deployment are the owner's to close, and only after they have kept an off-machine
copy of the dump; nothing in this plan deletes anything on the vendor side.

### The tasks

1. Extract the vendor's 17 objects + a manifest, and take the hosted `pg_dump` (read-only against the vendor; output git-ignored).
2. `files` table + its RLS, mirroring the 8 storage policies being retired.
3. Disk-backed `FileStore` over `/data/uploads` + `files` rows, with resolve-and-verify traversal guards.
4. Own HMAC short-lived signed links streamed by a route handler, with Range support so a video pitch still seeks.
5. Swap the body of `store.ts` (14 callers unchanged) and live-prove every byte path.
6. Load the extracted bytes into the volume and verify each one opens.
7. Delete the granted dead anon-key fallback; retire the hosted `scripts/create-staff.mjs`.
8. Uninstall `@supabase/supabase-js` + `@vercel/speed-insights`, delete the five HOSTED-ONLY config fields and the dead `process.env.VERCEL` term.
9. Env surface: drop the four vendor credentials and both build args, rename `SUPABASE_REST_BASE` → `REST_BASE_URL`, retire `SUPABASE_DB_PASSWORD` onto `LOCAL_DB_PASSWORD`.
10. Retire the `storage` shim and its 8 policies from the schema of record, re-measuring the count.
11. Acceptance from a wiped volume, plus the STATUS section that names only what the owner still has to do.

What this plan deliberately does **not** rename is §11's non-rename list, and it
still holds: `src/lib/supabase/`, `createSupabaseServerClient()`,
`supabase/schema.sql` and `scripts/local-supabase-stub.sql` keep their names.
