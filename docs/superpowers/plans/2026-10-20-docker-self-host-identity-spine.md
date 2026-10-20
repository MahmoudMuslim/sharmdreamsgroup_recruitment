# Docker Self-Host Migration — Plan 1: Identity Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a local Docker stack (Postgres 17 + PostgREST + Caddy + cron) that serves the existing 442 PostgREST reads and the 94 ported RLS policies, and replace `@supabase/ssr` with hand-rolled signed-cookie sessions — so the portal runs on this device with a token we mint ourselves.

**Architecture:** One Compose file owns the data plane; the app stays outside Docker (`next dev` on port 3000) and talks to PostgREST through a Caddy gateway that also strips `/rest/v1`. Everything Supabase hosted outside `public` (roles, `auth`, `storage`, `extensions`) is stood in by `docker/db/initdb/*.sql`, so `supabase/schema.sql` — including its policies — applies unchanged. Identity is a single re-pointed seam (`src/lib/supabase/server.ts`) plus a small `src/lib/auth/` module set; the 129 call sites that construct that client are not touched.

**Tech Stack:** Docker Compose, `postgres:17-alpine`, `postgrest/postgrest:v16.5`, `caddy:2-alpine`, Node 24 + `pg` (moving from devDependency to dependency), `pgcrypto` `crypt()` for bcrypt verification, HS256 tokens signed with `node:crypto`, Next.js 16.4 App Router (`proxy` replaces `middleware`).

**Spec:** [docs/superpowers/specs/2026-10-20-docker-self-host-migration-design.md](file:///D:/Nextjs%20Projects/sharm_dreams_group/docs/superpowers/specs/2026-10-20-docker-self-host-migration-design.md) — read it alongside this plan; §4–§6 and §9 are what Plan 1 implements.

---

## Global Constraints

- **Verification vocabulary.** This repo has **no test runner** — do not invent `vitest`/`jest`. Every "run the tests" step is: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`, then `./node_modules/.bin/eslint <changed paths>`, then `node scripts/check-staff-routes.mjs` when a route changed, then a live probe against the local stack. A task is not done until all four are green.
- **Never kill the owner's dev server on `localhost:3001`.** The migration dev server is **port 3000**. `docker compose` must never publish a host port that collides with 3001.
- **Every host port this stack publishes is bound to `127.0.0.1`.** `"127.0.0.1:${LOCAL_DB_PORT:-54320}:5432"`, `"127.0.0.1:${LOCAL_GATEWAY_PORT:-54321}:8080"` — an un-prefixed mapping binds `0.0.0.0` *and* `::`, and the credentials behind both ports are committed in `docker/.env.example`, so a LAN-reachable Postgres or REST API is a defect, not a convenience. Containers reach each other by service name on the compose network and need no published port; on KVM2 the public listener is Caddy's TLS front, and these mappings are dropped or loopback-bound there too.
- **No new auth/storage vendors.** No `better-auth`, no GoTrue, no MinIO, no Redis. Allowed new runtime deps in Plan 1: `pg` (already installed as a devDependency). Everything else is `node:crypto`.
- **PII.** A live `pg_dump` will be restored into the local `db`. Dump files live **only** under `docker/data/`, which must be git-ignored; the `db` data dir is a named Docker volume, never a bind-mount into the repo tree.
- **Candidate portal is off-limits.** Zero edits to `src/app/(candidate)/**`, `NoticeInbox`, or the `communication_logs` read/dismiss design. Verified in Task 18.
- **`supabase/schema.sql` is generated from live** by `node scripts/dump-schema.mjs`, which will happily revert hand edits. Every hand edit this plan makes to that file goes with an `AUTHORITATIVE:` marker line (Task 4 Step 3) so the next dumper run is told, in the file itself, that the tree is the source.
- **Naming stays `SUPABASE_*`** for the values PostgREST-shaped reads need (spec §11). Plan 1 adds `LOCAL_*`/`AUTH_*` names and leaves the old ones in place; renaming happens in Plan 2 when the last `@supabase/*` import is gone.
- Commit after every task. Message style: `feat(scope):`, `fix(scope):`, `test(scope):` — lower case, imperative, what changed and why.

---

## Corrections to the approved spec

Found while gathering evidence for this plan. Each is implemented as written here, **not** as written in the spec.

1. **`db-anon-role` must be `anon`, not `authenticated`** (spec §5). PostgREST uses `db-anon-role` for a request with **no** JWT. Supabase's own contract is that a tokenless request gets the least-privileged role, so `is_staff()` must be false. Setting it to `authenticated` would make every unauthenticated read carry the staff role — RLS would still answer, and answer wrongly.
2. **`auth.uid()` must read `request.jwt.claims ->> 'sub'`.** [scripts/local-supabase-stub.sql:22](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/local-supabase-stub.sql#L22) reads `request.jwt.claim.sub` (singular), which is a legacy Supabase GUC that modern PostgREST never sets. The stub proved the policies *parse*; it never proved they *evaluate*. Task 4 Step 1 replaces it.
3. **The storage count in spec §2 is wrong.** "5 `supabase.storage.from(bucket)` accessor lines" came from a single-line grep. Re-derived on 2026-10-20: **16 accessor call sites across 14 files**, using 5 methods (`createSignedUrl` ×5, `download` ×4, `remove` ×3, `upload` ×3, `list` ×1). `docs/STATUS-2026-10-20.md` §5 repeats the 5 and needs the same fix. Consequence: spec slice 4 cannot follow slice 3 — re-pointing the one seam breaks all 16 at once. Task 10 isolates them behind `src/lib/files/store.ts` first, so Plan 2 swaps one module.
4. **The `attempt_token` policies are dormant.** Spec §6 claims 5 policies reading `request.jwt.claims ->> 'attempt_token'` serve candidates. Nothing in the tree ever mints that claim, and [src/app/(candidate)/portal/actions.ts:95-135](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/%28candidate%29/portal/actions.ts#L95-L135) reads through `getSupabaseServiceClient()` (RLS bypassed), with anon only as a fallback. Plan 1 mints **no** attempt-token JWTs. The candidate portal needs zero edits — which is also why leaving it alone is safe.
5. **The 60 s `timeoutMemo` is correct as-is.** Spec §6 asks that it be reconsidered on a persistent process. It is a memo with its own expiry (`middleware.ts:34`), not a leak; a long-lived container is exactly where it starts working *better*. Leave it. Task 13 ports it verbatim.
6. **`@supabase/supabase-js` cannot be uninstalled in Plan 1.** [src/app/(candidate)/portal/actions.ts:35-43](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/%28candidate%29/portal/actions.ts#L35-L43) wraps `getSupabaseServiceClient()` in `try/catch` and falls back to a direct `createClient(supabaseConfig.url, supabaseConfig.anonKey)`. After Task 11 Step 7 the factory no longer throws on a missing key, so **that fallback is dead code** — but deleting it means editing the candidate portal, and the owner has ruled that surface off-limits ("leave candidate portal alone"). Plan 1 therefore leaves the package installed and that file untouched; Plan 2 asks permission to delete those four lines, and only then removes the dependency. Task 17's gate is "the only remaining importer is this one file", not "zero".

Three further facts worth the record: `supabaseRestCall` in `src/lib/supabase/rest.ts` has **zero callers** (delete it in Task 17); `pg` is currently a **devDependency** (Task 17 promotes it); and `scripts/create-staff.mjs:104` prints a sign-in URL on 3001 (Task 17).

---

## File structure

New — data plane, all under `docker/` so the whole stack is one directory:

| File | Responsibility |
| --- | --- |
| `docker/docker-compose.yml` | **The headline deliverable.** Services `db` (54320), `rest`, `gateway` (54321), `cron`. |
| `docker/.env.example` | Every value the stack needs, with the local defaults. Copied to `docker/.env` (git-ignored). |
| `docker/Caddyfile` | Strip `/rest/v1` → `rest:3000`; the same file becomes the KVM2 TLS front. |
| `docker/db/initdb/00-roles.sql` | `anon`, `authenticated`, `service_role`, `authenticator`. Runs before any grant parses. |
| `docker/db/initdb/01-extensions.sql` | `extensions` schema + `pgcrypto` + `uuid-ossp`, so `schema.sql`'s own `create extension if not exists` is a no-op. |
| `docker/db/initdb/02-auth-users.sql` | `auth` schema, `auth.users` (with `encrypted_password`), `auth.uid()`, `auth.jwt()`, `auth.role()`. |
| `docker/db/initdb/03-storage-shim.sql` | `storage` schema, `storage.buckets`, `storage.objects`, `storage.foldername()` — parsed now, replaced in Plan 2. |
| `docker/cron/Dockerfile` + `docker/cron/run.sh` | Loop that hits the two cron routes with the `x-cron-secret` header those routes already require. |
| `scripts/prove-local-stack.mjs` | The parity gate: same `uid`, same rows, through local PostgREST as through Supabase. |
| `src/lib/auth/token.ts` | HS256 mint + verify (`node:crypto` only). |
| `src/lib/auth/db.ts` | The `pg` pool and `withStaffPasswordCheck()`. |
| `src/lib/auth/passwords.ts` | `verifyStaffPassword()` via `pgcrypto crypt()`. |
| `src/lib/auth/cookies.ts` | Cookie contract: names, attributes, maxAge — both the Server Action shape and the proxy shape. |
| `src/lib/auth/guard.ts` | The proxy's session verify, role gate and idle timeout. |
| `src/app/login/actions.ts` | `signInAction` / `signOutAction`, and the brute-force floor. |
| `src/lib/files/store.ts` | The one module 16 storage call sites go through. |
| `src/lib/supabase/server.ts` | **Re-pointed, not renamed.** Still exports `createSupabaseServerClient()`. |

Modified: `supabase/schema.sql` (vault removal, `AUTHORITATIVE:` marker), `package.json` (`pg` promotion, `docker:*` and `db:apply-local` scripts), `.gitignore` (`docker/data/`), `src/lib/config.ts` (port 3000 default, `candidate-cvs` bucket), `src/proxy.ts`, `src/lib/auth/session.ts`, `src/app/login/LoginForm.tsx`, `src/modules/settings/application/user-actions.ts` (its 13 `auth.admin.*` sites keep their call shape but gain the shim's `Result` handling — Task 14), `scripts/create-staff.mjs`. Deleted: `src/lib/supabase/middleware.ts` (Task 13) and `src/lib/supabase/rest.ts`, `src/lib/supabase/client.ts` (Task 17).

**Out of scope for Plan 1** (Plan 2 owns it): the `files` table + `/data/uploads` volume, dropping `storage.objects` and `src/lib/supabase/vendor.ts`, removing `@supabase/*` and `@vercel/speed-insights`, and the KVM2 cut-over script.

---

## Slice A — the local Compose stack

### Task 1: `docker/docker-compose.yml` with Postgres 17 on host port 54320

**Files:**
- Create: `docker/docker-compose.yml`
- Create: `docker/.env.example`
- Create: `docker/data/.gitkeep` and `docker/db/initdb/.gitkeep`
- Create: `.gitattributes` (six `eol=lf` rules guarding the interpolated secret)
- Modify: `.gitignore` (append `docker/data/*` + its `.gitkeep` negation, `docker/.env` + the `docker/.env.example` negation)
- Modify: `package.json` (add the `docker:*` scripts)

**Interfaces:**
- Produces: a `db` service reachable from the host at `postgresql://postgres:${LOCAL_DB_PASSWORD}@localhost:54320/sharm_dreams` and from sibling containers at `db:5432` by service name, plus the `LOCAL_DB_PASSWORD` / `AUTH_JWT_SECRET` names every later task reads from `docker/.env`.

- [ ] **Step 1: Confirm the images before pinning them.** Never take a tag from memory.

```bash
docker manifest inspect postgres:17-alpine >/dev/null && echo "pg17 ok"
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint /bin/postgrest postgrest/postgrest --version
```

Record the exact PostgREST version string printed; use it as the tag in Task 2. Expected: `PostgREST 16.5`.

Two facts about the second command, both learned the hard way on this device. The `postgrest/postgrest` image declares **no Entrypoint** and its CMD is the bare `/bin/postgrest` binary, so `docker run --rm postgrest/postgrest --version` appends `--version` to a CMD that does not parse flags and prints nothing useful. And on Git Bash an argument beginning with `-` is handed to MSYS path conversion, which mangles it — hence `MSYS_NO_PATHCONV=1`. Verified live: the form above printed `PostgREST 16.5`, and `docker manifest inspect postgrest/postgrest:v16.5` succeeds.

- [ ] **Step 2: Create `docker/.env.example`.**

```ini
# Copy to docker/.env (git-ignored) and change nothing for local dev.
# These are LOCAL DEV values. On KVM2 every one of these is replaced from a
# secrets file that never enters the repo.

# Postgres superuser password for the local cluster.
LOCAL_DB_PASSWORD=sdg_local_dev_pw

# Password for the PostgREST login role. Must match docker/db/initdb/00-roles.sql.
LOCAL_PGRST_PASSWORD=sdg_pgrst_local

# HS256 secret for tokens the app mints. PostgREST and src/lib/auth/token.ts
# read the same value, so they can never disagree about who is signed in.
AUTH_JWT_SECRET=replace-with-48-random-chars-local-only

# Host ports. 54320/54321 are chosen so nothing collides with the owner's dev
# server on 3001 or a locally-installed Postgres on 5432.
LOCAL_DB_PORT=54320
LOCAL_GATEWAY_PORT=54321
```

- [ ] **Step 3: Generate a real secret and write `docker/.env`.**

```bash
cd docker && cp .env.example .env && node -e "
const c=require('crypto'), f=require('fs');
const s=c.randomBytes(36).toString('base64url');
let t=f.readFileSync('.env','utf8');
t=t.replace(/^AUTH_JWT_SECRET=.*$/m,'AUTH_JWT_SECRET='+s);
f.writeFileSync('.env',t);
console.log('AUTH_JWT_SECRET set, length', s.length);
"
```

Expected: `AUTH_JWT_SECRET set, length 48`. Never print the value itself.

- [ ] **Step 4: Write `docker/docker-compose.yml`.** Only `db` in this task; `rest` and `gateway` arrive in Task 2, `cron` in Task 16.

```yaml
# Sharm Dreams Talent Cloud — self-hosted data plane.
#
# The app runs OUTSIDE this file (`next dev` on host port 3000); see
# docs/superpowers/specs/2026-10-20-docker-self-host-migration-design.md §4.
# On KVM2 this same file becomes the production stack.
name: sharm-dreams-local

services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    shm_size: 128mb
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${LOCAL_DB_PASSWORD}
      POSTGRES_DB: sharm_dreams
      PGDATA: /var/lib/postgresql/data/pgdata
    # PG17 is forced by supabase/schema.sql: every grant it carries uses the
    # `maintain` privilege, which does not exist before PG17.
    command:
      - postgres
      - -c
      - shared_preload_libraries=pg_stat_statements
      - -c
      - pg_stat_statements.track=top
    # Loopback only: `rest` reaches `db` by service name on the compose network,
    # so the published port exists solely for host-side probes — and the
    # superuser password it guards is committed in docker/.env.example.
    ports:
      - "127.0.0.1:${LOCAL_DB_PORT:-54320}:5432"
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./db/initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d sharm_dreams"]
      interval: 5s
      timeout: 3s
      retries: 30

volumes:
  # A named volume, NOT a bind-mount into the repo: a restored live dump lives in
  # here and must never be picked up by `git add .` (spec §10).
  db-data:
```

- [ ] **Step 5: Create the ignored PII directory, the initdb stub, and the line-ending guard.**

```bash
mkdir -p docker/db/initdb docker/data
: > docker/data/.gitkeep
: > docker/db/initdb/.gitkeep
```

Append to `.gitignore`:

```
# Local self-host stack: PII dumps and real secrets never enter the repo.
docker/data/*
!docker/data/.gitkeep
docker/.env
!docker/.env.example
```

**Do not write `docker/data/` here.** A rule with a trailing slash excludes the directory itself, and git never re-descends an excluded directory — so the `!docker/data/.gitkeep` re-inclusion is inert and Step 9's `git add docker/data/.gitkeep` fails with "The following paths are ignored by one of your .gitignore files". Reproduced in a throwaway repo; `docker/data/*` excludes the *contents* instead, which git can re-include one file at a time. Likewise the final negation is required, not decorative: this repo's pre-existing line 38 is an **unanchored** `.env*`, and `git check-ignore -v` confirms it matches `docker/.env.example` as well as `docker/.env`.

Then create `.gitattributes` at the repo root — six targeted rules, nothing else:

```
# docker/.env is generated by copying docker/.env.example and interpolating
# AUTH_JWT_SECRET into it. core.autocrlf is active on Windows and this repo had
# no attribute file, so a CRLF checkout appends \r to the interpolated secret —
# and PostgREST plus src/lib/auth/token.ts silently disagree about who is signed
# in. LF is the only safe line ending for anything the stack reads byte-exact.
docker/.env.example text eol=lf
docker/*.yml text eol=lf
docker/**/*.yml text eol=lf
docker/Caddyfile text eol=lf
docker/db/initdb/*.sql text eol=lf
docker/cron/*.sh text eol=lf
```

`docker/Caddyfile`, `docker/db/initdb/*.sql` and `docker/cron/*.sh` do not exist yet — Tasks 2, 3 and 16 create them, and a rule for a path that is not there is inert, not stale. Say that in one comment line. **Never add `* text=auto`**: it would renormalise every file in the repo and rewrite every future diff, which is not this plan's business. `docker/.env` itself can never be covered (it is ignored), so its LF-ness depends on the template being LF at `cp` time plus a byte-preserving rewrite — which is why Step 3 reads it, and why hand-editing it in a CRLF editor reintroduces the hazard.

- [ ] **Step 6: Add the npm scripts** to `package.json`, immediately after `"dev"`:

```json
    "docker:up": "docker compose -f docker/docker-compose.yml --env-file docker/.env up -d",
    "docker:down": "docker compose -f docker/docker-compose.yml --env-file docker/.env down",
    "docker:wipe": "docker compose -f docker/docker-compose.yml --env-file docker/.env down -v",
    "docker:logs": "docker compose -f docker/docker-compose.yml --env-file docker/.env logs -f",
    "docker:psql": "docker compose -f docker/docker-compose.yml --env-file docker/.env exec db psql -U postgres -d sharm_dreams",
```

- [ ] **Step 7: Boot it and prove the port and version.**

```bash
npm run docker:up
docker compose -f docker/docker-compose.yml --env-file docker/.env ps
node -e "
const fs=require('fs'), {Client}=require('pg');
const pw=fs.readFileSync('docker/.env','utf8').match(/^LOCAL_DB_PASSWORD=(.+?)\r?$/m)[1];
const c=new Client({connectionString:'postgresql://postgres:'+pw+'@localhost:54320/sharm_dreams'});
c.connect().then(()=>c.query(\"select current_setting('server_version')\"))
 .then(r=>{console.log('PG', r.rows[0].current_setting); return c.end();})
 .catch(e=>{console.error('FAIL', e.message); process.exit(1);});
"
```

Expected: `db` reported `running (healthy)` — Compose v5 words it `Up (healthy)` — with `PORTS` exactly `127.0.0.1:54320->5432/tcp`, then `PG 17.x`. `pg` is already installed (as a devDependency) — install nothing. Read the password with `/^(?:export\s+)?LOCAL_DB_PASSWORD=(.+?)\r?$/m`: the optional `\r` is the whole point of the guard written in Step 5, and a probe that silently carries a trailing CR into the connection string reports "password authentication failed" instead of "your line endings are wrong".

- [ ] **Step 8: Confirm nothing leaked into git.**

```bash
git status --short
git check-ignore -v docker/.env docker/data/anything
```

Expected: status lists `docker/docker-compose.yml`, `docker/.env.example`, `docker/data/.gitkeep`, `docker/db/initdb/.gitkeep`, `.gitignore`, `.gitattributes`, `package.json` — **not** `docker/.env`. `check-ignore` prints a matching rule for both paths. Then confirm the guard resolved: `git check-attr text eol -- docker/.env.example docker/docker-compose.yml` prints `text: set / eol: lf` for both, while `git check-attr text eol -- src/app/page.tsx` still prints `unspecified` — proof the six rules are targeted and no repo-wide renormalisation crept in.

- [ ] **Step 9: Commit.**

```bash
git add docker/docker-compose.yml docker/.env.example docker/data/.gitkeep docker/db/initdb/.gitkeep .gitignore .gitattributes package.json
git commit -m "feat(docker): stand up the local Postgres 17 dev database on 54320"
```

---

### Task 2: PostgREST behind a Caddy gateway on host port 54321

**Files:**
- Modify: `docker/docker-compose.yml` (add `rest` and `gateway`)
- Create: `docker/Caddyfile`

**Interfaces:**
- Consumes: `db` healthy, `LOCAL_PGRST_PASSWORD`, `AUTH_JWT_SECRET`, `LOCAL_GATEWAY_PORT`.
- Produces: `http://localhost:54321/rest/v1/<table>` — so in Task 11 the app's `SUPABASE_URL` is the gateway **base** `http://localhost:54321`, because `supabase-js` appends `/rest/v1` itself.

- [ ] **Step 1: Write `docker/Caddyfile`.** PostgREST has no path-prefix option, so the strip lives here — and this same file becomes the KVM2 TLS front.

```
# Local gateway. On KVM2 the site address gains a real hostname and Caddy's
# automatic TLS; the routing below does not change.
:8080 {
	encode gzip

	# handle_path strips the matched prefix, so /rest/v1/users arrives at
	# PostgREST as /users — which is what a Supabase-shaped base URL implies.
	handle_path /rest/v1/* {
		reverse_proxy rest:3000
	}

	respond /healthz "ok" 200

	handle {
		respond "sharm-dreams gateway - REST API is under /rest/v1/" 404
	}
}
```

- [ ] **Step 2: Add the two services** to `docker/docker-compose.yml`, after `db` (same indentation level):

```yaml
  rest:
    image: postgrest/postgrest:v16.5   # the tag confirmed in Task 1 Step 1; do not take a tag from memory
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGRST_DB_URI: postgres://authenticator:${LOCAL_PGRST_PASSWORD}@db:5432/sharm_dreams
      PGRST_DB_SCHEMAS: public
      # Correction #1 vs spec §5: a tokenless request must get the LEAST
      # privileged role, so is_staff() is false without a JWT.
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: ${AUTH_JWT_SECRET}
      PGRST_JWT_AUD: sdg_local
      PGRST_SERVER_PORT: 3000
      # No `pgrst` schema config here; PostgREST reads env only.
      PGRST_DB_CONFIG: false
      PGRST_OPENAPI_SERVER_PROXY_URL: http://localhost:54321/rest/v1
    # Deliberately no `ports:` - nothing may bypass the gateway.

  gateway:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - rest
    command: ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile_adapt"]
    ports:
      # Loopback, like `db`: this port fronts a REST API whose only credential is
      # a repo-known dev password, and on KVM2 the public front is Caddy's TLS
      # listener on 80/443, never this host mapping.
      - "127.0.0.1:${LOCAL_GATEWAY_PORT:-54321}:8080"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
```

- [ ] **Step 3: Validate both files before starting anything.**

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env config >/dev/null && echo "compose ok"
docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile_adapt
```

Expected: `compose ok`, then a "is valid" / successful `Validation Result`.

- [ ] **Step 4: Restart and prove the `/rest/v1` strip.**

```bash
npm run docker:up
curl -s -o /dev/null -w "healthz %{http_code}\n" http://localhost:54321/healthz
curl -s -o /dev/null -w "openapi %{http_code}\n" http://localhost:54321/rest/v1/
curl -s -o /dev/null -w "bogus   %{http_code}\n" http://localhost:54321/nope
```

Expected: `healthz 200`, `openapi 200`, `bogus 404`. If `openapi` is `401`/`403` the JWT secret is fine but the connection failed — a `503`/`404` with an empty body means `rest` cannot log in (wrong `LOCAL_PGRST_PASSWORD`, or `authenticator` does not exist yet, which is expected until Task 3). Read `npm run docker:logs` for the `rest` service and report the PostgREST error verbatim rather than guessing.

- [ ] **Step 5: Commit.**

```bash
git add docker/docker-compose.yml docker/Caddyfile
git commit -m "feat(docker): serve the REST reads through PostgREST behind a loopback gateway"
```

---

### Task 3: The identity stand-ins Postgres needs before any grant parses

**Files:**
- Create: `docker/db/initdb/00-roles.sql`
- Create: `docker/db/initdb/01-extensions.sql`

**Interfaces:**
- Produces: cluster roles `anon`, `authenticated`, `service_role`, `authenticator`; the `extensions` schema holding `pgcrypto` and `uuid-ossp`. Every later SQL file and `supabase/schema.sql` grant to these names.
- Consumes: nothing. Runs once, on an empty volume, in alphabetical order.

- [ ] **Step 1: Write `docker/db/initdb/00-roles.sql`.**

```sql
-- The four roles Supabase creates for every project, and the login role
-- PostgREST connects as before switching into one of them.
--
-- Roles live in the cluster, not the database, so these DO blocks exist because
-- `create role` has no IF NOT EXISTS and a developer who wipes only the database
-- (not the volume) would otherwise get a hard failure here.
--
-- `service_role` gets BYPASSRLS because the app's service client is meant to
-- reach every row; that is what src/lib/supabase/service.ts assumes today.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- The login role. This password must equal LOCAL_PGRST_PASSWORD in docker/.env.
-- It is a local dev credential by design; KVM2 replaces the whole file from a
-- secret that never enters the repo.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit login password 'sdg_pgrst_local';
  else
    alter role authenticator with login password 'sdg_pgrst_local';
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;

-- supabase/schema.sql grants object-level privileges to these roles, so they
-- must be able to hold the schemas it creates.
grant usage on schema public to anon, authenticated, service_role;
```

- [ ] **Step 2: Write `docker/db/initdb/01-extensions.sql`.**

```sql
-- supabase/schema.sql line 27-32 creates these itself with `if not exists`, so
-- this file only has to make sure the schema exists and the roles can reach it.
-- It does NOT create supabase_vault: nothing in src/ uses Vault (spec §12), and
-- a vanilla image cannot.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
```

- [ ] **Step 3: Re-create the volume so initdb actually runs, and prove the roles exist.**

```bash
npm run docker:wipe
node -e "
const fs=require('fs'), {Client}=require('pg');
const pw=fs.readFileSync('docker/.env','utf8').match(/^LOCAL_DB_PASSWORD=(.+?)\r?$/m)[1];
const c=new Client({connectionString:'postgresql://postgres:'+pw+'@localhost:54320/sharm_dreams'});
c.connect().then(()=>c.query(
  \"select r.rolname, r.rolbypassrls, r.rolcanlogin from pg_roles r \" +
  \"where r.rolname in ('anon','authenticated','service_role','authenticator') order by 1\"
)).then(r=>{console.table(r.rows); return c.query(
  \"select extname from pg_extension where extname in ('pgcrypto','uuid-ossp') order by 1\")
}).then(r=>{console.log(r.rows.map(x=>x.extname).join(', ')); return c.end()})
 .catch(e=>{console.error('FAIL', e.message); process.exit(1)});
"
```

Expected: four rows, `service_role` with `rolbypassrls: true`, `authenticator` with `rolcanlogin: true`, and `pgcrypto, uuid-ossp`. If the roles are missing, initdb did not run — the volume was not actually wiped.

- [ ] **Step 4: Prove PostgREST can switch into `anon` and answer without a token.**

```bash
curl -s -H "Accept: application/json" \
  "http://localhost:54321/rest/v1/pg_roles?select=rolname&id=eq.nonexistent" -w "\n%{http_code}\n"
```

Expected: `[]` and `200`. A `401` here means `PGRST_DB_ANON_ROLE` is wrong or `authenticator` is not a member of `anon`. Note this proves the *switch* works; it does not yet prove RLS, because `public` has no tables.

- [ ] **Step 5: Commit.**

```bash
git add docker/db/initdb/00-roles.sql docker/db/initdb/01-extensions.sql
git commit -m "feat(docker): create the Supabase roles and extensions the schema of record grants to"
```

---

### Task 4: `auth` and `storage` stand-ins, then apply the schema of record

**Files:**
- Create: `docker/db/initdb/02-auth-users.sql`
- Create: `docker/db/initdb/03-storage-shim.sql`
- Create: `scripts/apply-local-schema.mjs`
- Modify: `supabase/schema.sql` (delete the two `vault` lines, add the `AUTHORITATIVE:` marker)
- Modify: `package.json` (add `db:apply-local`)

**Interfaces:**
- Produces: `auth.users` (with `encrypted_password`), `auth.uid()`, `auth.jwt()`, `auth.role()`, `storage.buckets`, `storage.objects`, `storage.foldername(text)`; a local database holding the 41 tables and 94 policies; `npm run db:apply-local`.
- Consumes: Task 3 roles. Task 9's `passwords.ts` reads `auth.users.encrypted_password`; Task 7's parity gate reads the policies.

- [ ] **Step 1: Write `docker/db/initdb/02-auth-users.sql`.** The two `auth` helpers are the whole reason this migration is a re-point, so read the comments before changing anything.

```sql
-- Everything Supabase hosts in the `auth` schema that our own policies touch.
-- 80 of the 94 policies reach identity through auth.uid() indirectly, via
-- is_staff() (66), has_permission() (41), is_super_admin() (12),
-- current_user_profile_id() (12) and user_tenant_id() (11).

create schema if not exists auth;

-- The migrated directory. Plan 2 keeps this table and writes it directly;
-- spec §5 requires encrypted_password to survive the dump restore, and PG17
-- pgcrypto compares bcrypt ($2a$) hashes, so no Node dependency is needed.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text not null default 'authenticated',
  role text not null default 'authenticated',
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Correction #2 vs the old stub: modern PostgREST sets only the JSON
-- `request.jwt.claims` GUC. The stub's `request.jwt.claim.sub` (singular) never
-- exists, which is why the proof passed without ever proving evaluation.
-- The `::uuid` cast is inside nullif-safe SQL so a malformed claim cannot abort
-- a policy; a bad claim must fail closed, i.e. return no rows, not 500.
create or replace function auth.uid() returns uuid
language sql stable as
$$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' $$;

create or replace function auth.jwt() returns jsonb
language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create or replace function auth.role() returns text
language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                    current_setting('role', true)) $$;

grant usage on schema auth to anon, authenticated, service_role;
grant select, insert, update, delete on auth.users to service_role;
grant execute on function auth.uid(), auth.jwt(), auth.role()
  to anon, authenticated, service_role;
```

- [ ] **Step 2: Write `docker/db/initdb/03-storage-shim.sql`.** This exists only so the 8 `storage.objects` policies in `schema.sql` parse. Plan 2 deletes it along with `storage.objects`.

```sql
-- Stand-in for Supabase Storage, so supabase/schema.sql's eight storage.objects
-- policies and its four bucket inserts apply unchanged. Replaceable by design:
-- Plan 2 swaps this for a `files` table over a /data/uploads volume (spec §7).

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  owner uuid,
  name text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as
$$ select string_to_array(name, '/') $$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
```

- [ ] **Step 3: Make `supabase/schema.sql` applyable on a vanilla image.** Two lines go, and a marker goes in. Read the note below before touching anything else in the file.

Delete lines 30–31 (`create schema if not exists vault;` and `create extension if not exists "supabase_vault" with schema extensions;`) — nothing in `src/` uses Vault (spec §12), and the `create extension` is a hard error on `postgres:17-alpine`, which is why [scripts/apply-proof-schema.mjs:29](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/apply-proof-schema.mjs#L29) had to regex it out.

```bash
grep -n 'vault' supabase/schema.sql
```

Expected before the edit: lines 30 and 31 (plus the header comment at line 19 does not mention vault, so it stays). After the edit: no matches.

Add the marker as the second line of the file's opening comment block, directly after ` * Sharm Dreams Talent Cloud — schema of record.`:

```
 * AUTHORITATIVE: this file carries hand edits that `node scripts/dump-schema.mjs`
 * does not reproduce (the vault removal, the locked-down jobs/applicants
 * policies). A re-dump must re-apply them, not silently restore them.
```

**Note on the realtime lines.** Spec §5 also asks that the two `alter publication supabase_realtime …` DO-blocks be deleted. Leave them: each is wrapped in `exception when undefined_object then null`, so with no publication present they are proven no-ops (the throwaway proof in §13 ran with them in place), and deleting them creates drift that the next `dump-schema.mjs` re-creates from live. One unavoidable hand edit is worth a marker; two optional ones is not.

- [ ] **Step 4: Write `scripts/apply-local-schema.mjs`.** `apply-schema.mjs` cannot be reused as-is: it reads `.env.local` unconditionally and aims at the vendor pooler unless `ZZ_DB_URL` is set. This wrapper is the local path, and it refuses to run if the vault line came back.

```js
/*
 * Applies supabase/schema.sql to the LOCAL self-hosted stack, then reports the
 * object counts. Replaces `ZZ_DB_URL=… node scripts/apply-schema.mjs` for local
 * work so nobody has to remember the escape hatch — or read the password.
 *
 *   npm run docker:up && node scripts/apply-local-schema.mjs
 *
 * Reads docker/.env, never .env.local, and never connects to the vendor.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(file) {
  const out = {};
  for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const local = env(join("docker", ".env"));
if (!local.LOCAL_DB_PASSWORD) {
  console.error("docker/.env is missing LOCAL_DB_PASSWORD. See docker/.env.example.");
  process.exit(1);
}

const url = `postgresql://postgres:${local.LOCAL_DB_PASSWORD}@localhost:${local.LOCAL_DB_PORT || 54320}/sharm_dreams`;
const sql = readFileSync(join(root, "supabase", "schema.sql"), "utf8");

const c = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
await c.connect();
if (/create extension if not exists "supabase_vault"/.test(sql)) {
  await c.end();
  console.error(
    "supabase/schema.sql still creates supabase_vault, which a vanilla image\n" +
    "cannot do. That statement is a hand-removal — see this task's Step 3.\n" +
    "If a re-dump restored it, re-delete it and update the AUTHORITATIVE marker."
  );
  process.exit(1);
}

console.log("applying supabase/schema.sql to the local stack as one atomic script…");
await c.query(sql);

const counts = await c.query(`
  select
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p')) as tables,
    (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','storage')) as policies,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public') as functions,
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal) as triggers,
    (select count(*) from storage.buckets) as buckets`);
console.log("local stack now holds:", counts.rows[0]);
await c.end();

// PostgREST caches its schema description; without this the next read answers
// 404 "relation not found" even though the table is plainly there.
execFileSync("docker", [
  "compose", "-f", join(root, "docker", "docker-compose.yml"),
  "--env-file", join(root, "docker", ".env"), "restart", "rest",
], { stdio: "inherit" });
console.log("restarted PostgREST so it re-reads the schema");
```

- [ ] **Step 5: Re-create the stack and apply.**

```bash
npm run docker:wipe && npm run docker:up
node scripts/apply-local-schema.mjs
```

Expected: `local stack now holds: { tables: 41, policies: 94, functions: 15, triggers: 15, buckets: 4 }` — the same figures §13 of the spec recorded for the throwaway proof. Any lower number means a statement was silently skipped; stop and find it.

- [ ] **Step 6: Prove idempotence, because the cut-over re-applies this on top of a restored dump.**

```bash
node scripts/apply-local-schema.mjs
```

Expected: the identical counts a second time, no error.

- [ ] **Step 7: Add the npm script** after `docker:psql` in `package.json`:

```json
    "db:apply-local": "node scripts/apply-local-schema.mjs",
```

- [ ] **Step 8: Commit.**

```bash
git add supabase/schema.sql docker/db/initdb/02-auth-users.sql docker/db/initdb/03-storage-shim.sql scripts/apply-local-schema.mjs package.json
git commit -m "feat(docker): stand in auth and storage so the schema of record applies on Postgres 17"
```

---

## Slice B — prove the foundation before any code depends on it

Nothing in Slice C is worth writing until this slice says the same `uid` gets the same rows. Slice B is also the only slice that can be done without touching `src/`.

### Task 5: Lock down the two tables no code reads

**Files:**
- Create: `supabase/migrations/030_lock_down_legacy_tables.sql`
- Modify: `supabase/schema.sql:1335-1347` (the three `applicants` policies), `1591-1603` (the three `jobs` policies), `1915-1916` and `2039-2040` (the `anon`/`authenticated` grants)

**Interfaces:**
- Produces: `public.jobs` and `public.applicants` reachable only by `service_role`. Consumed by Task 7's gate, which asserts a staff token sees zero rows there.
- Consumes: the applied schema from Task 4.

Why this task exists: both tables carry `using (true)` policies and `grant … to anon`, and `src/` reads **`job_openings`**, never `jobs` or `applicants` (re-derived by `grep -rn 'from("jobs")\|from("applicants")' src/` → zero hits, against 24 `job_openings` call sites). This is the one place where "RLS on 41/41" does not mean "RLS protecting 41/41" — spec §5. Doing it while the schema is being re-founded is free; doing it after cut-over is an incident.

- [ ] **Step 1: Write the migration.** Note the gap in `supabase/migrations/`: files run 001–025 then 027–029, so **030** is the next number — not 026, and never a number a previous session guessed.

```sql
-- 030_lock_down_legacy_tables.sql
-- `jobs` and `applicants` are the original tables from migration 001; the portal
-- has read `job_openings` and the application/`user_profiles` chain for a long
-- time now. Both were left with `using (true)` policies and full grants to anon,
-- so an unauthenticated request could read and write them through the REST API.
-- Nothing in src/ touches either name. Lock them to service_role rather than
-- dropping them: a drop is irreversible and the rows may still be interesting.

drop policy if exists "Allow authenticated insert applicants" on public.applicants;
drop policy if exists "Allow authenticated update applicants" on public.applicants;
drop policy if exists "Allow public read applicants" on public.applicants;
drop policy if exists "Allow authenticated insert jobs" on public.jobs;
drop policy if exists "Allow authenticated update jobs" on public.jobs;
drop policy if exists "Allow public read jobs" on public.jobs;

revoke all on table public.applicants from anon, authenticated;
revoke all on table public.jobs from anon, authenticated;
```

- [ ] **Step 2: Mirror it into the schema of record**, because the local stack builds from `supabase/schema.sql` and the cut-over re-applies that file. Delete these six statements (each `drop policy if exists` line plus its `create policy` block):

```
1333 drop policy if exists "Allow authenticated insert applicants" …   through 1338
1339 drop policy if exists "Allow authenticated update applicants" …   through 1342
1344 drop policy if exists "Allow public read applicants" …            through 1347
1590 drop policy if exists "Allow authenticated insert jobs" …         through 1595
1595 drop policy if exists "Allow authenticated update jobs" …         through 1598
1600 drop policy if exists "Allow public read jobs" …                  through 1603
```

Confirm each line number before deleting — re-derive with `grep -n 'Allow public read jobs\|Allow authenticated insert applicants' supabase/schema.sql` rather than trusting this list, which was true at HEAD `640e5ef`.

Then delete the four grant lines and leave the `service_role` grants next to them intact:

```bash
grep -n 'on table public.applicants to anon;\|on table public.applicants to authenticated;\|on table public.jobs to anon;\|on table public.jobs to authenticated;' supabase/schema.sql
```

Expected: exactly four matches (1915, 1916, 2039, 2040 before this task's edits). Delete those four lines only.

- [ ] **Step 3: Re-apply and count what went away.**

```bash
node scripts/apply-local-schema.mjs
node -e "
const fs=require('fs'), {Client}=require('pg');
const pw=fs.readFileSync('docker/.env','utf8').match(/^LOCAL_DB_PASSWORD=(.+?)\r?$/m)[1];
const c=new Client({connectionString:'postgresql://postgres:'+pw+'@localhost:54320/sharm_dreams'});
c.connect().then(()=>c.query(
  \"select schemaname||'.'||tablename t, count(*) policies from pg_policies \" +
  \"where tablename in ('jobs','applicants') group by 1 order by 1\"
)).then(r=>{console.table(r.rows); return c.query(
  \"select grantee, table_name from information_schema.role_table_grants \" +
  \"where table_schema='public' and table_name in ('jobs','applicants') and grantee in ('anon','authenticated')\")
}).then(r=>{console.log('anon/authenticated grants left:', r.rows.length); return c.end()})
 .catch(e=>{console.error('FAIL', e.message); process.exit(1)});
"
```

Expected: the two rows report `policies: 0`, and `anon/authenticated grants left: 0`. The reported total policy count from the apply script must now be **88**, not 94 — write 88 into the spec's §5 figure when you commit, because 94 is what the pre-lock-down tree held.

- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations/030_lock_down_legacy_tables.sql supabase/schema.sql
git commit -m "fix(rls): lock the unreferenced jobs and applicants tables to service_role"
```

---

### Task 6: A local staff directory with real bcrypt hashes

**Files:**
- Create: `scripts/seed-local-staff.mjs`
- Modify: `docker/.env.example` (add `LOCAL_STAFF_PASSWORD`)

**Interfaces:**
- Produces: three `auth.users` rows with `crypt()`-hashed passwords and matching `user_profiles` rows (`SUPER_ADMIN`, `RECRUITER`, `CANDIDATE`), a fixed `tenant_id`, and `role_permissions` for the two staff roles. Task 7's gate signs in as the SUPER_ADMIN; Task 9's `passwords.ts` verifies against exactly these hashes.
- Consumes: Task 4's `auth.users`, Task 5's locked-down tables.

- [ ] **Step 1: Add the local fixture password name** to `docker/.env.example` and `docker/.env`:

```ini
# Local-only password for the seeded staff fixtures. Never reuse anywhere real.
LOCAL_STAFF_PASSWORD=sdg-local-fixture-pw
```

- [ ] **Step 2: Write `scripts/seed-local-staff.mjs`.**

```js
/*
 * Seeds a tiny staff directory into the LOCAL self-hosted stack so identity can
 * be proved without a live dump. Never point this at the vendor: it writes
 * auth.users rows directly, which is exactly what GoTrue used to do for us.
 *
 *   node scripts/seed-local-staff.mjs
 *
 * Passwords go in as pgcrypto bcrypt, i.e. `crypt(pw, gen_salt('bf', 10))`, so
 * they are byte-compatible with the hashes a restored live dump carries and
 * Task 9 can verify both the same way. The password is read from docker/.env and
 * is never printed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(file) {
  const out = {};
  for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const local = env(join("docker", ".env"));
if (!local.LOCAL_DB_PASSWORD || !local.LOCAL_STAFF_PASSWORD) {
  console.error("docker/.env needs LOCAL_DB_PASSWORD and LOCAL_STAFF_PASSWORD.");
  process.exit(1);
}

const STAFF = [
  { email: "owner.local@sharmdreams.test", name: "Local Owner", role: "SUPER_ADMIN" },
  { email: "recruiter.local@sharmdreams.test", name: "Local Recruiter", role: "RECRUITER" },
  { email: "candidate.local@sharmdreams.test", name: "Local Candidate", role: "CANDIDATE" },
];

const c = new Client({
  connectionString: `postgresql://postgres:${local.LOCAL_DB_PASSWORD}@localhost:${local.LOCAL_DB_PORT || 54320}/sharm_dreams`,
  connectionTimeoutMillis: 15000,
});
await c.connect();

const tenant = await c.query(
  "select id from public.tenants_and_companies where is_group_profile = true limit 1"
);
if (!tenant.rowCount) throw new Error("no group tenant — did schema.sql apply its seed rows?");
const tenantId = tenant.rows[0].id;

for (const s of STAFF) {
  const { rows } = await c.query(
    `with up as (
       insert into auth.users (email, role, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
       values ($1, 'authenticated', crypt($2, gen_salt('bf', 10)), now(),
               jsonb_build_object('provider','email','providers',array['email'],
                                  'tenant_id', $3::uuid),
               jsonb_build_object('full_name', $4))
       on conflict (email) do update
         set encrypted_password = excluded.encrypted_password
       returning id
     )
     insert into public.user_profiles (auth_user_id, tenant_id, full_name, email, role, locale)
     select id, $3::uuid, $4, $1, $5::user_role, 'en' from up
     on conflict (auth_user_id) do update
       set role = excluded.role, full_name = excluded.full_name, email = excluded.email
     returning auth_user_id, role`,
    [s.email, local.LOCAL_STAFF_PASSWORD, tenantId, s.name, s.role]
  );
  console.log(`seeded ${s.role} profile for ${s.email}`);
  if (!rows.length) throw new Error(`profile not written for ${s.email}`);
}

await c.end();
```

- [ ] **Step 3: Prove the hashes are bcrypt-shaped and verifiable by pgcrypto.**

```bash
node scripts/seed-local-staff.mjs
node -e "
const fs=require('fs'), {Client}=require('pg');
const e=Object.fromEntries(fs.readFileSync('docker/.env','utf8').split(/\r?\n/)
  .map(l=>l.match(/^([A-Z0-9_]+)=(.*)$/)?[l.split('=')[0],l.slice(l.indexOf('=')+1).trim()]:null).filter(Boolean));
const c=new Client({connectionString:'postgresql://postgres:'+e.LOCAL_DB_PASSWORD+'@localhost:54320/sharm_dreams'});
c.connect().then(()=>c.query(
  \"select email, left(encrypted_password,7) prefix, \" +
  \"crypt('sdg-local-fixture-pw', encrypted_password)=encrypted_password as good, \" +
  \"crypt('wrong-pw', encrypted_password)=encrypted_password as wrong_passes \" +
  \"from auth.users order by email\"
)).then(r=>{console.table(r.rows); return c.end()})
 .catch(er=>{console.error('FAIL', er.message); process.exit(1)});
"
```

Expected: three rows, `prefix` = `$2a$10$`, `good: true`, `wrong_passes: false`. The `prefix` is the whole point — Supabase stores `$2a$` hashes, so a restored dump will verify through the identical path.

If `user_profiles` has no unique constraint on `auth_user_id`, the `on conflict` clause errors — read the constraint off the applied database (`psql \d public.user_profiles`) and match it; do not invent one. This is why the script must run against the real local stack rather than a mocked schema.

- [ ] **Step 4: Commit.**

```bash
git add scripts/seed-local-staff.mjs docker/.env.example
git commit -m "test(docker): seed a local staff directory with pgcrypto bcrypt hashes"
```

---

### Task 7: The parity gate — `scripts/prove-local-stack.mjs`

**Files:**
- Create: `scripts/prove-local-stack.mjs`
- Modify: `package.json` (add `stack:prove`)

**Interfaces:**
- Produces: a pass/fail gate any later task re-runs; `mintToken(claims)` reused conceptually by Task 8's `token.ts` (this script signs inline with `node:crypto` so it can prove PostgREST before any app code exists).
- Consumes: Task 2's gateway, Task 4's stand-ins, Task 6's seeded staff row.

- [ ] **Step 1: Write the gate.** Read the three assertions in the `CHECKS` list before changing anything — assertion 3 is the one that makes the other two worth running.

```js
/*
 * Proves the self-hosted stack enforces the ported policies the same way the
 * vendor did, for the same uid. Run it after every slice.
 *
 *   npm run stack:prove
 *
 * It talks to the gateway over HTTP, exactly like the app will, and computes the
 * expected answer in SQL on the same connection PostgREST uses — so a disagreement
 * is a real behavioural difference, not a difference in transport.
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(join(root, "docker", ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const SECRET = env.AUTH_JWT_SECRET;
const BASE = `http://localhost:${env.LOCAL_GATEWAY_PORT || 54321}/rest/v1`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function mintToken(claims) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    aud: "sdg_local",
    iss: "sharm-dreams-local",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
    ...claims,
  });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

async function rest(token, qs) {
  const res = await fetch(`${BASE}/${qs}`, {
    headers: {
      Accept: "application/json",
      Prefer: "count=exact",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const range = res.headers.get("content-range");
  const json = res.status >= 400 ? await res.text() : await res.json();
  return { status: res.status, json, range };
}

const staff = await (async () => {
  const c = new Client({
    connectionString: `postgresql://postgres:${env.LOCAL_DB_PASSWORD}@localhost:${env.LOCAL_DB_PORT || 54320}/sharm_dreams`,
  });
  await c.connect();
  const r = await c.query(
    "select id from public.user_profiles where role = 'SUPER_ADMIN' and email = 'owner.local@sharmdreams.test' limit 1"
  );
  await c.end();
  if (!r.rowCount) throw new Error("run scripts/seed-local-staff.mjs first");
  return r.rows[0].id;
})();

const staffToken = mintToken({ sub: staff, role: "authenticated" });
const anonToken = mintToken({ sub: "00000000-0000-0000-0000-000000000000", role: "anon" });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

// 1. No token at all: the anon role must be refused every staff table's rows.
const anonProfiles = await rest(null, "user_profiles?select=id");
check("tokenless read of user_profiles is allowed by the API but returns no rows",
  anonProfiles.status === 200 && Array.isArray(anonProfiles.json) && anonProfiles.json.length === 0,
  `status ${anonProfiles.status}, ${JSON.stringify(anonProfiles.json).slice(0, 120)}`);

// 2. A staff token must see its own profile — the auth.uid() path end to end.
const mine = await rest(staffToken, `user_profiles?select=id,role&auth_user_id=eq.${staff}`);
check("auth.uid() reaches the row: staff sees its own profile",
  mine.status === 200 && Array.isArray(mine.json) && mine.json.length === 1 && mine.json[0].role === "SUPER_ADMIN",
  `status ${mine.status}, ${JSON.stringify(mine.json).slice(0, 160)}`);

// 3. THE LOAD-BEARING ONE. A token must never be *refused* by PostgREST. If the
//    role switch failed, every check above would "pass" by returning zero rows
//    for the wrong reason, and the whole suite would be worthless.
const refused = await rest(staffToken, "user_profiles?select=id");
check("the staff token is accepted, not merely unanswered",
  refused.status === 200,
  `status ${refused.status}, ${JSON.stringify(refused.json).slice(0, 160)}`);

// 4. is_staff() must be SECURITY DEFINER and reach user_profiles through RLS.
//    If ownership ever changes, is_staff() returns false for everyone and every
//    staff page silently 404s — this is the check that catches it.
const staffSawAll = await rest(staffToken, "user_profiles?select=id");
check("is_staff() admits the staff role to the profile table",
  staffSawAll.status === 200 && Array.isArray(staffSawAll.json) && staffSawAll.json.length >= 3,
  `rows ${Array.isArray(staffSawAll.json) ? staffSawAll.json.length : "n/a"}`);

// 5. Task 5's lock-down must hold even for staff.
for (const t of ["jobs", "applicants"]) {
  const r = await rest(staffToken, `${t}?select=id`);
  check(`locked-down table ${t} is unreachable even with a staff token`,
    r.status === 401 || r.status === 403 || r.status === 404,
    `status ${r.status}`);
}

// 6. The two RPCs the app calls must be exposed by PostgREST.
for (const rpc of ["refresh_attempt_integrity", "stop_time_entry"]) {
  const r = await fetch(`${BASE}/rpc/${rpc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
    body: "{}",
  });
  const text = await r.text();
  // 200/204 = ran; 400 with a not-null violation = reached the function.
  // 404 = PostgREST does not expose it, which is the only real failure.
  check(`rpc/${rpc} is exposed`, r.status !== 404, `status ${r.status}, ${text.slice(0, 100)}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:", failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
```

- [ ] **Step 2: Add the script** to `package.json` after `db:apply-local`:

```json
    "stack:prove": "node scripts/prove-local-stack.mjs",
```

- [ ] **Step 3: Run it and believe what it says.**

```bash
npm run stack:prove
```

Expected: `6/6 checks passed` (the two lock-down tables and two RPCs make four of the six lines). Investigate a failure before writing any Slice C code — spec §3 says the identity half is only provable against a PostgREST we own, and this gate is that proof. A failure on check 1 usually means a policy grants `to public` while the row-level predicate assumes `authenticated`; a failure on check 3 means `authenticator` is not a member of `authenticated`.

- [ ] **Step 4: Commit.**

```bash
git add scripts/prove-local-stack.mjs package.json
git commit -m "test(stack): prove our own token reaches the same rows through our own PostgREST"
```

---

## Slice C — sessions, cookies, and the one seam

### The hand-written surface, measured

Spec §2 counts 442 `.from("table")` reads and says "kept as-is". That is true of the *call sites*; it is not true of the *object they are called on*. `createServerClient()` returns supabase-js's PostgREST builder, and Plan 1's end state — spec §1, "no `@supabase/*` package left in the tree" — means something in this repo has to answer those 442 chains. Re-derived from `src/` on 2026-10-20, the surface is one file's worth of work, not forty:

| Used | Count | Never used |
| --- | --- | --- |
| `.eq()` 389, `.filter()` 370, `.select()` 357, `.maybeSingle()` 141, `.order()` 118, `.limit()` 75, `.update()` 74, `.in()` 49, `.insert()` 45, `.delete()` 39, `.is()` 35, `.single()` 16, `.not()` 15, `.range()` 8, `.gte()` 8, `.or()` 7, `.upsert()` 5, `.lte()` 5, `.neq()` 4, `.lt()` 4, `.gt()` 4, `.like()` 2, `.contains()` 2, `.ilike()` 1 | **1,763 calls, 24 methods** | `.schema()`, `.containedBy()`, `.matches()`, `.geojson()`, `.csv()`, `.throwOnError()`, `.head()` as a method (it is an option), `.and()` |

Options actually passed: `{ count: "exact" }` ×36, `{ head: true }` ×29, `{ onConflict: … }` in all 5 `.upsert()` calls, `{ ascending: false }` in `.order()`, `nullsFirst` once. Two `.rpc()` call sites. That is the whole contract Task 11 implements, and it is why the promise "leave the query call sites alone" is honest rather than hopeful.

### Task 8: `src/lib/auth/token.ts` — mint and verify our own signed token

**Files:**
- Create: `src/lib/auth/token.ts`
- Test: `scripts/prove-token-shape.mjs`

**Interfaces:**
- Consumes: `AUTH_JWT_SECRET` (and `AUTH_TOKEN_TTL_SECONDS`, default 900) from the server env.
- Produces: `mintSessionToken({ sub, role }) => Promise<string>`, `verifySessionToken(token) => Promise<Claims | null>`, `type Claims = { sub: string; role: "anon" | "authenticated" | "service_role"; aud: string; iss: string; iat: number; exp: number }`. Task 9 signs in with the first, Task 11 attaches its output as a bearer, Task 13 verifies it in the proxy.

Deviation from spec §6, deliberate: the claim is **`sub`**, not `uid`, because `sub` is what the 80 ported policies reach through `auth.uid()` (Task 4 Step 1), and rewriting `auth.uid()` to read `uid` would mean rewriting the dump instead of standing beside it. The token carries `{ sub, role, aud, iss, iat, exp }` and nothing else — role here means the *Postgres* role for RLS, never the staff role, which is read from `user_profiles` (spec §6).

- [ ] **Step 1: Write the failing probe first.**

```js
/* scripts/prove-token-shape.mjs — Run: node scripts/prove-token-shape.mjs */
import { mintSessionToken, verifySessionToken } from "../src/lib/auth/token.ts";

const t = await mintSessionToken({ sub: "11111111-1111-1111-1111-111111111111", role: "authenticated" });
const c = await verifySessionToken(t);
if (!c || c.sub !== "11111111-1111-1111-1111-111111111111" || c.role !== "authenticated")
  throw new Error("round trip failed");
if (await verifySessionToken(t.slice(0, -2) + "xx")) throw new Error("tampered token accepted");
if (await verifySessionToken(null)) throw new Error("null accepted");
console.log("PASS token round trip, tamper refusal, null refusal");
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
node --experimental-strip-types scripts/prove-token-shape.mjs
```

Expected: cannot resolve `../src/lib/auth/token.ts` — the file does not exist yet.

Two facts about this probe command, both measured on this device (Node v24.21.0) before the plan was written, so nobody has to re-derive them: a `.mjs` file **can** import a `.ts` file with no flag and no loader at all — type stripping is unflagged in this Node major — and `--experimental-strip-types` is still accepted and harmless. The import specifier must carry the explicit `.ts` extension, and it must be a **relative** path: this repo configures no import loader (`package.json` and `scripts/*.mjs` contain no loader, `register`, or alias hook), so the `@/` alias will not resolve outside Next. That is why every probe in this plan reaches source by relative path, and why `src/lib/auth/token.ts` below imports only `node:crypto`. Do not add `tsx`, `ts-node`, or `esbuild-register` — that violates the no-new-dependency constraint.

- [ ] **Step 3: Write `src/lib/auth/token.ts`.**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed token that replaces GoTrue's. Same shape as the JWTs the ported
 * policies already read — `sub` for the auth user, `role` for the Postgres role
 * PostgREST switches into — but minted and verified here, with our own secret.
 *
 * HS256 on purpose: PostgREST reads PGRST_JWT_SECRET as a symmetric secret and
 * this file must produce a token it accepts, so an asymmetric algorithm would
 * need a different PostgREST configuration and a second key management story.
 */

const ISSUER = "sharm-dreams-local";
const AUDIENCE = "sdg_local";

export type TokenRole = "anon" | "authenticated" | "service_role";

export interface Claims {
  sub: string;
  role: TokenRole;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
}

class TokenConfigError extends Error {}

function secret(): string {
  const s = process.env.AUTH_JWT_SECRET ?? "";
  if (s.length < 32) {
    throw new TokenConfigError(
      "AUTH_JWT_SECRET is missing or shorter than 32 characters. It must equal " +
        "PGRST_JWT_SECRET in the Compose stack — see docker/.env.example."
    );
  }
  return s;
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

export async function mintSessionToken(
  input: { sub: string; role: TokenRole },
  ttlSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 900)
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub: input.sub,
    role: input.role,
    aud: AUDIENCE,
    iss: ISSUER,
    iat: now,
    exp: now + ttlSeconds,
  });
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

/** A minted service-role token is the only way a background job bypasses RLS,
 * so it has no cookie and never leaves the process that made it. */
export async function mintServiceToken(ttlSeconds = 60): Promise<string> {
  return mintSessionToken({ sub: "00000000-0000-0000-0000-000000000000", role: "service_role" }, ttlSeconds);
}

export async function verifySessionToken(token: string | undefined | null): Promise<Claims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  let claims: Claims;
  try {
    // Reject an algorithm swap before trusting anything in the header: a token
    // that says alg=none is not a token, it is a request to be let in.
    const head = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string };
    if (head.alg !== "HS256") return null;

    const expected = Buffer.from(sign(`${header}.${body}`));
    const actual = Buffer.from(signature);
    // Without this length guard, timingSafeEqual throws on a short signature.
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (claims.aud !== AUDIENCE || claims.iss !== ISSUER) return null;
  if (claims.role !== "authenticated" && claims.role !== "anon" && claims.role !== "service_role") {
    return null;
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  return claims;
}
```

- [ ] **Step 4: Re-run the probe, then the repo gates.**

```bash
node --experimental-strip-types scripts/prove-token-shape.mjs
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/lib/auth/token.ts scripts/prove-token-shape.mjs
```

Expected: `PASS token round trip, tamper refusal, null refusal`, then both gates silent.

- [ ] **Step 5: Prove PostgREST accepts what `mintSessionToken` produced** — the assertion that ties this file to Task 2's `PGRST_JWT_SECRET`.

```bash
node --input-type=module -e "
process.env.AUTH_JWT_SECRET=(await import('node:fs')).readFileSync('docker/.env','utf8').match(/^AUTH_JWT_SECRET=(.+?)\r?$/m)[1];
const { mintSessionToken } = await import('./src/lib/auth/token.ts');
const t = await mintSessionToken({ sub:'11111111-1111-1111-1111-111111111111', role:'authenticated' });
const r = await fetch('http://localhost:54321/rest/v1/user_profiles?select=id', { headers:{ Authorization:'Bearer '+t } });
console.log('status', r.status, (await r.text()).slice(0,200));
" --experimental-strip-types
```

Expected: `status 200` with an empty array (the uid has no profile) — **not** `401 JWS signature verification failed`, which would mean the secret and `PGRST_JWT_SECRET` disagree, and not `403` — which would mean `authenticated` is unreachable from `authenticator`.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/auth/token.ts scripts/prove-token-shape.mjs
git commit -m "feat(auth): mint and verify the HS256 session token that replaces GoTrue"
```

---

### Task 9: Verify a staff password with pgcrypto, not a new dependency

**Files:**
- Create: `src/lib/auth/db.ts`
- Create: `src/lib/auth/passwords.ts`
- Test: `scripts/prove-password-verify.mjs`

**Interfaces:**
- Consumes: `AUTH_DB_URL` (the local `postgresql://…@localhost:54320/sharm_dreams` string), `auth.users.encrypted_password` as written by `scripts/seed-local-staff.mjs`.
- Produces: `getAuthPool() => Pool`, `verifyStaffPassword(email, password) => Promise<{ ok: true, userId } | { ok: false, reason: "unknown_user" | "wrong_password" | "banned" }>`. Task 12's sign-in calls the second; Task 16's cron reads neither but shares `getAuthPool()` indirectly through the service token.

Why SQL and not a library: Supabase stores `$2a$` bcrypt (proved in Task 6 Step 3), Postgres 17's `pgcrypto` already ships `crypt()` which accepts that prefix, and adding `bcrypt`/`argon2` to a repo whose goal is to *remove* vendored runtime is the wrong trade. This keeps Plan 1 at exactly one promoted dependency (`pg`).

- [ ] **Step 1: Add `AUTH_DB_URL`** to `docker/.env.example` and `docker/.env`, plus a comment in `.env.example`:

```ini
# The app's own connection string for auth work only (password verification,
# and later the staff directory). PostgREST never sees it.
AUTH_DB_URL=postgresql://postgres:sdg_local_dev_pw@localhost:54320/sharm_dreams
```

- [ ] **Step 2: Write `src/lib/auth/db.ts`.**

```ts
import { Pool } from "pg";

/**
 * One pool for the whole process. This is a change of shape, not of behaviour:
 * on Vercel every request got a cold connection, and on a persistent container
 * the pool is reused — which is the point of leaving serverless (spec §9).
 *
 * Guarded as a module global so hot reloads during `next dev` do not open a new
 * pool per edit. The existing process-global singletons in src/lib/supabase/
 * anon.ts:5 and service.ts:5 follow the same convention.
 */
let pool: Pool | null = null;

export function getAuthPool(): Pool {
  if (pool) return pool;
  const url = process.env.AUTH_DB_URL;
  if (!url) {
    throw new Error(
      "AUTH_DB_URL is not set. Add it to .env.local pointing at the local stack — see docker/.env.example."
    );
  }
  pool = new Pool({
    connectionString: url,
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  return pool;
}
```

- [ ] **Step 3: Write `src/lib/auth/passwords.ts`.**

```ts
import { getAuthPool } from "./db";

export type PasswordCheck =
  | { ok: true; userId: string }
  | { ok: false; reason: "unknown_user" | "wrong_password" | "banned" };

/**
 * Verifies a staff password against the migrated bcrypt hash.
 *
 * `crypt(submitted, stored) = stored` is pgcrypto's own comparison: it re-salts
 * the submitted password with the stored hash's salt, so the comparison is a
 * string equality on a derived value and never touches the secret itself.
 *
 * The unknown-user case runs a comparison against a fixed hash anyway. That is
 * deliberate: without it, a missing account answers faster than a wrong
 * password, and the login form becomes an email-enumeration oracle.
 */
const TIMING_SAFE_DUMMY = crypt_dummy();

function crypt_dummy() {
  // Any real $2a$ hash of a password nobody will submit. Kept as a literal so
  // the module never reaches for the database while it is being imported.
  return "$2a$10$7GOZ0l7k5jz4Q2yQq0hLyeJ9sZ3o6Gx1u4DP9Uv3pQe6Gx1u4DP9Uv";
}

export async function verifyStaffPassword(email: string, password: string): Promise<PasswordCheck> {
  const normalized = email.trim().toLowerCase();
  const { rows } = await getAuthPool().query(
    `select id,
             (encrypted_password is not null
               and crypt($2, encrypted_password) = encrypted_password) as password_ok,
             banned_until is not null and banned_until > now() as is_banned
       from auth.users
      where lower(email) = $1
      limit 1`,
    [normalized, password]
  );

  if (!rows.length) {
    await getAuthPool().query("select crypt($1, $2) as x", [password, TIMING_SAFE_DUMMY]);
    return { ok: false, reason: "unknown_user" };
  }
  const row = rows[0] as { id: string; password_ok: boolean; is_banned: boolean };
  if (!row.password_ok) return { ok: false, reason: "wrong_password" };
  if (row.is_banned) return { ok: false, reason: "banned" };
  return { ok: true, userId: row.id };
}
```

- [ ] **Step 4: Write and run `scripts/prove-password-verify.mjs`.**

```js
/* scripts/prove-password-verify.mjs — Run: node scripts/prove-password-verify.mjs
 * Reads the fixture password from docker/.env and never prints it. */
import { readFileSync } from "node:fs";
import { verifyStaffPassword } from "../src/lib/auth/passwords.ts";

const env = Object.fromEntries(
  readFileSync("docker/.env", "utf8")
    .split(/\r?\n/)
    .map((l) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); return m ? [m[1], m[2].trim()] : null; })
    .filter(Boolean)
);
process.env.AUTH_DB_URL = env.AUTH_DB_URL;
const pw = env.LOCAL_STAFF_PASSWORD;

const good = await verifyStaffPassword("owner.local@sharmdreams.test", pw);
const bad = await verifyStaffPassword("owner.local@sharmdreams.test", pw + "-nope");
const ghost = await verifyStaffPassword("nobody@sharmdreams.test", pw);

if (!good.ok) throw new Error(`correct password rejected: ${JSON.stringify(good)}`);
if (bad.ok || bad.reason !== "wrong_password") throw new Error(`wrong password accepted: ${JSON.stringify(bad)}`);
if (ghost.ok || ghost.reason !== "unknown_user") throw new Error(`bad unknown-user path: ${JSON.stringify(ghost)}`);
console.log("PASS correct/wrong/unknown all answered correctly, and case-insensitively");
console.log("  seeded user id:", good.userId);
```

```bash
node --experimental-strip-types scripts/prove-password-verify.mjs
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/lib/auth/db.ts src/lib/auth/passwords.ts
```

Expected: the PASS line with a real uuid. A `crypt()` failure mentioning `$2a$` means the image's pgcrypto is older than the hash format — report the `select extversion from pg_extension where extname='pgcrypto'` value rather than switching to a Node library.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/db.ts src/lib/auth/passwords.ts scripts/prove-password-verify.mjs docker/.env.example
git commit -m "feat(auth): verify staff passwords with pgcrypto over the local pool"
```

---

### Task 10: Isolate the 16 storage call sites behind one module

**Files:**
- Create: `src/lib/files/store.ts`
- Create: `src/lib/supabase/vendor.ts`
- Modify: the 14 files that currently call `supabase.storage.from(bucket)` — find them with `grep -rn "\.storage\.from(" src/`
- Modify: `src/lib/config.ts:48-52` (add the missing `candidateCvs` bucket)

**Interfaces:**
- Produces:

```ts
export interface FileStore {
  upload(input: { bucket: string; path: string; body: BodyInit; contentType?: string; upsert?: boolean }): Promise<{ ok: boolean; error?: string }>;
  signedUrl(input: { bucket: string; path: string; seconds: number }): Promise<{ url: string | null }>;
  download(input: { bucket: string; path: string }): Promise<{ bytes: Uint8Array | null; contentType: string | null }>;
  remove(input: { bucket: string; paths: string[] }): Promise<{ ok: boolean; failed: string[] }>;
  list(input: { bucket: string; prefix: string; limit?: number }): Promise<{ paths: string[] }>;
}
export function getFileStore(): Promise<FileStore>;      // the only entry call sites use
export async function createVendorStorageClient();        // in vendor.ts, deleted by Plan 2
```

Task 11 does not touch storage because of this task; Plan 2 adds a disk-backed `FileStore` and changes one `return` inside `getFileStore()`.

Why `vendor.ts` exists: during Plan 1 the *reads* move to the local stack while *bytes* stay with the vendor, because the local `storage.objects` shim holds rows, not files. So the port genuinely runs two clients at once, and that has to be a named, dated decision in the tree rather than an accident spread across 16 files. Plan 2 deletes this file along with `storage.objects`.

- [ ] **Step 1: Re-derive the site list before editing.**

```bash
grep -rn "\.storage\.from(" src/ | tee /tmp/storage-sites.txt
grep -rc "\.storage\.from(" src/ | grep -v ':0$' | wc -l
```

Expected: **16 accessor call sites across 14 files** (correction #3). Paste the list into your commit message body so the next reader can check the count instead of trusting it. If the number differs, stop and reconcile the difference with the tree — the tree wins.

- [ ] **Step 2: Add the bucket `config.ts` omits.** [src/lib/config.ts:48-52](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/lib/config.ts#L48-L52) lists three buckets while `supabase/schema.sql` seeds four, including `candidate-cvs`. Add the line so a Plan 2 writer is not pointed at a bucket that already exists:

```ts
  buckets: {
    candidateVideos: "candidate-videos",
    candidateAudio: "candidate-audio",
    candidateCvs: "candidate-cvs",
    resumes: "resumes",
  },
```

- [ ] **Step 3: Write `src/lib/supabase/vendor.ts`, then `src/lib/files/store.ts`.**

```ts
/* src/lib/supabase/vendor.ts
 * The vendor storage client, kept separate from the query seam on purpose:
 * Plan 1 moves reads to the local stack while bytes stay here. Plan 2 deletes
 * this file along with storage.objects (spec §7).
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";

/** File *metadata* lives in storage.objects and is served by RLS, so this client
 * carries the service key rather than the request's anon token: the byte-level
 * bucket policies are being replaced in Plan 2, not reproduced here. */
export async function createVendorStorageClient() {
  return createClient(supabaseConfig.url, supabaseConfig.anonKey, {
    global: { headers: { Authorization: `Bearer ${supabaseConfig.serviceRoleKey}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

```ts
/* src/lib/files/store.ts */
import "server-only";
import { createVendorStorageClient } from "@/lib/supabase/vendor";

/**
 * Every file the portal touches goes through this interface, so the storage
 * backend is decided once instead of sixteen times.
 */
export interface FileStore {
  upload(input: { bucket: string; path: string; body: BodyInit; contentType?: string; upsert?: boolean }): Promise<{ ok: boolean; error?: string }>;
  signedUrl(input: { bucket: string; path: string; seconds: number }): Promise<{ url: string | null }>;
  download(input: { bucket: string; path: string }): Promise<{ bytes: Uint8Array | null; contentType: string | null }>;
  remove(input: { bucket: string; paths: string[] }): Promise<{ ok: boolean; failed: string[] }>;
  list(input: { bucket: string; prefix: string; limit?: number }): Promise<{ paths: string[] }>;
}

/** Plan 2 returns a disk-backed store here; no call site changes. */
export async function getFileStore(): Promise<FileStore> {
  const client = await createVendorStorageClient();
  const { storage } = client;
  return {
    async upload({ bucket, path, body, contentType, upsert }) {
      const { error } = await storage
        .from(bucket)
        .upload(path, body, { contentType, upsert });
      return { ok: !error, error: error?.message };
    },
    async signedUrl({ bucket, path, seconds }) {
      const { data } = await storage.from(bucket).createSignedUrl(path, seconds);
      return { url: data?.signedUrl ?? null };
    },
    async download({ bucket, path }) {
      const { data, error } = await storage.from(bucket).download(path);
      if (error || !data) return { bytes: null, contentType: null };
      const buffer = await data.arrayBuffer();
      return { bytes: new Uint8Array(buffer), contentType: null };
    },
    async remove({ bucket, paths }) {
      const { error } = await storage.from(bucket).remove(paths);
      return { ok: !error, failed: error ? paths : [] };
    },
    async list({ bucket, prefix, limit = 1000 }) {
      const { data } = await storage.from(bucket).list(prefix, { limit });
      return {
        paths: (data ?? []).map((entry) => (prefix ? `${prefix}/${entry.name}` : entry.name)),
      };
    },
  };
}
```

Type note for the engineer writing this: `supabase-js`'s `upload()` accepts `File | Blob | ArrayBuffer | string`, not the wider `BodyInit`. If `tsc` complains, narrow `FileStore.upload.body` to `Blob | ArrayBuffer | string` — do **not** paper over it with `as never`, because the whole point of this seam is that its types describe what Plan 2 must reproduce.

Preserve each site's existing failure branch. If a site currently reads `error.message` into an activity-trail row, keep that message in the return value rather than swallowing it into a boolean.

- [ ] **Step 4: Rewrite each of the 16 sites** to `const files = await getFileStore();` and then the matching method. Keep the surrounding error handling, logging and activity-trail writes exactly as they are; this task moves a call, it does not change a behaviour. For each file, re-read the site after editing and confirm the same three things survive: the bucket name, the path expression, and the failure branch.

- [ ] **Step 5: Prove nothing regressed.**

```bash
grep -rn "\.storage\.from(" src/ | grep -v "src/lib/files/store.ts" | grep -v "src/lib/supabase/vendor.ts" | wc -l
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/lib/files/store.ts src/lib/supabase/vendor.ts src/lib/config.ts
node scripts/check-themes.mjs
```

Expected: `0` storage accessors outside the two new modules, both gates silent. The live file paths cannot be proved on the local stack (no bytes behind the shim) — say so in the commit body rather than implying a proof you did not run.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/files/store.ts src/lib/supabase/vendor.ts src/lib/config.ts
git add -u src
git commit -m "refactor(files): route every storage accessor through one file store"
```

Body: the 16 sites with their `file:line`, the count of files touched, and the explicit note that byte-level behaviour is unchanged — the store still delegates to the vendor client, so this is a seam, not a migration.

### Task 11: The PostgREST builder, and the one seam that adopts it

**Files:**
- Create: `src/lib/rest/query-builder.ts`
- Create: `src/lib/rest/client.ts`
- Create: `src/lib/rest/auth-shim.ts`
- Modify: `src/lib/supabase/server.ts` (whole body)
- Modify: `src/lib/supabase/service.ts`, `src/lib/supabase/anon.ts`
- Test: `scripts/prove-rest-builder.mjs`

**Interfaces:**
- Consumes: `SUPABASE_REST_BASE` (the gateway `http://localhost:54321`), `mintSessionToken()` / `verifySessionToken()` from Task 8, the cookie name from Task 12.
- Produces: `createRestClient({ token }) => RestClient` where `RestClient` is `{ from(table): Query; rpc(name, body): Promise<Result>; auth: AuthShim }`; and `createSupabaseServerClient()` — **same name, same import path, same call shape** — returning that client. All 129 call sites and their 442 chains keep compiling.

- [ ] **Step 1: Write the builder's failing probe**, which pins the exact URL each chain must produce. These expectations are PostgREST's own querystring grammar, not supabase-js internals — that is what makes the builder replaceable.

```js
/* scripts/prove-rest-builder.mjs
 * Run: node --experimental-strip-types scripts/prove-rest-builder.mjs */
import { QueryBuilder, buildUrl } from "../src/lib/rest/query-builder.ts";

const q = () => new QueryBuilder();

const cases = [
  [q().select("id,name").eq("tenant_id", "t1").order("created_at", { ascending: false }).limit(5),
    "?select=id%2Cname&tenant_id=eq.t1&order=created_at.desc&limit=5"],
  [q().select("*").in("id", ["a", "b"]).is("deleted_at", null),
    "?select=*&id=in.%28%22a%22%2C%22b%22%29&deleted_at=is.null"],
  [q().select("id").filter("score", "gte", 80).not("status", "eq", "DRAFT"),
    "?select=id&score=gte.80&status=not.eq.DRAFT"],
  [q().select("id").or("email.eq.a@b.c,name.ilike.*jo*"),
    "?select=id&or=%28email.eq.a%40b.c%2Cname.ilike.*jo*%29"],
  [q().select("id").range(20, 39), "?select=id&offset=20&limit=20"],
  [q().select("*,job_openings(title)").eq("id", "x"),
    "?select=%2A%2Cjob_openings%28title%29&id=eq.x"],
];

let bad = 0;
for (const [builder, expected] of cases) {
  const got = builder.toQuerystring();
  if (got !== expected) { bad++; console.error(`FAIL\n  expected ${expected}\n  got      ${got}`); }
}
if (bad) process.exit(1);
console.log(`PASS ${cases.length} URL shapes`);
console.log(buildUrl("applications", q().select("id").eq("id", "x")));
```

- [ ] **Step 2: Run it; expect the module to be missing.**

```bash
node --experimental-strip-types scripts/prove-rest-builder.mjs
```

Expected: `Cannot find module …/src/lib/rest/query-builder.ts`. Once the builder exists, a failing case means the serialiser disagrees with PostgREST's grammar — fix the serialiser, never the expectation, and confirm against the live server in Step 7 rather than by reasoning about brackets.

- [ ] **Step 3: Write `src/lib/rest/query-builder.ts`.** The method set is exactly the 24 measured in Slice C's preamble; anything else is speculative.

```ts
type Filter = [column: string, operator: string, value: unknown];
type Modifier =
  | { kind: "order"; spec: string }
  | { kind: "limit"; value: number }
  | { kind: "offset"; value: number };

export interface Shape {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD";
  select?: string;
  filters: Filter[];
  modifiers: Modifier[];
  body?: unknown;
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
  onConflict?: string;
  ignoreDuplicates?: boolean;
  single: boolean;
  maybeSingle: boolean;
}

/** Operators that take a pre-formed value the caller already bracketed. */
const RAW_VALUE_OPS = new Set(["in", "or", "and"]);

/** Operators whose name is part of the filter key rather than a column test. */
const LOGIC_OPS = new Set(["or", "and"]);

const FILTER_OPS = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "match", "in", "is",
  "contains", "containedBy", "overlaps", "cs", "cd", "ov", "sl", "sr", "not", "or", "and",
]);

/**
 * A value PostgREST must see quoted. Anything holding a character the grammar
 * owns (comma, bracket, dot) or leading/trailing whitespace gets double quotes,
 * because `eq.a,b` silently means two filters while `eq."a,b"` means one value.
 */
function literal(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const s = String(value);
  if (/^[A-Za-z0-9_:\-+.@ ]+$/.test(s) && s.trim() === s && s !== "") return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export class QueryBuilder {
  private shape: Shape = {
    method: "GET", filters: [], modifiers: [], single: false, maybeSingle: false,
  };

  select(columns = "*", options?: { count?: Shape["count"]; head?: boolean }) {
    this.shape.select = columns;
    this.shape.method = options?.head ? "HEAD" : "GET";
    if (options?.count) this.shape.count = options.count;
    if (options?.head) this.shape.head = true;
    return this;
  }

  insert(values: unknown) { this.shape.method = "POST"; this.shape.body = values; return this; }
  update(values: object) { this.shape.method = "PATCH"; this.shape.body = values; return this; }
  delete() { this.shape.method = "DELETE"; this.shape.body = undefined; return this; }
  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.shape.method = "POST";
    this.shape.body = values;
    this.shape.onConflict = options?.onConflict;
    this.shape.ignoreDuplicates = options?.ignoreDuplicates;
    return this;
  }

  eq(c: string, v: unknown) { return this.push(c, "eq", v); }
  neq(c: string, v: unknown) { return this.push(c, "neq", v); }
  gt(c: string, v: unknown) { return this.push(c, "gt", v); }
  gte(c: string, v: unknown) { return this.push(c, "gte", v); }
  lt(c: string, v: unknown) { return this.push(c, "lt", v); }
  lte(c: string, v: unknown) { return this.push(c, "lte", v); }
  like(c: string, v: string) { return this.push(c, "like", v); }
  ilike(c: string, v: string) { return this.push(c, "ilike", v); }
  contains(c: string, v: unknown) { return this.push(c, "cs", v); }
  containedBy(c: string, v: unknown) { return this.push(c, "cd", v); }
  overlaps(c: string, v: unknown) { return this.push(c, "ov", v); }

  match(values: Record<string, string>) {
    for (const [column, value] of Object.entries(values)) this.push(column, "eq", value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.shape.filters.push([column, "in", `(${values.map(literal).join(",")})`]);
    return this;
  }

  is(column: string, value: unknown) {
    this.shape.filters.push([column, "is", value === null ? "null" : String(value)]);
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (!FILTER_OPS.has(operator)) throw new Error(`rest: not() operator "${operator}" is not a filter operator`);
    return this.push(column, `not.${operator}`, value);
  }

  /** `or("a.eq.1,b.eq.2")` — the caller writes the inner expression, verbatim
   * from today's call sites, so its content is never re-encoded. */
  or(composite: string) { return this.push("or", "or", stripParens(composite)); }
  and(composite: string) { return this.push("and", "and", stripParens(composite)); }

  filter(column: string, operator: string, value: unknown) {
    if (!FILTER_OPS.has(operator)) throw new Error(`rest: filter() operator "${operator}" is not supported`);
    return this.push(column, operator, RAW_VALUE_OPS.has(operator) ? value : String(value));
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    const direction = options?.ascending === false ? "desc" : "asc";
    const nulls = options?.nullsFirst === true ? "nullsfirst"
      : options?.nullsFirst === false ? "nullslast" : "";
    this.shape.modifiers.push({ kind: "order", spec: nulls ? `${column}.${direction}.${nulls}` : `${column}.${direction}` });
    return this;
  }

  limit(value: number) { this.shape.modifiers.push({ kind: "limit", value }); return this; }
  range(from: number, to: number) {
    this.shape.modifiers.push({ kind: "offset", value: from });
    this.shape.modifiers.push({ kind: "limit", value: to - from + 1 });
    return this;
  }

  single() { this.shape.single = true; return this; }
  maybeSingle() { this.shape.maybeSingle = true; return this; }

  /**
   * PostgREST grammar: `column=operator.value` in insertion order, `or=(…)` /
   * `and=(…)` as their own keys, then `order`, `offset`, `limit`.
   * URLSearchParams is what percent-encodes the commas and brackets, so the
   * probe's expectations and the wire bytes cannot drift.
   */
  toQuerystring(): string {
    const params = new URLSearchParams();
    if (this.shape.select !== undefined) params.append("select", this.shape.select);

    for (const [column, operator, value] of this.shape.filters) {
      if (LOGIC_OPS.has(operator)) {
        params.append(operator, `(${String(value)})`);
        continue;
      }
      const rendered = RAW_VALUE_OPS.has(operator)
        ? `${operator}.${String(value)}`
        : `${operator}.${literal(value)}`;
      params.append(column, rendered);
    }

    for (const modifier of this.shape.modifiers) {
      if (modifier.kind === "order") params.append("order", modifier.spec);
      else if (modifier.kind === "limit") params.append("limit", String(modifier.value));
      else if (modifier.kind === "offset") params.append("offset", String(modifier.value));
    }

    if (this.shape.onConflict) params.append("on_conflict", this.shape.onConflict);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  shape_(): Shape { return this.shape; }

  private push(column: string, operator: string, value: unknown) {
    this.shape.filters.push([column, operator, value]);
    return this;
  }
}

function stripParens(value: string): string {
  return value.replace(/^\s*\(/, "").replace(/\)\s*$/, "");
}

export function buildUrl(table: string, builder: QueryBuilder): string {
  return `/${table}${builder.toQuerystring()}`;
}
```

Two decisions in that file are load-bearing and worth defending in review: `filter()` and `not()` **throw** on an unknown operator rather than passing it through (a typo today produces an empty result, which reads like an RLS problem and wastes a day), and `or()`/`and()` never re-encode their argument (today's call sites already pass PostgREST expressions, so the builder is a transport, not a translator).

- [ ] **Step 3b: Run the probe before writing the transport.**

```bash
node --experimental-strip-types scripts/prove-rest-builder.mjs
```

Expected: `PASS 6 URL shapes` then `/applications?select=id&id=eq.x`.

- [ ] **Step 4: Write `src/lib/rest/client.ts`.**

```ts
import { QueryBuilder, buildUrl, type Shape } from "./query-builder";

export interface RestError { message: string; code?: string; details?: string; hint?: string }

export interface Result<T = unknown> {
  data: T | null;
  error: RestError | null;
  count: number | null;
}

interface RestClientConfig {
  baseUrl: string;                      // http://localhost:54321/rest/v1
  token: string | null;                 // the bearer this request carries
  fetchImpl?: typeof fetch;
}

export function createRestClient(config: RestClientConfig) {
  const doFetch = config.fetchImpl ?? fetch;
  const authHeaders = () => (config.token ? { Authorization: `Bearer ${config.token}` } : {});

  async function send(url: string, shape: Shape, headers: Record<string, string>): Promise<Result> {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: shape.method,
        headers,
        ...(["GET", "HEAD", "DELETE"].includes(shape.method) ? {} : { body: JSON.stringify(shape.body ?? null) }),
        cache: "no-store",
      });
    } catch (cause) {
      return { data: null, error: { message: `rest: ${config.baseUrl} unreachable — ${(cause as Error).message}` }, count: null };
    }

    const range = res.headers.get("content-range");
    const count = range && /\/\d+$/.test(range) ? Number(range.split("/")[1]) : null;
    if (res.status === 204 || res.status === 205) return { data: null, error: null, count };

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return {
        data: null,
        error: { message: body?.message ?? res.statusText, code: body?.code, details: body?.details, hint: body?.hint },
        count,
      };
    }
    // A head-count request has no body by contract; the count is the answer.
    if (shape.method === "HEAD") return { data: null, error: null, count };

    const parsed = (await res.json()) as unknown;

    if (shape.single || shape.maybeSingle) {
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      if (rows.length === 0 && shape.maybeSingle) return { data: null, error: null, count };
      if (rows.length !== 1) {
        return { data: null, error: { message: `rest: expected one row, got ${rows.length}`, code: "PGRST116" }, count };
      }
      return { data: rows[0], error: null, count };
    }
    if (shape.single) {
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      if (rows.length !== 1) {
        return { data: null, error: { message: `rest: expected one row, got ${rows.length}`, code: "PGRST116" }, count };
      }
      return { data: rows[0], error: null, count };
    }
    return { data: parsed, error: null, count };
  }

  function run(table: string, builder: QueryBuilder): Promise<Result> {
    const shape = builder.shape_();
    const headers: Record<string, string> = {
      Accept: shape.single || shape.maybeSingle ? "application/vnd.pgrst.object+json" : "application/json",
      ...authHeaders(),
    };

    const prefer: string[] = [];
    if (shape.count) prefer.push(`count=${shape.count}`);
    if (shape.method === "POST" || shape.method === "PATCH") prefer.push("return=representation");
    if (shape.method === "POST" && shape.onConflict) {
      prefer.unshift(shape.ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates");
    }
    if (prefer.length) headers.Prefer = prefer.join(",");
    if (shape.method === "POST" || shape.method === "PATCH") headers["Content-Type"] = "application/json";

    return send(`${config.baseUrl}${buildUrl(table, builder)}`, shape, headers);
  }

  return {
    from(table: string) {
      const builder = new QueryBuilder();
      // Thenable, because every existing site writes
      // `await supabase.from(x).select(y)` with no terminal call. Without this
      // the port would mean editing 442 chains — the thing spec §1 forbids.
      return Object.assign(builder, {
        then<T1, T2>(onFulfilled: (r: Result) => T1 | PromiseLike<T1>, onRejected?: (e: unknown) => T2 | PromiseLike<T2>) {
          return run(table, builder).then(onFulfilled, onRejected);
        },
      });
    },

    async rpc(name: string, body?: object): Promise<Result> {
      const url = `${config.baseUrl}/rpc/${encodeURIComponent(name)}`;
      let res: Response | null = null;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders() },
          body: JSON.stringify(body ?? {}),
          cache: "no-store",
        });
      } catch {
        return { data: null, error: { message: `rest: rpc ${name} unreachable` }, count: null };
      }
      const range = res.headers.get("content-range");
      const count = range && /\/\d+$/.test(range) ? Number(range.split("/")[1]) : null;
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        return { data: null, error: { message: j?.message ?? res.statusText, code: j?.code }, count };
      }
      if (res.status === 204) return { data: null, error: null, count };
      const text = await res.text();
      return { data: text ? (JSON.parse(text) as unknown) : null, error: null, count };
    },
  };
}

export type RestClient = ReturnType<typeof createRestClient>;
```

Two things in that file will be argued with in review, so here they are: `cache: "no-store"` on every call is what preserves today's behaviour, where the vendor client never served a cached read (and `cacheComponents: true` in Next 16 would otherwise make a stale row look like an RLS bug); and `return=representation` on writes is what keeps the `.insert(…).select()` idiom returning rows, which several actions use to learn the new id.

- [ ] **Step 5: Write `src/lib/rest/auth-shim.ts`** — the object the 11 non-`admin` `supabase.auth.*` sites keep calling, and the reason `server.ts` can be re-pointed without editing them.

```ts
import "server-only";
import { verifySessionToken, type Claims } from "@/lib/auth/token";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

export interface ShimUser { id: string; email: string | null; role: string; }

/**
 * supabase-js's `auth` surface, reduced to what this repo actually calls and
 * re-implemented over our own token. There is no session to refresh, because a
 * session is now a signed cookie with an expiry and nothing else (spec §6).
 */
export function createAuthShim(readCookie: (name: string) => string | undefined) {
  async function claims(): Promise<Claims | null> {
    return verifySessionToken(readCookie(SESSION_COOKIE));
  }
  const user = async (): Promise<ShimUser | null> => {
    const c = await claims();
    if (!c || c.role === "anon") return null;
    return { id: c.sub, email: null, role: c.role };
  };
  return {
    async getUser(_jwt?: string) {
      return { data: { user: await user() }, error: null };
    },
    async getSession() {
      const u = await user();
      const c = await claims();
      return {
        data: { session: u ? { user: u, access_token: c ? `${c.iat}` : null } : null },
        error: null,
      };
    },
    async signOut() {
      return { data: { url: null }, error: null };
    },
  };
}

export type AuthShim = ReturnType<typeof createAuthShim>;
```

`email` is `null` on purpose: nothing may trust a claim for identity, and every consumer already re-reads `user_profiles` (Task 14). Grepping for `.auth.getUser()` consumers that then read `user.email` off the *user* rather than the profile is a required step here — if one exists, make it read the profile instead of inventing an email claim.

- [ ] **Step 6: Re-point `src/lib/supabase/server.ts`** — keep the export name, replace the body, and read the cookie jar for the bearer.

```ts
import { cookies } from "next/headers";
import { createRestClient } from "@/lib/rest/client";
import { createAuthShim } from "@/lib/rest/auth-shim";

/**
 * The one seam. 129 call sites construct this per request; none of them knows
 * that PostgREST is now ours. Returns the same `{ from, rpc, auth }` shape the
 * supabase-js client did, which is why the port is a re-point rather than a
 * rewrite (spec §6).
 */
export async function createSupabaseServerClient() {
  const jar = await cookies();
  const token = jar.get("sdg_session")?.value ?? null;
  const base = process.env.SUPABASE_REST_BASE;
  if (!base) {
    throw new Error("SUPABASE_REST_BASE is not set. Locally: http://localhost:54321/rest/v1");
  }
  return {
    ...createRestClient({ baseUrl: base, token }),
    auth: createAuthShim((name) => jar.get(name)?.value),
  };
}
```

The cookie name `sdg_session` is the constant Task 12 defines in `src/lib/auth/cookies.ts`; import it from there rather than repeating the literal in five files.

- [ ] **Step 7: Re-point the other two server factories**, or the port is decorative. `createSupabaseServerClient` reaching the local stack means nothing while 23 files still reach the vendor through `getSupabaseServiceClient()` and 6 more through `getSupabaseAnonClient()` — the service client in particular writes candidate records, drains the WhatsApp queue and reads the tracking codes, so leaving it on the vendor would split every flow down the middle.

`src/lib/supabase/service.ts` becomes:

```ts
import { createRestClient, type RestClient } from "@/lib/rest/client";
import { mintServiceToken } from "@/lib/auth/token";

let serviceClient: RestClient | null = null;

/**
 * Service-role client. BYPASSES Row Level Security via `bypassrls`.
 * Server-side only — never import from a client component.
 *
 * The bearer is a short-lived token signed here with `AUTH_JWT_SECRET`, so it
 * carries no long-lived secret to leak; PostgREST maps its `role` claim to the
 * `service_role` database role.
 */
export function getSupabaseServiceClient(): RestClient {
  if (!serviceClient) {
    const base = process.env.SUPABASE_REST_BASE;
    if (!base) {
      throw new Error("[supabase] SUPABASE_REST_BASE is not set — run the local stack (Tasks 1-2).");
    }
    serviceClient = createRestClient({ baseUrl: base, token: mintServiceToken(60) });
  }
  return serviceClient;
}
```

Then read every one of the 23 call sites and confirm none of them expects a *singleton that outlives 60 seconds*. A module-global client holding a 60 s token is a bug: a page rendered at the 61st second would send an expired bearer and get a 401 that looks like an RLS failure. So either re-mint per call — `token: await mintServiceToken(60)` inside a `createServiceClient()` factory that replaces the global — or hold the global and give the token an hour. **Choose the per-call factory**, because the rest client is a plain object with no socket pool and there is nothing to reuse; delete `serviceClient` entirely:

```ts
export async function getSupabaseServiceClient(): Promise<RestClient> {
  const base = process.env.SUPABASE_REST_BASE;
  if (!base) throw new Error("[supabase] SUPABASE_REST_BASE is not set — run the local stack (Tasks 1-2).");
  return createRestClient({ baseUrl: base, token: await mintServiceToken(600) });
}
```

That changes the call shape from `getSupabaseServiceClient()` to `await getSupabaseServiceClient()` at all 23 sites — 23 edits, each one word, in files that include the candidate portal's `trackApplication`. Do them mechanically, and let `tsc` in Step 9 find any you missed; a missing `await` on a `Promise` is a type error here, not a silent bug.

`src/lib/supabase/anon.ts` keeps its whole doc comment — the `jobs_public_read` reasoning is still exactly why a tokenless read is safe to prerender — and replaces the body with `createRestClient({ baseUrl, token: null })`. **Delete the mock-client branch** (`anon.ts:31-40`), which today silently returns empty data during a build with no credentials. Without the vendor there is no "no credentials" state that is worth supporting: the base URL is a local container, and the build now genuinely requires the stack to be up. That is a real consequence of this migration, not a regression — say so in the commit body, because it means `npm run build` on a machine with no `docker compose up` will now fail loudly where it used to produce a quietly empty careers page.

- [ ] **Step 8: Prove the builder against the running stack** (this is the first time app code and PostgREST meet):

```bash
node --experimental-strip-types scripts/prove-rest-builder.mjs
node --input-type=module -e "
process.env.SUPABASE_REST_BASE='http://localhost:54321/rest/v1';
const fs=await import('node:fs');
process.env.AUTH_JWT_SECRET=fs.readFileSync('docker/.env','utf8').match(/^AUTH_JWT_SECRET=(.+?)\r?$/m)[1];
const { createRestClient } = await import('./src/lib/rest/client.ts');
const { mintSessionToken } = await import('./src/lib/auth/token.ts');
const token = await mintSessionToken({ sub:'11111111-1111-1111-1111-111111111111', role:'authenticated' });
const api = createRestClient({ baseUrl: process.env.SUPABASE_REST_BASE, token });
const r = await api.from('user_profiles').select('id, role');
console.log('rows', Array.isArray(r.data) ? r.data.length : r.data, 'error', r.error?.message ?? null);
const c = await api.from('user_profiles').select('*', { count: 'exact', head: true });
console.log('count', c.count);
" --experimental-strip-types
```

Expected: `rows 3 error null` (Task 6 seeded three profiles and this token's role is `authenticated`, so `is_staff()` must admit them — note this row count depends on `is_staff()` being `SECURITY DEFINER`; if it is `0` with no error, that function is no longer bypassing RLS), then `count 3`.

- [ ] **Step 9: Typecheck, lint, and run the whole repo's gates** — 129 call sites now resolve to a new type and the 23 service sites gained an `await`, so this is the first gate that will actually complain:

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Expect real fallout, and fix it at the *builder*, not at the call sites: a chain the builder does not support is a missing method, not a bug in the caller. Record in the commit body how many distinct call-site errors appeared and which methods you had to add. If a method outside the measured 24 shows up, your measurement was wrong — re-run the greps and update Slice C's preamble table.

- [ ] **Step 10: Commit.**

```bash
git add src/lib/rest src/lib/supabase/server.ts src/lib/supabase/service.ts src/lib/supabase/anon.ts
git add -u src
git commit -m "feat(rest): serve the 442 query chains from our own PostgREST client"
```

Body: the tsc error count you started with and ended with, any builder method you had to add beyond the measured 24, the 23 `await getSupabaseServiceClient()` edits, and the deliberate removal of `anon.ts`'s credential-free mock — with the consequence that `npm run build` now requires the local stack.

---

## Slice D — the door: cookies, sign-in, sign-out, and the idle window

The vendor's auth service did four things for this app: checked a password, issued a JWT, kept that JWT in a cookie jar the browser could not read, and refreshed it. Tasks 8–11 built the JWT and the password check. This slice wires them to the door, and in doing so removes the last thing the browser used to talk to Supabase about.

**The one design change worth stating before it surprises anyone.** [src/app/login/LoginForm.tsx:31-35](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/login/LoginForm.tsx#L31-L35) calls `signInWithPassword` *from the browser*, and [src/modules/analytics/presentation/SignOutButton.tsx:25](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/analytics/presentation/SignOutButton.tsx#L25) calls `signOut()` there too. That is possible only because gotrue is a public HTTP endpoint. On the local stack **there is no browser-reachable auth endpoint on purpose** — `rest` publishes no port (Task 2) and the gateway answers only `/rest/v1`, which cannot verify a password. So sign-in becomes a Server Action that runs on the Next server, and the cookie becomes `httpOnly`, which is strictly better than what the vendor gave us: today the browser jar holds `sb-…` tokens that any XSS on the portal could read.

The cost: the password crosses to the server as form data over the app's own origin, and the sign-in form can no longer show gotrue's specific error strings. Three reasons are enough (`wrong_password`, `unknown_user`, `banned`), and the copy is written in Step 4.

### Task 12: Session cookies and the sign-in action

**Files:**
- Create: `src/lib/auth/cookies.ts`
- Create: `src/app/login/actions.ts`
- Modify: `src/app/login/LoginForm.tsx`
- Modify: `src/modules/analytics/presentation/SignOutButton.tsx`
- Delete: nothing yet — `src/lib/supabase/client.ts` loses its last importers here and is removed in Task 17.

**Interfaces:**
- Consumes: `verifyStaffPassword(email, password)` from Task 9, returning `{ ok: true, userId } | { ok: false, reason: "unknown_user" | "wrong_password" | "banned" }`; `mintSessionToken({ sub, role }, ttlSeconds?)` from Task 8 — the optional TTL exists precisely so this file can pass `SESSION_TTL_SECONDS` instead of inheriting the token's 900-second default.
- Produces: `SESSION_COOKIE` / `LAST_ACTIVE_COOKIE` constants; `startSession(userId)` and `endSession()` — the Server-Action-side pair that writes through `next/headers`. Task 13 adds the proxy-side pair, `writeSession(response, userId)` / `clearSession(response)`, to this same file. Also the server actions `signInAction(formData)` and `signOutAction()`. Task 11 Step 6's `server.ts` import of `SESSION_COOKIE` is what makes this task and that one a pair — if you execute them out of order, Task 11's `tsc` gate fails on the missing constant, which is the correct failure.

- [ ] **Step 1: Write `src/lib/auth/cookies.ts`.**

```ts
import { cookies } from "next/headers";
import { mintSessionToken } from "@/lib/auth/token";

/** The signed session bearer. httpOnly, so no script on any page can read it. */
export const SESSION_COOKIE = "sdg_session";

/** When this browser last touched a staff page. Read by the proxy's idle timeout. */
export const LAST_ACTIVE_COOKIE = "sdg_staff_last_active";

/**
 * Session lifetime in seconds, used for the bearer's `exp` and the cookie's
 * `maxAge` together.
 *
 * They must be equal: a cookie that outlives its bearer reads as "signed in"
 * while every query 401s, and a bearer that outlives its cookie is unreachable.
 * One hour rather than Task 8's 15-minute default because the proxy re-mints on
 * every staff request (Task 13), so this is the ceiling on an *idle* gap, not on
 * a session's length — the idle ceiling staff can actually configure is
 * `security.session_timeout_minutes`, whose seeded default is 480. A 15-minute
 * bearer would silently sign out an unread dashboard tab every quarter-hour
 * regardless of that setting.
 */
const SESSION_TTL_SECONDS = 3600;

function cookieAttributes() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    // Locally this is http://localhost and the flag would make the cookie
    // unsendable; production terminates TLS at the gateway (Plan 2) and sets it.
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function startSession(userId: string): Promise<void> {
  const jar = await cookies();
  const token = await mintSessionToken({ sub: userId, role: "authenticated" }, SESSION_TTL_SECONDS);
  jar.set(SESSION_COOKIE, token, cookieAttributes());
  // Stamp activity at the door so the first portal request after sign-in is not
  // itself judged as an idle one.
  jar.set(LAST_ACTIVE_COOKIE, String(Date.now()), cookieAttributes());
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(LAST_ACTIVE_COOKIE);
}
```

That is the whole file for now — two writers, not three. The renewal the proxy needs is `writeSession`, which Task 13 adds here: the proxy cannot call `cookies()` at all, so a `next/headers`-based `renewSession` would be dead code the moment it was written, and dead code in the identity spine is worse than missing code.

Neither setter takes an email: `SessionUser.email` already comes from `user_profiles`, and a parameter the function discards would misdescribe the interface. Both writes share the one `cookieAttributes()` object because the idle stamp must expire exactly when the bearer does — a `LAST_ACTIVE` cookie that outlives the session reads as "active" to the next person who signs in at that address. The app owns exactly these two cookie names, so `endSession` deletes exactly these two; sweeping other names "just in case" would delete a cookie Plan 2 has not invented yet.

- [ ] **Step 2: Write the sign-in action**, `src/app/login/actions.ts`. It must be `"use server"` with **async function exports only** — a synchronous export in that file is a build failure in Next 16, and the isolated-build probe in Task 18 is what catches it.

```ts
"use server";

import { endSession, startSession } from "@/lib/auth/cookies";
import { verifyStaffPassword } from "@/lib/auth/passwords";

export interface SignInState {
  ok: boolean;
  error?: string;
  next?: string;
}

/**
 * Brute-force floor.
 *
 * An in-process counter is enough here and nothing more: the app runs as one
 * container, bcrypt at cost 10 makes each attempt ~250 ms, and the vendor's
 * rate limiter is gone the moment we cut over. If this app is ever run as
 * several replicas, this map stops being authoritative and belongs in the
 * database — that is a Plan 2 concern, not a reason to build one now.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const failures = new Map<string, { count: number; firstAt: number }>();

function throttled(key: string): boolean {
  const hit = failures.get(key);
  if (!hit) return false;
  if (Date.now() - hit.firstAt > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return hit.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const hit = failures.get(key);
  if (!hit || Date.now() - hit.firstAt > WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  failures.set(key, { count: hit.count + 1, firstAt: hit.firstAt });
}

/** Same-origin relative targets only; mirrors LoginForm's existing guard. */
function safeRedirectTarget(raw: unknown): string {
  if (typeof raw !== "string") return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

export async function signInAction(formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeRedirectTarget(formData.get("next"));

  if (!email || !password) {
    return { ok: false, error: "Enter your work email and password." };
  }
  if (throttled(email)) {
    return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
  }

  const result = await verifyStaffPassword(email, password);
  if (!result.ok) {
    recordFailure(email);
    await endSession();
    return {
      ok: false,
      error:
        result.reason === "banned"
          ? "This account is disabled. Ask a super admin to re-enable it."
          : "That email and password do not match our records.",
    };
  }

  failures.delete(email);
  await startSession(result.userId);
  return { ok: true, next };
}
```

The `unknown_user` / `wrong_password` reasons collapse into one sentence on purpose: the page must not tell a stranger whether an address has an account. Task 9's dummy-hash compare is what makes that sentence true rather than decorative.

- [ ] **Step 3: Add the sign-out action** to the same file:

```ts
export async function signOutAction(): Promise<void> {
  await endSession();
}
```

- [ ] **Step 4: Rewrite `LoginForm.tsx`** to post to the action instead of calling the browser client.

```tsx
"use client";

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { SdgMark } from "@/modules/analytics/presentation/BrandLogo";
import { signInAction, type SignInState } from "./actions";

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const idleSignOut = searchParams.get("reason") === "idle";

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    data.set("next", next);
    startTransition(async () => {
      const result: SignInState = await signInAction(data);
      if (result.ok) {
        window.location.assign(result.next ?? "/dashboard");
        return;
      }
      setError(result.error ?? "Sign-in failed.");
    });
  }
```

Keep the entire presentational tree (lines 49–155) exactly as it is — the two `aria` roles, the field markup, the candidate-portal link at the foot. Only `handleEmailPassword` changes, plus the `busy` state becomes `pending` from `useTransition`, and the import of `getSupabaseBrowserClient` is deleted. `window.location.assign` stays (rather than `router.push`) because after a session starts the whole page tree must re-render against the new bearer, and a client-side navigation would reuse the components that were rendered as signed out.

Re-add the `useState` import that the snippet omits, and keep `safeRedirectTarget` — move it from `LoginForm.tsx` into `actions.ts`, which is where it now earns its keep, since a server-side redirect target is a bigger deal than a client-side one.

- [ ] **Step 5: Rewrite `SignOutButton.tsx`'s handler** to the action:

```tsx
import { signOutAction } from "@/app/login/actions";

async function handleSignOut() {
  await signOutAction();
  startTransition(() => router.push("/login"));
  router.refresh();
}
```

and delete the `getSupabaseBrowserClient` import. Then confirm the browser factory is orphaned:

```bash
grep -rln "getSupabaseBrowserClient" src
```

Expected: only `src/lib/supabase/client.ts` — its own definition. That is the fact Task 17's deletion rests on.

- [ ] **Step 6: Typecheck and lint.**

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/app/login src/modules/analytics/presentation/SignOutButton.tsx src/lib/auth
node scripts/check-staff-routes.mjs
```

- [ ] **Step 7: Commit.**

```bash
git add src/lib/auth/cookies.ts src/app/login src/modules/analytics/presentation/SignOutButton.tsx
git commit -m "feat(auth): sign staff in through a server action and an httpOnly cookie"
```

Body: the reason the browser can no longer sign in (no browser-reachable auth endpoint by design), the `httpOnly` upgrade over the old `sb-` jar, the throttle's stated limits, and the collapsed error copy.

### Task 13: The idle window, ported into the Next 16 proxy

[src/lib/supabase/middleware.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/lib/supabase/middleware.ts) is 171 lines that do five things, and exactly one of them needs the vendor: `createServerClient(...)` + `supabase.auth.getUser()` is a **network round trip on every matched request** whose only answer is "is this JWT valid". [src/lib/auth/token.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/lib/auth/token.ts) from Task 8 answers that locally with an HMAC compare, so the port is a downgrade in latency and an upgrade in behaviour. Everything else in the file — the staff-path redirect, the role check, the timeout read, the idle sign-out, the `sb-` jar cleanup — moves unchanged.

**Files:**
- Create: `src/lib/auth/guard.ts`
- Modify: `src/lib/auth/cookies.ts` (add the proxy-side writers)
- Modify: `src/proxy.ts` (whole body)
- Delete: `src/lib/supabase/middleware.ts`

**Interfaces:**
- Consumes: `verifySessionToken(token)` from Task 8, `SESSION_COOKIE` / `LAST_ACTIVE_COOKIE` / `cookieAttributes()` / `SESSION_TTL_SECONDS` from Task 12 (all module-local in `cookies.ts`, which is why the writers land in the same file), `isStaffPath()` / `loginSearch()` which stay where they are, `coerceNumber` from `@/modules/settings/infrastructure/settingsReader`.
- Produces: `guardRequest(request: NextRequest): Promise<NextResponse>` — the only thing `src/proxy.ts` calls — plus `writeSession(response, userId)` and `clearSession(response)` on `src/lib/auth/cookies.ts`. Task 15's browser proof and Task 18's acceptance both drive `guardRequest`.

- [ ] **Step 1: Add the proxy-side cookie writers** to `src/lib/auth/cookies.ts`. This is the half Task 12 deliberately left unwritten, and the reason is worth knowing before it confuses you: the proxy is not allowed to mutate `next/headers`' cookie store. It reads `request.cookies` and returns a `NextResponse`, so the only cookie it can set is one on that response object. Hence two shapes of the same contract. Add the `NextResponse` import to the file's existing import block — `mintSessionToken` is already imported there by Task 12, and a duplicate import is a lint error, not a style choice:

```ts
import { NextResponse } from "next/server";

/** Set the bearer and stamp activity on a response the proxy is about to return. */
export async function writeSession(
  response: NextResponse,
  userId: string,
): Promise<void> {
  const token = await mintSessionToken({ sub: userId, role: "authenticated" }, SESSION_TTL_SECONDS);
  response.cookies.set(SESSION_COOKIE, token, cookieAttributes());
  response.cookies.set(LAST_ACTIVE_COOKIE, String(Date.now()), cookieAttributes());
}

/** Drop both, on any response — including the redirect the idle timeout returns. */
export function clearSession(response: NextResponse): void {
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(LAST_ACTIVE_COOKIE);
}
```

`startSession` / `endSession` (Server Action side, `next/headers`) and `writeSession` / `clearSession` (proxy side, `NextResponse`) must stay in one file. The moment they are two files, one of them drifts its attributes and a recruiter's session survives in one path but not the other — which is the kind of bug that reads as "signs out randomly on some pages".

- [ ] **Step 2: Write `src/lib/auth/guard.ts`.** The structure, comments, and constants below are the ones the current file earned through live proofs (task #39 proved the idle sign-out end-to-end); keep them.

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createRestClient } from "@/lib/rest/client";
import { verifySessionToken } from "@/lib/auth/token";
import {
  LAST_ACTIVE_COOKIE,
  SESSION_COOKIE,
  clearSession,
  writeSession,
} from "@/lib/auth/cookies";
import { loginSearch } from "@/lib/auth/login-target";
import { isStaffPath } from "@/lib/auth/staffRoutes";
import { coerceNumber } from "@/modules/settings/infrastructure/settingsReader";

const STAFF_ROLES = new Set(["SUPER_ADMIN", "RECRUITER", "HIRING_MANAGER"]);

/** `security.session_timeout_minutes` fallback, matching the seeded row. */
const DEFAULT_SESSION_TIMEOUT_MINUTES = 480;

/** How long the proxy remembers the idle window between requests. */
const TIMEOUT_MEMO_MS = 60_000;

let timeoutMemo: { minutes: number; readAt: number } | null = null;

function restBaseUrl(): string {
  const base = process.env.SUPABASE_REST_BASE;
  if (!base) throw new Error("[guard] SUPABASE_REST_BASE is not set.");
  return base;
}

/**
 * The configured idle window in minutes.
 *
 * `app_settings_read` grants SELECT to `is_staff()`, and this only runs for a
 * bearer whose role claim is `authenticated`, so the read is made with that
 * same bearer — no service token is minted for a request that has not earned one.
 */
async function getSessionTimeoutMinutes(token: string): Promise<number> {
  const now = Date.now();
  if (timeoutMemo && now - timeoutMemo.readAt < TIMEOUT_MEMO_MS) return timeoutMemo.minutes;

  const api = createRestClient({ baseUrl: restBaseUrl(), token });
  const { data, error } = await api
    .from("app_settings")
    .select("value")
    .eq("scope", "GLOBAL")
    .eq("key", "security.session_timeout_minutes")
    .maybeSingle();

  const minutes = coerceNumber(data?.value, DEFAULT_SESSION_TIMEOUT_MINUTES);
  // A read that failed is not remembered, so a database hiccup cannot pin the
  // shipped default for the next minute.
  if (!error) timeoutMemo = { minutes, readAt: now };
  return minutes;
}

export async function guardRequest(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const wanted = pathname + search;

  const bearer = request.cookies.get(SESSION_COOKIE)?.value;
  // Local HMAC verify — this replaced a network call to the auth service.
  const claims = bearer ? await verifySessionToken(bearer) : null;

  if (isStaffPath(pathname) && !claims) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = loginSearch(wanted);
    return NextResponse.redirect(loginUrl);
  }

  // `!bearer` cannot be true when `claims` is set — the compiler just cannot see
  // the link, and this is the one place worth spelling it out rather than using a
  // non-null assertion, because a stale bearer is exactly what a 401 looks like.
  if (!claims || !bearer || !isStaffPath(pathname)) {
    return NextResponse.next({ request: { headers: request.headers } });
  }

  const api = createRestClient({ baseUrl: restBaseUrl(), token: bearer });

  // A signed-in candidate must never see recruiter analytics.
  const { data: profile } = await api
    .from("user_profiles")
    .select("role")
    .eq("auth_user_id", claims.sub)
    .maybeSingle();

  if (profile && !STAFF_ROLES.has(profile.role)) {
    const portalUrl = request.nextUrl.clone();
    portalUrl.pathname = "/portal";
    portalUrl.search = "?denied=staff-only";
    return NextResponse.redirect(portalUrl);
  }

  // Settings → Security → Session timeout. A staff session that has not touched
  // the portal for longer than the window is dropped here rather than in a
  // client timer, so closing a tab or locking a machine cannot keep it alive.
  const timeoutMinutes = await getSessionTimeoutMinutes(bearer);
  const now = Date.now();
  const lastActive = Number(request.cookies.get(LAST_ACTIVE_COOKIE)?.value);

  if (
    timeoutMinutes > 0 &&
    Number.isFinite(lastActive) &&
    lastActive > 0 &&
    now - lastActive > timeoutMinutes * 60_000
  ) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = loginSearch(wanted, "idle");
    const signedOut = NextResponse.redirect(loginUrl);
    // Clearing the cookies is a local sign-out: this browser loses the session
    // while any other device the staff member uses keeps theirs.
    clearSession(signedOut);
    return signedOut;
  }

  const response = NextResponse.next({ request: { headers: request.headers } });
  await writeSession(response, claims.sub);
  return response;
}
```

Three differences from the file it replaces, and each is deliberate:

1. There is no `sb-` prefix loop any more. `clearSession` deletes the two cookies this app owns, because those are the only two it sets. Deleting other names "just in case" would delete a cookie Plan 2 has not invented yet.
2. It **renewal-writes on every staff request**, which the old file could not do — the vendor's token was refreshed inside `getUser()`, and here the bearer is re-minted with a fresh `exp`. This is what keeps a working recruiter signed in past the bearer's own hour.
3. `profile && !STAFF_ROLES.has(...)` keeps the current file's odd-but-correct shape: a **missing profile row does not redirect here**, it falls through to the page-level `requireStaff`, which is the guard that has the redirect-with-context. "No profile" and "wrong role" are different failures and only one of them is a candidate poking at the portal.

- [ ] **Step 3: Re-point `src/proxy.ts`** — keep the matcher and the file, change the import:

```ts
import { type NextRequest } from "next/server";
import { guardRequest } from "@/lib/auth/guard";

/**
 * Runs before every matched request to verify the session bearer, refresh the
 * idle stamp, and gate the recruiter portal. Named `proxy` per the Next.js 16
 * convention (replaces the deprecated `middleware` file convention).
 */
export async function proxy(request: NextRequest) {
  return guardRequest(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
```

- [ ] **Step 4: Delete the old file** and confirm nothing still reaches for it:

```bash
git rm src/lib/supabase/middleware.ts
grep -rn "supabase/middleware\|updateSession" src scripts
grep -rn "@supabase/ssr" src
```

Expected: the first two greps silent; the third returns only `src/lib/supabase/client.ts` (the browser factory, orphaned in Task 12 — it dies in Task 17).

- [ ] **Step 5: Gates.**

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/proxy.ts src/lib/auth
node scripts/check-staff-routes.mjs
node scripts/check-themes.mjs
```

- [ ] **Step 6: Commit.**

```bash
git add src/lib/auth/guard.ts src/lib/auth/cookies.ts src/proxy.ts
git commit -m "feat(auth): verify staff sessions in the proxy without a network round trip"
```

Body: the three deliberate differences listed in Step 2, and the fact that the `timeoutMemo` was ported verbatim rather than "improved" (spec correction #5).

### Task 14: The session read, and the admin surface the Team console needs

Two things still assume the vendor after Task 13: [src/lib/auth/session.ts:37-49](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/lib/auth/session.ts#L37-L49) resolves the signed-in staff member through `supabase.auth.getUser()`, and [src/modules/settings/application/user-actions.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts) drives the entire Team console through `supabase.auth.admin.*` — **13 call sites, all in that one file**, measured as `listUsers` ×5, `updateUserById` ×5, `deleteUser` ×2, `createUser` ×1. Those are the staff create / deactivate / password-reset / edit actions built in tasks #52 and #182–#184, and without an equivalent the Team console is a page of buttons that throw.

The admin surface is *not* a PostgREST problem — `auth` is deliberately outside `PGRST_DB_SCHEMAS` (Task 2), so no HTTP route may reach `auth.users`. It is a `pg` problem: the same pool Task 9 opened can read and write that table as the superuser. That is why the shim sits on the pool and not on the builder.

**Files:**
- Modify: `src/lib/auth/session.ts`
- Create: `src/lib/auth/admin-users.ts`
- Modify: `src/lib/rest/auth-shim.ts` (add `admin`)
- Modify: `src/modules/settings/application/user-actions.ts` (type annotations only)
- Modify: the 6 other files that import `type { SupabaseClient }` — [question-actions.ts:4](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/%28admin%29/assessments/question-actions.ts#L4), `suite-authoring-actions.ts:4`, `cv-actions.ts:4`, `questions/actions.ts:4`, `changeWatch.ts:4`, `permissions.ts:5`

**Interfaces:**
- Consumes: `verifySessionToken()` (Task 8), `getPool()` (Task 9), `createRestClient()` (Task 11), the cookie jar.
- Produces: `getSessionUser()` — **unchanged signature and unchanged `cache()` wrapper** — and `authAdmin` with `listUsers({ page, perPage })`, `createUser({ email, password, email_confirm, user_metadata })`, `updateUserById(id, patch)`, `deleteUser(id)`, each returning `{ data, error }` in supabase-js's shape so the 13 sites compile without restructuring.

- [ ] **Step 1: Rewrite `getSessionUser`.** The `cache()` wrapper stays — task #327 exists precisely because one admin page asked half a dozen times and each `getUser()` was a network call. Verify is local now, but the *profile read is still a round trip*, so the wrapper still earns its keep.

```ts
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifySessionToken } from "@/lib/auth/token";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { loginSearch } from "@/lib/auth/login-target";
import type { UserRole } from "@/types";

export interface SessionUser {
  authUserId: string;
  profileId: string;
  email: string;
  fullName: string;
  role: UserRole;
  tenantId: string | null;
}

/**
 * Resolves the signed-in staff member from the request cookie jar.
 *
 * The bearer is verified locally against `AUTH_JWT_SECRET` — there is no auth
 * service to ask — and `user_profiles` is then read *through that bearer*, so
 * Row Level Security still decides whether the profile is visible. That second
 * part matters: verifying the signature proves who the caller is, not what they
 * may see, and skipping the RLS read here would hand a revoked account its old
 * role until the token aged out.
 *
 * Returns `null` when there is no session or the profile row is missing.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const bearer = jar.get(SESSION_COOKIE)?.value;
  if (!bearer) return null;

  const claims = await verifySessionToken(bearer);
  if (!claims || claims.role !== "authenticated") return null;

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, auth_user_id, full_name, email, role, tenant_id")
    .eq("auth_user_id", claims.sub)
    .maybeSingle();

  if (!profile) return null;

  return {
    authUserId: claims.sub,
    profileId: profile.id as string,
    email: (profile.email as string) ?? "",
    fullName: (profile.full_name as string) ?? "Unknown user",
    role: profile.role as UserRole,
    tenantId: (profile.tenant_id as string | null) ?? null,
  };
});
```

`STAFF_ROLES`, `isStaff`, and `requireStaff` do not change — they are role logic, not vendor logic. Note what disappeared: `user.email` as a fallback. The old code trusted a JWT claim for identity; the new code has no such claim, which is the point.

- [ ] **Step 2: Write `src/lib/auth/admin-users.ts`** — the four admin verbs over the pool. Every statement is parameterised, and password hashing is done by **pgcrypto in the database**, which is what keeps this plan dependency-free (`bcryptjs` is not added).

```ts
import "server-only";
import { getPool } from "@/lib/auth/db";

export interface AdminUserRow {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
  banned_until: string | null;
}

/** Every method answers in supabase-js's shape: exactly one of these is set. */
type Result<T> = { data: T; error: null } | { data: null; error: { message: string; code?: string } };

/** `876000h` is a century, which is what the console means by "permanent". */
function banUntil(duration: string): Date | null {
  if (duration === "none") return null;
  const hours = Number(duration.replace("h", ""));
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(Date.now() + hours * 3_600_000);
}

export const authAdmin = {
  async listUsers({ page, perPage }: { page: number; perPage: number }): Promise<Result<{ users: AdminUserRow[] }>> {
    const offset = (Math.max(1, page) - 1) * perPage;
    const { rows, error } = await run(
      `select id, email, raw_user_meta_data as user_metadata, banned_until
         from auth.users order by created_at limit $1 offset $2`,
      [perPage, offset],
    );
    if (error) return { data: null, error };
    return { data: { users: rows as AdminUserRow[] }, error: null };
  },

  async createUser(input: {
    email: string;
    password: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
  }): Promise<Result<{ user: { id: string } }>> {
    const { rows, error } = await run(
      `insert into auth.users
         (aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
       values ('authenticated', 'authenticated', lower($1), crypt($2, gen_salt('bf', 10)),
               case when $3 then now() else null end, $4::jsonb, now(), now())
       returning id`,
      [input.email, input.password, input.email_confirm ?? false, JSON.stringify(input.user_metadata ?? {})],
    );
    if (error) return { data: null, error };
    return { data: { user: rows[0] }, error: null };
  },

  async updateUserById(
    id: string,
    patch: { email?: string; password?: string; ban_duration?: string; user_metadata?: Record<string, unknown> },
  ): Promise<Result<null>> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.email) {
      values.push(patch.email.toLowerCase());
      sets.push(`email = $${values.length}`);
    }
    if (patch.password) {
      values.push(patch.password);
      sets.push(`encrypted_password = crypt($${values.length}, gen_salt('bf', 10))`);
    }
    if (patch.ban_duration !== undefined) {
      values.push(banUntil(patch.ban_duration));
      sets.push(`banned_until = $${values.length}`);
    }
    if (patch.user_metadata) {
      values.push(JSON.stringify(patch.user_metadata));
      sets.push(`raw_user_meta_data = $${values.length}::jsonb`);
    }
    if (sets.length === 0) return { data: { user: null }, error: null };

    values.push(id);
    sets.push("updated_at = now()");
    const { error } = await run(
      `update auth.users set ${sets.join(", ")} where id = $${values.length}::uuid`,
      values,
    );
    if (error) return { data: null, error };
    return { data: null, error: null };
  },

  async deleteUser(id: string): Promise<Result<null>> {
    const { error } = await run(`delete from auth.users where id = $1::uuid`, [id]);
    if (error) return { data: null, error };
    return { data: null, error: null };
  },
};

async function run(text: string, values: unknown[]) {
  try {
    return { rows: (await getPool().query(text, values)).rows, error: null };
  } catch (cause) {
    const e = cause as { message?: string; code?: string };
    return { rows: [], error: { message: e.message ?? "Database error", code: e.code } };
  }
}
```

The `23505` unique-violation code survives this path untouched: `run` forwards Postgres' own `code`, and [user-actions.ts:230-234](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L230-L234) branches on exactly that to say "That email is already in use." Do not flatten it into a string.

The `sets` fragments in `updateUserById` are the only place in this file where SQL is assembled rather than written: each pushed string is a literal column assignment, and every value still travels as a `$n` parameter. Keep it that way — a caller-supplied column name here would be the injection this whole file exists to avoid.

- [ ] **Step 3: Attach it to the shim** so the 13 sites keep compiling. In `src/lib/rest/auth-shim.ts`, add `admin: authAdmin` to the returned object and import it. That is the whole step — and it is why the shim exists rather than a rewrite of `user-actions.ts`.

- [ ] **Step 4: Swap the type annotations.** In all 7 files, replace

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
```

with

```ts
import type { RestClient } from "@/lib/rest/client";
```

and every `supabase: SupabaseClient` parameter with `supabase: RestClient`. Then check none were left:

```bash
grep -rn "SupabaseClient" src | grep -v "app/(candidate)"
```

Expected: empty. `src/app/(candidate)/portal/actions.ts` is allowed to still import `createClient` from `@supabase/supabase-js` — it is the owner's off-limits file, and the consequence is spec correction #6: the package stays installed through Plan 1.

- [ ] **Step 5: Gates**, then the live proof in Task 15.

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/lib/auth src/lib/rest src/modules/settings
node scripts/check-staff-routes.mjs
```

- [ ] **Step 6: Commit.**

```bash
git add src/lib/auth src/lib/rest/auth-shim.ts src/modules/settings/application/user-actions.ts
git add -u src
git commit -m "feat(auth): resolve staff sessions and team CRUD without an auth service"
```

Body: the 13 admin sites with the verb each one uses, the `23505` code forwarding, the `user.email` claim fallback that was deliberately dropped, and the fact that `getSessionUser` kept its `cache()` wrapper on purpose (task #327).

---

### Task 15: Prove the spine end to end in a browser

Nothing in Tasks 12–14 is believed until a person signs in. This is the task where the owner's rule applies in full: **no browser proof happens against the dev server on port 3001** — this plan's dev server runs on **3000**, which the owner chose, and it must be started fresh for this task rather than reused.

**Files:** none. This task changes no code; it either proves the spine or sends you back to fix it.

**Interfaces:**
- Consumes: the running stack (Tasks 1–2), seeded staff (Task 6), the local REST base (Tasks 11–13), a dev server on 3000.
- Produces: the evidence block for the commit, and the go/no-go for Slice D.

- [ ] **Step 1: Give the app the two values the stack owns.** Append to `.env.local` (never commit these; the same secrets already live in `docker/.env`):

```
SUPABASE_REST_BASE=http://localhost:54321/rest/v1
AUTH_JWT_SECRET=<the docker/.env value, copied not printed>
APP_URL=http://localhost:3000
```

`APP_URL` matters beyond cosmetics: task #313 made assessment links use the host the app actually runs on, so a stale `3001` here would send a candidate to a port nothing listens on.

- [ ] **Step 2: Start the dev server on 3000** in its own terminal, and leave the owner's 3001 server alone:

```bash
./node_modules/.bin/next dev -p 3000
```

- [ ] **Step 3: Sign in as the recruiter fixture** in the browser, at `http://localhost:3000/login`, and confirm in DevTools → Application → Cookies that `sdg_session` exists with **HttpOnly** and `SameSite=Lax`, and that **no `sb-` cookie was created**. A jar still carrying `sb-` names means the old middleware is somehow still in the chain.

- [ ] **Step 4: Walk the portal** — `/dashboard`, `/candidates`, `/jobs`, `/settings`, `/team`. Each must render real rows. Then prove the identity actually reached Postgres: open `/activity`, and confirm a trail row written by this session names *this* user (that is `auth.uid()` resolving through `request.jwt.claims ->> 'sub'` — correction #2 — and it is the single check that distinguishes "policies parse" from "policies evaluate").

- [ ] **Step 5: Exercise the Team console**, because Task 14's admin shim is otherwise unproven: create a staff account, deactivate it, reset its password, edit its name, delete it. Every one of those is a different `authAdmin` verb, and the create path is the only place `23505` matters — create a second account with the same email and confirm the message is "That email is already in use." rather than a raw constraint dump.

- [ ] **Step 6: Prove the idle sign-out for real.** Settings → Security → session timeout, set it to the smallest value the field accepts, wait past it with the tab open but untouched, then click any link. Expected: `/login?…&reason=idle` with the "signed out after a period of inactivity" band visible, and both cookies gone from the jar. Then restore the timeout to 480 so the owner's next session is not short.

- [ ] **Step 7: Prove the sign-in refusals.** Wrong password on a real address → the generic sentence. Password on an unlisted address → the *same* sentence, which is the enumeration oracle closed. Then eight bad attempts in a row → the throttle message.

- [ ] **Step 8: Confirm the candidate surfaces still work, without touching them.** Load `/careers`, apply to nothing, and open `/portal` with a tracking code that exists. This is a read-only check on the owner's off-limits portal; if it is broken, stop and report rather than editing it.

- [ ] **Step 9: Record what you saw.** In the commit body for the next task, list each step above with what the browser actually showed. Where a proof was not run — a step skipped because a fixture does not exist, a check that could not be made — say so in those words. Task 18's acceptance sweep reads this list.

---

## Slice E — what actually runs it

### Task 16: The scheduler that has never existed

This is the task the migration forces rather than the one it defers, and it is the top risk on the record. [docs/STATUS-2026-10-20.md:135](file:///D:/Nextjs%20Projects/sharm_dreams_group/docs/STATUS-2026-10-20.md) states it in one line: **"The two routes nothing schedules."** Verified against the tree, not from memory:

```bash
ls vercel.json
grep -rn "pg_cron\|cron\.schedule" supabase/ | wc -l
```

There is no `vercel.json` at all, and no `pg_cron` job anywhere in `supabase/`. So `/api/cron/whatsapp` — which drains the queue that every stage-change notice is written to — and `/api/cron/grading` — which re-grades attempts left unscored during a provider outage — have been reachable only by hand. On Vercel nothing called them; on the vendor's side nothing calls them either. **Scheduled WhatsApp messages have never been delivered on their own, and stuck attempts have never cleared themselves.** Self-hosting does not fix that by itself; it is the first time this app can own a clock.

**Files:**
- Create: `docker/cron/Dockerfile`
- Create: `docker/cron/run.sh`
- Modify: `docker/docker-compose.yml` (add the `cron` service)
- Modify: `docker/.env.example` (add `CRON_SECRET`, batch sizes, intervals)

**Interfaces:**
- Consumes: `CRON_SECRET` shared between the app and this container, the two route handlers' existing contract: `x-cron-secret` header, GET or POST, `503` when the app has no secret, `401` when it does not match, `200` with a JSON summary.
- Produces: a container that keeps the two queues moving for as long as the stack is up. Nothing in `src/` changes.

- [ ] **Step 1: Write `docker/cron/run.sh`.** Busybox `crond` is a poor fit here — it needs a user, a spool, and a foreground flag fight. A supervised loop in the container's own PID 1 is what Compose wants:

```sh
#!/bin/sh
# Poll interval, in seconds. Both routes are idempotent sweeps, so a short
# interval costs one query and a long one delays a candidate's notice.
WHATSAPP_EVERY="${WHATSAPP_EVERY:-60}"
GRADING_EVERY="${GRADING_EVERY:-300}"
APP_URL="${APP_URL:-http://app:3000}"

hit() {
  # -f: a 4xx/5xx must be a non-zero exit so the log line says "failed".
  body=$(wget -q -O - --header="x-cron-secret: $CRON_SECRET" "$1" 2>&1) \
    && echo "[ok] $1 $body" \
    || echo "[FAIL] $1 $body"
}

if [ -z "$CRON_SECRET" ]; then
  echo "[cron] CRON_SECRET is empty — the routes answer 503, so this loop would only log failures." >&2
  echo "[cron] Set it in docker/.env to the same value the app has. Sleeping instead." >&2
  while :; do sleep 3600; done
fi

while :; do
  for tick in $(seq 1 $((WHATSAPP_EVERY))); do sleep 1; done
  hit "$APP_URL/api/cron/whatsapp"
  # Every N WhatsApp ticks, also run the re-grade sweep.
  Counter=$((Counter + 1))
  if [ $((Counter % (GRADING_EVERY / WHATSAPP_EVERY))) -eq 0 ]; then
    hit "$APP_URL/api/cron/grading"
  fi
done
```

`GRADING_EVERY / WHATSAPP_EVERY` is integer division in busybox sh, so 300/60 = 5 — the grading sweep runs every fifth tick. If you change one interval, change both or the ratio silently becomes 0 and grading runs every tick; that is why both live in `docker/.env.example` side by side with the ratio named in a comment.

- [ ] **Step 2: Write `docker/cron/Dockerfile`.**

```dockerfile
FROM alpine:3.20
RUN apk add --no-cache wget
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh
CMD ["/usr/local/bin/run.sh"]
```

Alpine's `wget` is busybox's and speaks the `--header` flag used above; `curl` would be a larger image for no benefit.

- [ ] **Step 3: Add the service** to `docker/docker-compose.yml`:

```yaml
  cron:
    build: ./cron
    environment:
      CRON_SECRET: ${CRON_SECRET}
      APP_URL: http://app:3000
      WHATSAPP_EVERY: ${WHATSAPP_EVERY:-60}
      GRADING_EVERY: ${GRADING_EVERY:-300}
    depends_on:
      app: { condition: service_started }
    restart: unless-stopped
```

Note `app` must be a service in this file for `depends_on` to resolve. Locally the app is `next dev` on this Windows host and not a container, so **add `app` as a compose profile that is off locally**:

```yaml
  app:
    image: node:24-alpine3.20
    profiles: ["full"]
    working_dir: /app
    command: ["sh", "-c", "npm ci && npm run start"]
    ports: ["${APP_PORT:-3000}:3000"]
    environment:
      NODE_ENV: production
      SUPABASE_REST_BASE: http://rest:3000
      AUTH_JWT_SECRET: ${AUTH_JWT_SECRET}
      CRON_SECRET: ${CRON_SECRET}
    volumes: [../../:/app]
```

`docker compose up` therefore runs the data plane only (what a Windows dev host wants, with `next dev` on 3000); `docker compose --profile full up` runs the whole thing, which is what KVM2 will do in Plan 2. `SUPABASE_REST_BASE` inside that service is `http://rest:3000` — on the app network the `/rest/v1` prefix is stripped by the gateway, so a container that talks to `rest` directly must not send the prefix. That single difference between the two URLs (`http://localhost:54321/rest/v1` from the host, `http://rest:3000` inside the network) is the most likely thing to be got wrong here, and `APP_URL` for `cron` points at the gateway instead: `http://app:3000` is the app, not the data plane.

- [ ] **Step 4: Prove the WhatsApp queue actually drains.** This mutates live rows on the *local* database only (never hosted), which is the whole point of the local-first decision. Get the owner's approval first if the fixture is real candidate data; with Task 6's synthetic fixtures it is not.

```bash
docker compose up -d db rest gateway
docker compose build cron
docker compose up -d cron
docker compose logs --since 2m cron
```

Expected: a `[ok] … {"sent":0,…}` line every 60 s. Then queue a job deliberately and watch it go out — use a synthetic candidate, and if the WhatsApp provider credentials in `docker/.env` are the owner's real ones, **send to the owner's own number only**, per the standing rule that no test may message a stranger.

- [ ] **Step 5: Prove the failure modes**, because a silent scheduler is exactly what this app has had all along:

```bash
# Wrong secret must be refused, not ignored.
wget -q -O - --header="x-cron-secret: wrong" http://localhost:3000/api/cron/whatsapp; echo "exit=$?"
# Missing secret on the app side must be a loud 503.
```

Expected: the first answers `{"error":"Unauthorized"}` and `exit=1` (wget's `-q` treats 4xx as failure — that is the point of `hit()`). Confirm in `docker compose logs cron` that a failure prints `[FAIL]`, not nothing.

- [ ] **Step 6: Commit.**

```bash
git add docker/cron docker/docker-compose.yml docker/.env.example
git commit -m "feat(docker): give the two cron routes the scheduler they never had"
```

Body: the `ls vercel.json` and `grep -rn "pg_cron\|cron\.schedule" supabase/` results, in those words — this commit is the first time either route has been called by anything other than a person.

---

### Task 17: Remove the vendor's scaffolding

Only after Slices A–E are green. This task deletes the things the port made redundant, and every deletion here is a claim that was proved somewhere above — the commit bodies of Tasks 11–15 are the evidence, so read them before deleting anything.

**Files:**
- Delete: `src/lib/supabase/rest.ts`, `src/lib/supabase/client.ts`
- Modify: `src/lib/config.ts`, `package.json`, `scripts/create-staff.mjs`, `.env.example`, `next.config.ts`
- Remove dependency: `@supabase/ssr` (all three importers are gone: `server.ts` in Task 11, `middleware.ts` in Task 13, `client.ts` here)
- Keep dependency: `@supabase/supabase-js` — spec correction #6, one dead fallback branch in an off-limits file
- Promote dependency: `pg` from `devDependencies` to `dependencies`

- [ ] **Step 1: Confirm each deletion is already orphaned**, and stop if any grep is not empty:

```bash
grep -rn "supabase/rest\|supabase/client\b" src scripts        # rest.ts has zero callers today; client.ts lost its last two in Task 12
grep -rn "@supabase/ssr" src scripts                            # expect empty
grep -rn "NEXT_PUBLIC_SUPABASE_ANON_KEY\|SUPABASE_SERVICE_ROLE_KEY\|SUPABASE_DB_PASSWORD" src scripts
```

The third grep is the one that will surprise you: those three names are read by `src/lib/config.ts` and by `scripts/create-staff.mjs` and `scripts/apply-schema.mjs`. The scripts keep them — they are how the *hosted* database is still reachable for the one remaining `pg_dump` (Plan 2's restore) — so `config.ts` must keep the fields too, marked as hosted-only, rather than pretending they vanished.

- [ ] **Step 2: Delete the two modules and edit `src/lib/config.ts`.**

```ts
export const supabaseConfig = {
  /** Where the app's own PostgREST answers, including the `/rest/v1` prefix. */
  restBase: optional(process.env.SUPABASE_REST_BASE),
  buckets: {
    candidateVideos: "candidate-videos",
    candidateAudio: "candidate-audio",
    resumes: "resumes",
    // Supabase's own docs and the "Track your application" copy both call this
    // bucket by name; appConfig omitting it is why a CV link reads as broken
    // rather than as unconfigured.
    candidateCvs: "candidate-cvs",
  },
} as const;
```

`projectRef`, `url`, `anonKey`, `serviceRoleKey`, `dbPassword` and `assertServer` stay for now, with a comment on each that it is **hosted-only, deleted in Plan 2** — `apply-schema.mjs` and the dump path need them. `appConfig.url`'s fallback becomes `http://localhost:3000`: [src/lib/config.ts:56](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/lib/config.ts#L56) is where a task-#313 bug was born, and an `APP_URL`-less build that hands a candidate a `3001` link is still reachable today.

- [ ] **Step 3: Fix the two hard-coded ports** the plan found by name:

```bash
grep -rn "localhost:3001" src scripts | grep -v node_modules
```

Every hit is either the `config.ts` fallback (Step 2) or a printed hint. [scripts/create-staff.mjs:106](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/create-staff.mjs#L106) prints `Sign in at http://localhost:3001/login` — change it to read `process.env.APP_URL ?? "http://localhost:3000"`, because a script that prints a URL the app no longer uses is how the next proof gets run against the wrong server.

- [ ] **Step 4: Move the dependency, then remove the other one.**

```bash
npm pkg delete devDependencies.pg
npm install --save-exact pg@8.23.1
npm uninstall @supabase/ssr
```

`--save-exact` for `pg` on purpose: this package's only job is to speak to one database that is now under our own control, and `^` invites a minor bump to break the pool on a machine that has no test runner to catch it. Confirm the install wrote both `package.json` and `package-lock.json`, and that `@supabase/supabase-js` is still present:

```bash
node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).filter(n=>n.startsWith('@supabase')||n==='pg'))"
```

Expected: `[ '@supabase/supabase-js', 'pg' ]`. If `@supabase/ssr` is still listed, Task 13's file deletion did not happen.

- [ ] **Step 5: `@vercel/speed-insights` stays.** It is a third-party script tag, not a platform binding, and removing it changes what the owner sees in analytics while nothing else is being decided. Note it as Plan 2's item, with `NEXT_PUBLIC_*` cleanup and the rest of the vendor's environment surface.

- [ ] **Step 6: Gates, then prove the orphan claim survived the build.**

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src scripts
node scripts/check-staff-routes.mjs
node scripts/check-themes.mjs
```

Then run the isolated production build per this project's standing procedure (hard-linked `node_modules` copy, never the owner's dev server): it is the only thing that proves a `"use server"` file exports nothing synchronous, which is the failure mode `src/app/login/actions.ts` can hide from `tsc`.

- [ ] **Step 7: Commit.**

```bash
git rm src/lib/supabase/rest.ts src/lib/supabase/client.ts
git add -A package.json package-lock.json src/lib/config.ts scripts/create-staff.mjs
git commit -m "chore(deps): drop @supabase/ssr and point the app at its own data plane"
```

Body: the three greps from Step 1 with their output, why `@supabase/supabase-js` and the hosted-only config fields survive (correction #6), and the isolated-build result.

---

### Task 18: Acceptance, and fixing the numbers the spec got wrong

The plan is not done when the code compiles; it is done when the claims can be checked. This task runs the whole thing once, from a clean slate, and corrects the record.

- [ ] **Step 1: Wipe and rebuild from nothing.** `docker compose down -v` (this deletes the local database — local only, never hosted), then `docker compose up -d --build` and `node scripts/apply-local-schema.mjs`. Expected: the counts printed by Task 4 match a fresh `supabase/schema.sql`, and `node scripts/prove-local-stack.mjs` passes all six checks, including the load-bearing one: `user_profiles?select=id` answers **200**, not a refusal.

- [ ] **Step 2: Run the browser proof** (Task 15) against that rebuilt stack, from sign-in through the idle timeout to the Team console.

- [ ] **Step 3: Fix the two figures in the spec.** Edit [docs/superpowers/specs/2026-10-20-docker-self-host-migration-design.md](file:///D:/Nextjs%20Projects/sharm_dreams_group/docs/superpowers/specs/2026-10-20-docker-self-host-migration-design.md):
  - §2's "5 `supabase.storage.from(bucket)` accessor lines" → **16 accessor call sites across 14 files** (`createSignedUrl` ×5, `download` ×4, `remove` ×3, `upload` ×3, `list` ×1). Name the grep that proves it, because a naive `grep -c "\.storage"` returns **23** — the extra 7 are `storage_path` *column* reads, not accessor calls, and quoting 23 would be the same class of error as the 5.
  - §5's `db-anon-role = authenticated` → `anon`, with the reason from correction #1.
  - The RLS policy count → re-count at execution time with `grep -c "^create policy" supabase/schema.sql` and write the number the file says, not the number the spec says. Do the same for every count in this plan before you rely on it.

- [ ] **Step 4: Fix the same figures in the status report.** [docs/STATUS-2026-10-20.md](file:///D:/Nextjs%20Projects/sharm_dreams_group/docs/STATUS-2026-10-20.md) §5 repeats the 5, and §2.4 still calls the cron routes "the two routes nothing schedules" — which is now false, so add the Plan 1 line and its commit hash to §2.4 rather than quietly rewriting history.

- [ ] **Step 5: Say what is left.** Append a "Plan 1 complete, Plan 2 open" section to the status file listing exactly: bytes still live with the vendor (`storage.objects` holds rows, not files); `@supabase/supabase-js` still installed for one dead fallback in an off-limits file; `@vercel/speed-insights` still loaded; no TLS yet; the live `pg_dump` restore still unrun; KVM2 untouched. This is the list the owner reads to decide what happens next, so it must not round up.

- [ ] **Step 6: Commit, and offer the push.**

```bash
git add docs/superpowers/specs/2026-10-20-docker-self-host-migration-design.md docs/STATUS-2026-10-20.md
git commit -m "docs(plan): record the measured counts and what Plan 1 deliberately leaves open"
```

Then report the claims table — what was proved, how, and what was not run — and ask before pushing. Nothing in this plan has been pushed, and `git log origin/main..HEAD` is how the owner sees that.

---

## Self-review notes

Checked against the spec after writing:

- **Spec coverage.** Sections 1–3 (why, decisions, architecture) are Slice A. §4 (schema of record, roles, `auth`/`storage` shims) is Tasks 4–5. §5 (PostgREST config) is Task 2 plus corrections #1–2. §6 (sessions, RLS stand-ins, the proxy) is Tasks 8–15. §7 (files) is *deliberately* only Task 10's seam — the store itself is Plan 2. §8 (cut-over) and §9 (rollback) are Plan 2 with no exception: a cut-over needs a production host, and the owner's rule is local-first.
- **Placeholders.** No "TBD", no "add appropriate error handling", no "similar to Task N". Where a number is needed it is derived by a command in the step, not asserted from memory — Task 18 Step 3 exists because of that rule. The one step that used to hedge has been replaced with a measurement: Task 8 Step 2 states, and this device confirms (Node v24.21.0), that a `.mjs` probe can import a `.ts` source file with no flag and no loader, provided the specifier is relative and carries the `.ts` extension.
- **Type consistency.** `RestClient`, `Result<T>`, `mintSessionToken({ sub, role }, ttl)`, `verifySessionToken(token)`, `SESSION_COOKIE`, `writeSession`/`clearSession` (proxy) versus `startSession`/`endSession` (actions) are used by the same names in every later task. Task 12's `cookieAttributes()` takes no argument after the TTL became a module constant, and Task 13's writers reuse it. A `renewSession()` that appeared in an earlier draft of Task 12 was deleted: the proxy cannot call `next/headers`, so it would have been dead code in the identity spine.
- **Left alone on purpose.** The candidate portal (owner's standing rule), `@vercel/speed-insights`, the hosted-only config fields, and the `jobs`/`applicants` lock-down migration's numbering — `030`, because `026` does not exist in `supabase/migrations/` and inventing a number would collide with whatever the dump already applied.

---
