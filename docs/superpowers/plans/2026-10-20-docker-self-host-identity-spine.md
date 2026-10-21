# Docker Self-Host Migration — Plan 1: Identity Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a local Docker stack (Postgres 17 + PostgREST + Caddy + cron) that serves the existing 442 PostgREST reads and the 94 ported RLS policies, and replace `@supabase/ssr` with hand-rolled signed-cookie sessions — so the portal runs on this device with a token we mint ourselves.

**Architecture:** One Compose file owns the data plane; the app stays outside Docker (`next dev` on port 3000) and talks to PostgREST through a Caddy gateway that also strips `/rest/v1`. Everything Supabase hosted outside `public` (roles, `auth`, `storage`, `extensions`) is stood in by `docker/db/initdb/*.sql`, so `supabase/schema.sql` — including its policies — applies unchanged. Identity is a single re-pointed seam (`src/lib/supabase/server.ts`) plus a small `src/lib/auth/` module set; the 127 call sites that construct that client are not touched.

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
6. **`@supabase/supabase-js` cannot be uninstalled in Plan 1.** [src/app/(candidate)/portal/actions.ts:35-43](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/%28candidate%29/portal/actions.ts#L35-L43) wraps `getSupabaseServiceClient()` in `try/catch` and falls back to a direct `createClient(supabaseConfig.url, supabaseConfig.anonKey)`. After Task 11 Step 7 the factory's throw is gated on `SUPABASE_REST_BASE`, not on the vendor keys, so with the stack configured as `.env.example` now requires **that fallback is dead code** — but deleting it means editing the candidate portal, and the owner has ruled that surface off-limits ("leave candidate portal alone"). Plan 1 therefore leaves the package installed and that file untouched; Plan 2 asks permission to delete those four lines, and only then removes the dependency. **A second importer joins it in Task 11 Step 7b:** `src/lib/files/store.ts` keeps a vendor client because the local `storage.objects` shim holds metadata and no file, and after the row clients stop being vendor clients the service key is the only credential that can still reach the vendor's storage API. Task 17's gate is "the remaining importers are exactly these two files", not "zero".

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

**Out of scope for Plan 1** (Plan 2 owns it): the `files` table + `/data/uploads` volume, dropping `storage.objects` and the vendor delegation inside `src/lib/files/store.ts` (Task 10 creates the seam; the three `src/lib/supabase/{server,service,anon}.ts` clients it delegates through go away with it), removing `@supabase/*` and `@vercel/speed-insights`, and the KVM2 cut-over script.

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

	# A bare `respond /healthz` sorts AFTER the catch-all `handle` below and
	# could never be reached (measured: 404). It needs its own handle block.
	handle /healthz {
		respond "ok" 200
	}

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
      # The v16.5 binary's key is `openapi-server-proxy-uri` (measured by
      # grepping /bin/postgrest); the `_URL` spelling is silently ignored.
      PGRST_OPENAPI_SERVER_PROXY_URI: http://localhost:54321/rest/v1
    # Deliberately no `ports:` - nothing may bypass the gateway.

  gateway:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - rest
    # `caddyfile` is the registered adapter name in caddy v2.11.7 — the
    # `caddyfile_adapt` spelling is rejected ("unrecognized config adapter")
    # and the container crash-loops. Verified with `caddy validate`.
    command: ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
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
# `MSYS_NO_PATHCONV=1` because Git Bash rewrites the `$PWD/...` bind source into
# a Windows path Docker cannot mount (measured in Task 2).
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Expected: `compose ok`, then a "is valid" / successful `Validation Result`.

- [ ] **Step 4: Restart and prove the `/rest/v1` strip.**

```bash
npm run docker:up
curl -s -o /dev/null -w "healthz %{http_code}\n" http://localhost:54321/healthz
curl -s -o /dev/null -w "openapi %{http_code}\n" http://localhost:54321/rest/v1/
curl -s -o /dev/null -w "bogus   %{http_code}\n" http://localhost:54321/nope
```

Expected as written (measured in Task 2): `healthz 200`, `bogus 404`, and **`openapi 502`** — not `200` and not the `503` an earlier draft predicted. `502` is Caddy's "upstream refused me", and it is the *correct* answer at this point in the plan because the `authenticator` role does not exist until Task 3. Two measured facts to keep straight:

- **PostgREST v16.5 exits when the DB rejects its login** (it never binds its socket, so `rest` sits in `Restarting (1)`); a plain refused connection keeps it up and serves `503` with a `PGRST002` body. So a FATAL-auth stack shows `502` through the gateway, and Task 3 should expect the same until the role exists, then `200` after it.
- **`openapi` must be proven to reach PostgREST rather than the Caddy catch-all**, and a `502` does that on its own — only `reverse_proxy` can produce it, the catch-all produces the 404 body. To see the prefix strip itself, temporarily point the gateway at an echoing upstream (a second `rest`-named service that prints the path it received) and confirm `/rest/v1/users?select=id` arrives as `/users?select=id`; revert the change before committing. Do **not** create the `authenticator` role to make the probe go green — that is Task 3's deliverable.

Read `npm run docker:logs` for the `rest` service and report the PostgREST error verbatim rather than guessing.

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
-- Roles live in the cluster, not the database, and `create role` has no IF NOT
-- EXISTS, so these DO blocks exist to make a manual `psql -f` re-run of this
-- file against an existing cluster safe. They do not make a repair automatic:
-- docker-entrypoint-initdb.d runs only while PGDATA is empty, so a first boot
-- that aborts partway leaves a half-built cluster this file never sees again,
-- and that case still needs `npm run docker:wipe`.
--
-- `authenticator` is NOINHERIT so that `SET ROLE` stays the only way to obtain
-- any role's privileges. An INHERIT login role automatically exercises the
-- object privileges granted to `anon`, `authenticated` and `service_role`,
-- service_role's broad table grants included, so one request could act with the
-- union of three roles without ever switching. Attributes are a different thing
-- and are not inherited at all: membership in a BYPASSRLS role does not make the
-- member bypass RLS. That is why PostgREST must `SET ROLE`, and why RLS stays
-- enforced on the connection role.
--
-- Each branch spells the complete desired attribute list, because `alter role
-- ... with` only sets the options it names and never strips one a drifted
-- cluster added — the `no...` keywords are what remove a stray bypassrls,
-- superuser, createrole or createdb. The direction that matters is `anon` and
-- `authenticated`: PGRST_DB_ANON_ROLE switches every tokenless request into
-- anon, so a bypassrls or superuser on either of them is a real RLS bypass. The
-- file converges the attributes it lists and nothing else — not membership
-- beyond the `grant` below, not rolconnlimit, not rolvaliduntil.
--
-- `service_role` keeps BYPASSRLS because the app's service client is meant to
-- reach every row; that is what src/lib/supabase/service.ts assumes today.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit nobypassrls nosuperuser nocreaterole nocreatedb;
  else
    alter role anon with nologin noinherit nobypassrls nosuperuser nocreaterole nocreatedb;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit nobypassrls nosuperuser nocreaterole nocreatedb;
  else
    alter role authenticated with nologin noinherit nobypassrls nosuperuser nocreaterole nocreatedb;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls nosuperuser nocreaterole nocreatedb;
  else
    alter role service_role with nologin noinherit bypassrls nosuperuser nocreaterole nocreatedb;
  end if;
end $$;

-- The login role. This password must equal LOCAL_PGRST_PASSWORD in docker/.env.
-- It is a local dev credential by design; KVM2 replaces the whole file from a
-- secret that never enters the repo. A manual re-run resets it to this literal,
-- so a rotated value must be mirrored here or this file skipped.
--
-- No `nologin` here: Postgres does NOT let the last keyword win — `create role
-- authenticator nologin … login …` raises `ERROR: conflicting or redundant
-- options` and aborts the whole initdb pass, leaving a half-built volume.
-- `login` alone is what this role needs, and the else-branch re-asserts exactly
-- the keyword list this line sets (including NOINHERIT) so a re-run converges
-- attributes rather than only existence.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login nobypassrls nosuperuser nocreaterole nocreatedb password 'sdg_pgrst_local';
  else
    alter role authenticator with noinherit login nobypassrls nosuperuser nocreaterole nocreatedb password 'sdg_pgrst_local';
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
npm run docker:up
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

`npm run docker:wipe` is `down -v` and nothing more, which is why `docker:up` sits on its own line above — without it the stack stays torn down and the `pg` probe cannot connect.

Do NOT probe `pg_roles` here. `PGRST_DB_SCHEMAS` is `public`, PostgREST only serves relations it finds in `public`, `pg_roles` is a `pg_catalog` view, and `public` has no tables until Task 4 — so the request dies at relation lookup, not at authorization. Measured in Task 3:

```bash
curl -s -H "Accept: application/json" \
  "http://localhost:54321/rest/v1/pg_roles?select=rolname&id=eq.nonexistent" -w "\n%{http_code}\n"
```

```
{"code":"PGRST205","details":null,"hint":null,"message":"Could not find the table 'public.pg_roles' in the schema cache"}
HTTP 404
```

Prove the switch with the two things that actually turn on it instead:

1. **The tokenless OpenAPI root.** `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:54321/rest/v1/` → `200`. PostgREST connected to `db`, switched into `PGRST_DB_ANON_ROLE`, and rendered its schema against an empty `public`. A wrong anon role or a missing membership shows as `401`/`403`, and an unreadable DB as `502`/`503` — never `200`. This is also the `502 → 200` flip Task 2 predicted.
2. **The `SET ROLE` mechanism itself, at the DB.** Connect as `authenticator` over the published loopback port (read `LOCAL_PGRST_PASSWORD` out of `docker/.env` the same way Step 3 reads `LOCAL_DB_PASSWORD` — never print it) and show `session_authorization` stays `authenticator` while `current_user` becomes each target role, plus `pg_has_role('authenticator', 'anon'|'authenticated'|'service_role', 'MEMBER')` all true. That is exactly the model PostgREST uses, and it is the half the HTTP probe cannot see under `NOINHERIT`: membership is what permits `SET ROLE` when inherit is off.

Expected: `200` from the root, and both `SET ROLE` flips landing on `anon` and `authenticated`. **Do not create a table or view to make a relation query return rows** — that is Task 4's deliverable, and an empty `public` is the correct state to leave this task in. Read `npm run docker:logs` for the `rest` service and report the PostgREST error verbatim rather than guessing.

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

**Read `scripts/local-supabase-stub.sql` before writing Step 1 and Step 2.** That stub — not these two files — is what §13's throwaway proof actually applied: `apply-proof-schema.mjs` runs the stub, then `supabase/schema.sql` with only the `supabase_vault` line regexed out, and its PASS is where the `tables: 41, policies: 94, functions: 15, triggers: 15, buckets: 4` figures in Step 5 come from. So the stub is the empirically proven surface and these two files are a rewrite of it from the spec. Anything the stub has that Step 1/Step 2 omit — a column `schema.sql` inserts into, a grant one of the 94 policies needs, a helper function a policy calls — turns Step 5 into a hard error or a silently lower count. Where this plan is deliberately narrower (no `auth.identities`, no `auth.sessions`, no `supabase_vault`), prove `schema.sql` never touches it; where it is accidentally narrower, carry the missing object over and say so in the report.

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
-- The cast must wrap the WHOLE expression: `(… ->> 'sub')::uuid`. A SQL function
-- declared `returns uuid` cannot simply SELECT a text value — measured on
-- postgres:17-alpine, that shape fails at CREATE FUNCTION with `return type
-- mismatch in function declared to return uuid / Actual return type is text`,
-- because pg_cast has no text→uuid row (castcontext would have to be 'i' or
-- 'a'). The explicit cast is an I/O conversion, which is legal here.
create or replace function auth.uid() returns uuid
language sql stable as
$$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;

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

-- Deliberately no `create publication supabase_realtime` here, unlike the
-- throwaway stub. schema.sql's two realtime DO-blocks catch undefined_object,
-- so with no publication they are no-ops; standing one up here would hide that.
```

- [ ] **Step 3: Make `supabase/schema.sql` applyable on a vanilla image.** Two lines go, and a marker goes in. Read the note below before touching anything else in the file.

Delete lines 30–31 (`create schema if not exists vault;` and `create extension if not exists "supabase_vault" with schema vault;`) — nothing in `src/` uses Vault (spec §12), and the `create extension` is a hard error on `postgres:17-alpine` (the `.control` file is not in the image, and `IF NOT EXISTS` does not cover a missing extension), which is why [scripts/apply-proof-schema.mjs:29](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/apply-proof-schema.mjs#L29) had to regex it out. Line 30 goes with it because line 31 is the only thing that ever populated `vault`.

```bash
grep -n 'vault' supabase/schema.sql
```

Expected before the edit: lines 30 and 31 (plus the header comment at line 19 does not mention vault, so it stays). After the edit: exactly one match, the `AUTHORITATIVE:` marker prose added below — so grep for the *statements*, not the word: `grep -n 'create schema if not exists vault\|supabase_vault' supabase/schema.sql` must return nothing.

Add the marker as the second line of the file's opening comment block, directly after ` * Sharm Dreams Talent Cloud — schema of record.`:

```
 * AUTHORITATIVE: this file carries hand edits that `node scripts/dump-schema.mjs`
 * does not reproduce (the vault removal, the locked-down jobs/applicants
 * policies). A re-dump must re-apply them, not silently restore them.
```

**Note on the realtime lines.** Spec §5 also asks that the two `alter publication supabase_realtime …` DO-blocks be deleted. Leave them: each is wrapped in `exception when undefined_object then null`, and deleting them creates drift that the next `dump-schema.mjs` re-creates from live. One unavoidable hand edit is worth a marker; two optional ones is not. **The no-op claim was NOT proven by §13** — the old stub ran `create publication supabase_realtime`, so the exception path never fired there. Task 4's stand-ins deliberately create no publication, so Step 5/Step 6's applies are the first real evidence; confirm with `select count(*) from pg_publication;` (read-only) that it is 0 and the apply still succeeded, and say so in the report.

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

const sql = readFileSync(join(root, "supabase", "schema.sql"), "utf8");

// Field-based, not a URL: a URI would need the password percent-encoded, and a
// rotated password containing @, / or % silently misparses into the wrong
// database name.
const c = new Client({
  user: "postgres",
  password: local.LOCAL_DB_PASSWORD,
  host: "localhost",
  port: Number(local.LOCAL_DB_PORT) || 54320,
  database: "sharm_dreams",
  connectionTimeoutMillis: 15000,
});
await c.connect();
if (/^create extension if not exists "supabase_vault"/m.test(sql)) {
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

Why this task exists: both tables carry `using (true)` policies and `grant … to anon`, and `src/` reads **`job_openings`**, never `jobs` or `applicants` (re-derived by `grep -rn 'from("jobs")\|from("applicants")' src/` → zero hits, against 37 `from("job_openings")` occurrences across 19 files). This is the one place where "RLS on 41/41" does not mean "RLS protecting 41/41" — spec §5. Doing it while the schema is being re-founded is free; doing it after cut-over is an incident.

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

- [ ] **Step 3: Apply the lock-down to the running local stack, then re-apply the schema.**

Deleting the six policies from `supabase/schema.sql` makes a *fresh* volume clean, but the cluster that is running right now already has them — `drop policy if exists` was only ever inside the blocks being deleted, so re-applying the schema file cannot remove a policy it no longer mentions. Run migration 030 against the local DB first, the same way the cut-over will run it against the vendor. Pipe it through stdin so the SQL never touches a password on a command line:

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env ps   # confirm the db container name
docker exec -i sharm-dreams-local-db-1 psql -U postgres -d sharm_dreams \
  -v ON_ERROR_STOP=1 < supabase/migrations/030_lock_down_legacy_tables.sql
node scripts/apply-local-schema.mjs
```

Then count what went away — read-only, and note that in-container `psql` reaches the cluster over the local socket as the `postgres` OS user, so no credential is needed or printed:

```bash
docker exec sharm-dreams-local-db-1 psql -U postgres -d sharm_dreams -t -A -c "
select tablename, count(*) from pg_policies
 where tablename in ('jobs','applicants') group by 1 order by 1;"
docker exec sharm-dreams-local-db-1 psql -U postgres -d sharm_dreams -t -A -c "
select count(*) from information_schema.role_table_grants
 where table_schema='public' and table_name in ('jobs','applicants')
   and grantee in ('anon','authenticated');
select count(*) from pg_policy;"
```

Expected: the first query returns **no rows at all** (both tables hold zero policies — a `GROUP BY` over no rows prints nothing, so zero rows *is* the pass condition), the second prints `0` grants remaining, and the apply script's total policy count is now **88**, not 94. The `service_role` grants on both tables must still be there — `revoke … from anon, authenticated` leaves them alone, and `service_role` keeps `BYPASSRLS`, so the app's service client still reads these tables even with no policies on them.

Update the spec's §5 figures to match the tree this task produces: the definition-of-done line `41 tables / 94 policies` becomes **88**, and `80 of the 94 policies` becomes `80 of the 88` (the six deleted policies are all `with check (true)` / `using (true)` and never call `auth.uid()`, so the 80 does not move). Leave §1's and §2's headline `94` and §13's measured `94` alone — §13 records what the throwaway proof actually counted at the time it ran, and Task 18's clean-slate acceptance is where the remaining live claims get reconciled.

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
- Modify: `package.json` (add the `db:seed-local` alias beside `db:apply-local`)

**Interfaces:**
- Produces: three `auth.users` rows with `crypt()`-hashed passwords and matching `user_profiles` rows (`SUPER_ADMIN`, `RECRUITER`, `CANDIDATE`), a fixed `tenant_id`. Task 7's gate signs in as the SUPER_ADMIN; Task 9's `passwords.ts` verifies against exactly these hashes. The `role_permissions` the two staff roles need are **already seeded by `supabase/schema.sql`** — measured on the local stack: `SUPER_ADMIN` 20 granted rows, `RECRUITER` 11 rows of which 10 are granted — so this script writes none and must not start inventing them.
- Consumes: Task 4's `auth.users`, Task 5's locked-down tables.

- [ ] **Step 1: Add the local fixture password name** to `docker/.env.example` and `docker/.env`:

```ini
# Local-only password for the seeded staff fixtures. Never reuse anywhere real.
LOCAL_STAFF_PASSWORD=sdg-local-fixture-pw
```

and give the seeder an npm alias beside the other local-stack entry points, because a script nobody can find is a script nobody runs after `down -v`:

```json
    "db:seed-local": "node scripts/seed-local-staff.mjs",
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
 * Passwords go in as pgcrypto bcrypt, i.e. `extensions.crypt(pw,
 * extensions.gen_salt('bf', 10))`, so they are byte-compatible with the hashes a
 * restored live dump carries and Task 9 can verify both the same way. The
 * `extensions.` prefix is not decoration: Task 3 installs pgcrypto `with schema
 * extensions`, and a `pg` client's default search_path is `"$user", public`, so
 * an unqualified `gen_salt(...)` raises
 * `function gen_salt(unknown, integer) does not exist` (measured). The password
 * is read from docker/.env and is never printed.
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
  user: "postgres",
  password: local.LOCAL_DB_PASSWORD,
  host: "localhost",
  port: Number(local.LOCAL_DB_PORT) || 54320,
  database: "sharm_dreams",
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
       values ($1, 'authenticated', extensions.crypt($2, extensions.gen_salt('bf', 10)), now(),
               jsonb_build_object('provider','email','providers',array['email'],
                                  'tenant_id', $3::uuid),
               jsonb_build_object('full_name', $4::text))
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
docker exec sharm-dreams-local-db-1 psql -U postgres -d sharm_dreams -c "
select email, left(encrypted_password,7) as prefix,
       extensions.crypt('sdg-local-fixture-pw', encrypted_password) = encrypted_password as good,
       extensions.crypt('wrong-pw', encrypted_password) = encrypted_password as wrong_passes
  from auth.users order by email;"
```

Expected: three rows, `prefix` = `$2a$10$`, `good: t`, `wrong_passes: f`. The `prefix` is the whole point — Supabase stores `$2a$` hashes, so a restored dump will verify through the identical path. Use `docker exec … psql` rather than a `node -e` one-liner so the DB password never appears in a command line or in a connection URI; in-container `psql` reaches the cluster over the local socket as the `postgres` OS user and needs no credential at all.

If `user_profiles` has no unique constraint on `auth_user_id`, the `on conflict` clause errors — read the constraint off the applied database (`psql \d public.user_profiles`) and match it; do not invent one. This is why the script must run against the real local stack rather than a mocked schema.

`$4::text` is not decoration either. `jsonb_build_object` is declared `VARIADIC "any"`, so Postgres has no type to infer a bare parameter from and answers `42P08 could not determine data type of parameter $4` (measured at position 419 — the `'full_name'` argument; `$3` survives because it is already cast to `uuid`). Any future writer of `raw_app_meta_data`/`raw_user_meta_data` must cast every parameter it hands to that function.

- [ ] **Step 4: Commit.**

```bash
git add scripts/seed-local-staff.mjs docker/.env.example package.json
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

- [ ] **Step 1: Write the gate.** Read the numbered comments in the fence before changing anything — comment 3 is the assertion that makes the other seven worth running.

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

// PostgREST answers every failure with {"code":…,"message":…}. `code` is what tells
// the mechanisms apart: PGRSTnnn is PostgREST itself refusing (303 = token not in
// audience, 202 = no function matched that signature, 205 = schema not exposed),
// while a bare SQLSTATE like 42501 came from the database, past the HTTP layer.
function errorCode(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.code === "string" ? parsed.code : "";
  } catch {
    return "";
  }
}

// One connection, opened here and closed after the last check: check 5 compares an
// HTTP answer against catalog SQL, and that comparison only means something if both
// halves describe the same stack at the same instant.
// Password, host, port and database are passed as FIELDS on purpose — never rebuild
// this as a postgresql:// URI: a rotated password containing @ / or % misparses into
// the wrong database name, which is why commit 9b6ca2f exists.
// And note: loopback is `trust` in this cluster's pg_hba, so a successful connect here
// proves only that the port is published and the database exists. It is never
// evidence that a password was checked.
const db = new Client({
  user: "postgres",
  password: env.LOCAL_DB_PASSWORD,
  host: "localhost",
  port: Number(env.LOCAL_DB_PORT) || 54320,
  database: "sharm_dreams",
  connectionTimeoutMillis: 15000,
});
await db.connect();

// `sub` must be the AUTH uid, i.e. user_profiles.auth_user_id (= auth.users.id),
// never user_profiles.id. The two differ on this stack: the profile PK defaults
// to gen_random_uuid() and only auth_user_id FK-references auth.users(id), so a
// token carrying the profile id makes auth.uid() and is_staff() both miss, and
// checks 2 and 4 fail at zero rows for a reason that has nothing to do with RLS.
// Measured: the SUPER_ADMIN profile PK is 48dfd60a-… while its auth user is
// f2f37a1a-…, and `id is not distinct from auth_user_id` is false for all three
// fixtures.
const staffRow = await db.query(
  "select auth_user_id from public.user_profiles where role = 'SUPER_ADMIN' and email = 'owner.local@sharmdreams.test' limit 1"
);
if (!staffRow.rowCount) {
  await db.end();
  throw new Error("run scripts/seed-local-staff.mjs first");
}
const staff = staffRow.rows[0].auth_user_id;

const staffToken = mintToken({ sub: staff, role: "authenticated" });

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

// 5. Task 5's lock-down must hold even for staff — and it must hold for the RIGHT
//    reason. The old predicate (401 || 403 || 404) also matched a broken token:
//    measured, a wrong-aud JWT answers `401 PGRST303 "JWT not in audience"` for
//    EVERY table, open or locked — including job_openings, which a valid staff token
//    reads at 200. So a row-count or status-only assertion cannot tell "the grants
//    are revoked" from "my token is junk". Both halves below are required:
//      HTTP: 403 whose body carries SQLSTATE "42501" (permission denied for table),
//            i.e. the request reached Postgres and the GRANT refused it; and
//      SQL, on this connection: zero rows in pg_policies for the table, and no
//            `anon=` / `authenticated=` entry in pg_class.relacl.
//    Measured baseline: jobs/applicants relacl is
//    {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}, both carry no
//    policy at all, and the control table job_openings still holds
//    anon=…,authenticated=… with 2 policies.
for (const t of ["jobs", "applicants"]) {
  const r = await rest(staffToken, `${t}?select=id`);
  const cat = await db.query(
    `select
       (select count(*)::int from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = $1) as policy_rows,
       (select array_to_string(relacl, ',') from pg_catalog.pg_class
         where relnamespace = 'public'::regnamespace and relname = $1) as relacl`,
    [t],
  );
  const policyRows = cat.rows[0].policy_rows;
  const relacl = cat.rows[0].relacl ?? "";
  // One aclitem per comma: `<grantee>=<privs>/<grantor>`; a NULL relacl means no
  // explicit grants at all, which is equally closed.
  const aclGrantees = relacl
    .split(",")
    .filter(Boolean)
    .map((item) => item.split("=")[0].trim());
  const httpDenied =
    r.status === 403 && /"code"\s*:\s*"42501"/.test(String(r.json));
  check(
    `locked-down table ${t} is denied by its own GRANT (403 + 42501), not by a refused token`,
    httpDenied && policyRows === 0 && !aclGrantees.some((g) => g === "anon" || g === "authenticated"),
    `http ${r.status} code ${errorCode(r.json) || "none"}, pg_policies ${policyRows} rows, relacl ${relacl ? `[${relacl.slice(0, 80)}]` : "NULL"}`,
  );
}

// 6. The two RPCs the app calls must be exposed by PostgREST AND actually resolve.
//    Both take one required named uuid (`refresh_attempt_integrity(target_attempt)`
//    and `stop_time_entry(entry_id)`, read from pg_proc), so a `{}` body is not
//    "reached the function and tripped a not-null violation" — PostgREST answers 404
//    PGRST202 because no zero-argument form of either name exists in the schema
//    cache. That is an ARITY MISS CAUSED BY THE PROBE, and it is not evidence about
//    exposure at all, so probing with `{}` could never fail for the right reason.
//    Probing with the signature's own parameter name and the nil uuid does resolve
//    (measured 204 and 200 null), and stays a no-op: both bodies are a single UPDATE
//    keyed `where id = <the uuid>` with no INSERT anywhere, and neither target table
//    holds a row whose id is the nil uuid, so zero rows match and nothing is written.
//    A 400 still counts as exposed, but only when its body proves the FUNCTION ran:
//    PostgREST's own rejections carry a PGRSTnnn code, a database error raised inside
//    the body carries its SQLSTATE. 404 is the one real failure, and the printed code
//    separates PGRST202 (no such signature) from PGRST205 (the schema is not exposed).
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const RPCS = [
  { name: "refresh_attempt_integrity", arg: "target_attempt" },
  { name: "stop_time_entry", arg: "entry_id" },
];
for (const { name, arg } of RPCS) {
  const r = await fetch(`${BASE}/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({ [arg]: NIL_UUID }),
  });
  const text = await r.text();
  const code = errorCode(text);
  const ran = r.status === 200 || r.status === 204;
  const raisedInsideBody = r.status === 400 && code !== "" && !code.startsWith("PGRST");
  check(`rpc/${name} is exposed and resolves its signature`,
    ran || raisedInsideBody,
    `status ${r.status}, code ${code || "none"}, ${(text || "<empty body>").slice(0, 90)}`);
}

await db.end();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed:", failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
```

- [ ] **Step 2: Add the script** to `package.json` after `db:seed-local`:

```json
    "stack:prove": "node scripts/prove-local-stack.mjs",
```

- [ ] **Step 3: Run it and believe what it says.**

```bash
npm run stack:prove
```

Expected: `8/8 checks passed` — four standalone checks plus the two lock-down tables and the two RPCs. Investigate a failure before writing any Slice C code — spec §3 says the identity half is only provable against a PostgREST we own, and this gate is that proof. A failure on check 1 usually means a policy grants `to public` while the row-level predicate assumes `authenticated`; a failure on check 3 means `authenticator` is not a member of `authenticated`.

Three things this gate is easy to misread, all measured while Task 6 was reviewed:

- **Check 4's `>= 3` depends on the CANDIDATE fixture.** The policy that answers it is `profiles_self_read = (auth_user_id = auth.uid() OR is_staff())`, and `is_staff()` is `role in ('SUPER_ADMIN','RECRUITER','HIRING_MANAGER')` — so the third row a SUPER_ADMIN sees is the `CANDIDATE` profile Task 6 seeds. Trim the fixtures to "two staff" and this check fails at 2 for a reason that has nothing to do with RLS.
- **The locked-down tables answer `403` with `42501 permission denied`, not `401` and not an empty `200`.** Grant-level lock-down (Task 5) is a different mechanism from a policy that simply matches no rows, and the check must not be written as "zero rows". Nor as "any refusal": a *broken* token answers `401 PGRST303 "JWT not in audience"` for every table including `job_openings`, which a valid token reads at `200` — so `401` is evidence that the token failed, never that the grant was revoked. This is why the shipped check demands `403` + `42501` **and** the catalog halves (`pg_policies` empty, no `anon=`/`authenticated=` in `relacl`) together.
- **`LOCAL_DB_PASSWORD` proves nothing over TCP here.** `pg_hba_file_rules` has `host all all 127.0.0.1/32 trust` and `::1 trust`; only the non-loopback `host` line is `scram-sha-256`. So a Client that logs in from the host is not evidence that a password was checked — never let a passing connect become a credential proof. Use in-container `psql` for anything that must be credential-free, and the bcrypt comparison inside the database for anything that must be credential-bearing.

The `new Client({…})` block above passes host, port, database and password as **fields**, exactly as `scripts/seed-local-staff.mjs:45-52` does. Do not "simplify" it back to a `postgresql://user:password@host/db` URI: a rotated password containing `@`, `/` or `%` silently misparses into the wrong database name, which is why commit `9b6ca2f` exists.

- [ ] **Step 4: Commit.**

```bash
git add scripts/prove-local-stack.mjs package.json
git commit -m "test(stack): prove our own token reaches the same rows through our own PostgREST"
```

---

## Slice C — sessions, cookies, and the one seam

### The hand-written surface, measured

Spec §2 counts 442 `.from("table")` reads and says "kept as-is". That is true of the *call sites*; it is not true of the *object they are called on*. `createServerClient()` returns supabase-js's PostgREST builder, and Plan 1's end state — spec §1, "no `@supabase/*` package left in the tree" — means something in this repo has to answer those chains. Re-derived from `src/` on 2026-10-20, the surface is one file's worth of work, not forty:

**The chains, counted two ways.** 442 `.from("literal")` — which is the figure spec §2 quotes, and it is right as far as a literal grep can see it — plus **12 more that pass a variable**: `files/actions.ts` ×2 (`.from(target.table)`), `analytics/infrastructure/reportReader.ts` ×2, `jobs/application/filingVocabularies.ts` ×1, `live/infrastructure/changeWatch.ts` ×2, `settings/application/master-data-actions.ts` ×5. **454 PostgREST table chains in total.** Task 18 corrects spec §2 to 454; every step that says "442" means the literal subset, and a reader who assumes 442 is the whole surface will not write the `.from(variable)` case into the builder's probe. (`src/lib/files/store.ts`'s five `.from(bucket)` are storage, not PostgREST, and are excluded.)

| Used | Count | Never used |
| --- | --- | --- |
| `.eq()` 389, `.filter()` 370, `.select()` 357, `.maybeSingle()` 141, `.order()` 118, `.limit()` 75, `.update()` 75, `.in()` 49, `.insert()` 45, `.delete()` 39, `.is()` 35, `.single()` 16, `.not()` 15, `.range()` 8, `.gte()` 8, `.or()` 7, `.upsert()` 5, `.lte()` 5, `.neq()` 4, `.lt()` 4, `.gt()` 4, `.like()` 2, `.contains()` 2, `.ilike()` 1 | **1,774 calls, 24 methods** | `.schema()`, `.containedBy()`, `.matches()`, `.geojson()`, `.csv()`, `.throwOnError()`, `.head()` as a method (it is an option), `.and()` |

These are flat `grep -ro "\.name("` counts over `src/`, so they over-count by whatever unrelated object shares the name — `.match(` was measured that way and is **excluded** because all 11 hits are `String.prototype.match`, and `.filter(`/`.map(`/`.from()` have the same hazard (hence the two-ways count above). The list is the union of *both* measurements corrected: `.update()` is 75, not the 74 an earlier draft of this table carried.

Options actually passed: `{ count: "exact" }` ×36, `{ head: true }` ×29, `{ onConflict: … }` in all 5 `.upsert()` calls, `{ ascending: false }` in `.order()`, `nullsFirst` once. Two `.rpc()` call sites. That is the whole contract Task 11 implements, and it is why the promise "leave the query call sites alone" is honest rather than hopeful.

### Task 8: `src/lib/auth/token.ts` — mint and verify our own signed token

**Files:**
- Create: `src/lib/auth/token.ts`
- Test: `scripts/prove-token-shape.mjs`

**Interfaces:**
- Consumes: `AUTH_JWT_SECRET` (and `AUTH_TOKEN_TTL_SECONDS`, default 900) from the server env.
- Produces: `mintSessionToken({ sub, role }) => Promise<string>`, `verifySessionToken(token) => Promise<Claims | null>`, `type Claims = { sub: string; role: "anon" | "authenticated" | "service_role"; aud: string; iss: string; iat: number; exp: number }`. Task 9 signs in with the first, Task 11 attaches its output as a bearer, Task 13 verifies it in the proxy.

Deviation from spec §6, deliberate: the claim is **`sub`**, not `uid`, because `sub` is what the 80 ported policies reach through `auth.uid()` (Task 4 Step 1), and rewriting `auth.uid()` to read `uid` would mean rewriting the dump instead of standing beside it. The token carries `{ sub, role, aud, iss, iat, exp }` and nothing else — role here means the *Postgres* role for RLS, never the staff role, which is read from `user_profiles` (spec §6).

**What this module does not and cannot enforce — measured on the gateway while Task 8 was reviewed, so the later slices know where the duty falls.** The `role` claim only decides which Postgres role `authenticator` switches into; it is not an authorization check, because the RLS predicates key off `auth.uid()` and `is_staff()`, and `is_staff()` is `SECURITY DEFINER`. So an `anon`-role token carrying a staff `sub` reads exactly the rows an `authenticated` one does (`user_profiles`, `roles`), while a `service_role` token bypasses RLS entirely and reaches `jobs` — the table a staff token is refused with `403`. Two consequences, both binding on later tasks, neither fixable here: **Task 12 mints `authenticated` and nothing else** (a login never hands out an `anon` or `service_role` token), and **Task 13's proxy refuses any verified token whose `role` is not `authenticated`** before it reads the rest of the claims. `mintServiceToken` exists for Task 16's cron container, which calls it in-process and never puts the result in a cookie or a response body; if a `service_role` token is ever seen on a request, that is the bug, not this file.

- [ ] **Step 1: Write the failing probe first.**

```js
/* scripts/prove-token-shape.mjs — Run: node --env-file=docker/.env scripts/prove-token-shape.mjs */
import { createHmac } from "node:crypto";
import { mintSessionToken, verifySessionToken } from "../src/lib/auth/token.ts";

const UID = "11111111-1111-1111-1111-111111111111";
const t = await mintSessionToken({ sub: UID, role: "authenticated" });
const c = await verifySessionToken(t);
if (!c || c.sub !== UID || c.role !== "authenticated") throw new Error("round trip failed");
if (c.exp - c.iat !== 900) throw new Error(`default lifetime is ${c.exp - c.iat}, expected 900`);
if (await verifySessionToken(t.slice(0, -2) + "xx")) throw new Error("tampered token accepted");
if (await verifySessionToken(null)) throw new Error("null accepted");
const unsigned = t.split(".");
if (await verifySessionToken(`${unsigned[0]}.${unsigned[1]}`)) throw new Error("two-part token accepted");

// A misread lifetime must fail HERE, loudly. `Number("abc")` is NaN and
// `JSON.stringify({exp: now + NaN})` is `"exp":null`, which PostgREST reads as
// *no expiry at all* — measured: a null-exp token signed with the real secret
// is accepted and the staff rows come back. Every value below is a plausible
// typo in AUTH_TOKEN_TTL_SECONDS, so the guard is asserted through the env var
// rather than only through the explicit argument.
for (const bad of ["", "abc", "0", "-5", "1.5", "Infinity", "1e18"]) {
  process.env.AUTH_TOKEN_TTL_SECONDS = bad;
  let threw = false;
  try {
    await mintSessionToken({ sub: UID, role: "authenticated" });
  } catch (e) {
    threw = e instanceof Error && /lifetime/.test(e.message);
  }
  if (!threw) throw new Error(`ttl ${JSON.stringify(bad)} minted a token instead of throwing`);
}
delete process.env.AUTH_TOKEN_TTL_SECONDS;

// The guards on the VERIFY side are fenced here too, because they were not: when
// this probe was mutation-tested against copies of the module with each verify
// guard removed one at a time (`exp` back to a `typeof` test, the `iat` line
// deleted, the `catch` dropped), it stayed green. A mint-side typo is caught by
// the loop above; a regression of the refusal logic below would have been
// invisible. Each body is hand-written JSON so a shape `JSON.stringify` cannot
// produce is still testable — `1e999` parses to `Infinity`, while the JS value
// `Infinity` serialises to `null`. Signing them is the module's own job in
// reverse, so this is the only place in the plan that uses `createHmac` directly.
const HEAD = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const seal = (bodyJson) => {
  const b = Buffer.from(bodyJson).toString("base64url");
  const sig = createHmac("sha256", process.env.AUTH_JWT_SECRET).update(`${HEAD}.${b}`).digest("base64url");
  return `${HEAD}.${b}.${sig}`;
};
const NOW = Math.floor(Date.now() / 1000);
const CLAIMS = `"sub":"${UID}","role":"authenticated","aud":"sdg_local","iss":"sharm-dreams-local"`;
for (const [name, json] of [
  ["exp null", `{${CLAIMS},"iat":${NOW},"exp":null}`],
  ["exp 1e999", `{${CLAIMS},"iat":${NOW},"exp":1e999}`],
  ["exp absent", `{${CLAIMS},"iat":${NOW}}`],
  ["iat absent", `{${CLAIMS},"exp":${NOW + 900}}`],
  ["iat null", `{${CLAIMS},"iat":null,"exp":${NOW + 900}}`],
  ["iat a string", `{${CLAIMS},"iat":"${NOW}","exp":${NOW + 900}}`],
  ["body decodes to null", "null"],
]) {
  let refused;
  try {
    refused = await verifySessionToken(seal(json));
  } catch (e) {
    throw new Error(`verify refused the ${name} body by THROWING ${String(e)}`);
  }
  if (refused) throw new Error(`${name} token accepted`);
}

// And the same contract one level further out: a value that is not a string at
// all is a refusal, not a `TypeError` escaping into Task 13's proxy. This is why
// `verifySessionToken` takes `unknown` and type-tests before it splits.
for (const junk of [12345, true, {}, [], Buffer.from("x")]) {
  let refused;
  try {
    refused = await verifySessionToken(junk);
  } catch (e) {
    throw new Error(`a non-string token ${String(e)}`);
  }
  if (refused) throw new Error("a non-string was accepted as a token");
}

console.log("PASS token round trip, tamper refusal, null refusal, lifetime guards, verify guards");
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
node --env-file=docker/.env scripts/prove-token-shape.mjs
```

Expected: cannot resolve `../src/lib/auth/token.ts` — the file does not exist yet.

The `--env-file=docker/.env` half of that command is load-bearing, not decoration: the module refuses to sign without `AUTH_JWT_SECRET`, which lives only in that git-ignored file, and this shell carries no copy of it. Passing it as a file keeps the secret off the command line and out of any transcript. (Measured: without it the run dies on the module's own config guard, which is the correct failure but a misleading one to read as "the probe is wrong".)

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

/** The longest lifetime this module will sign. A staff session is bounded by the
 * idle-timeout layer, so a token that outlives a day is not a legitimate request,
 * it is a misread `AUTH_TOKEN_TTL_SECONDS` — and the misread is silent unless the
 * minter refuses it. See `validTtl`. */
const MAX_TTL_SECONDS = 86_400;

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

/**
 * `AUTH_TOKEN_TTL_SECONDS` arrives as a string, so a typo is not a smaller
 * session, it is no session limit at all: `Number("abc")` is NaN, and a claims
 * object with `exp: now + NaN` serialises to `"exp":null`, which PostgREST
 * accepts as a token that never expires (measured on the gateway — a null-`exp`
 * token signed with the real secret reads back the staff rows). Nothing else in
 * this module can notice, because a null `exp` is a perfectly well-signed token.
 */
function validTtl(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TTL_SECONDS) {
    throw new TokenConfigError(
      `token lifetime must be a whole number of seconds from 1 to ${MAX_TTL_SECONDS}, got ${String(value)}`
    );
  }
  return n;
}

export async function mintSessionToken(
  input: { sub: string; role: TokenRole },
  ttlSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 900)
): Promise<string> {
  const ttl = validTtl(ttlSeconds);
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub: input.sub,
    role: input.role,
    aud: AUDIENCE,
    iss: ISSUER,
    iat: now,
    exp: now + ttl,
  });
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

/** A minted service-role token is the only way a background job bypasses RLS,
 * so it has no cookie and never leaves the process that made it. */
export async function mintServiceToken(ttlSeconds = 60): Promise<string> {
  return mintSessionToken({ sub: "00000000-0000-0000-0000-000000000000", role: "service_role" }, ttlSeconds);
}

export async function verifySessionToken(token: unknown): Promise<Claims | null> {
  // `unknown`, not `string | undefined | null`, because the contract is that a bad
  // token is a `null` and NEVER an exception — and `token.split` sits outside the
  // `try` below. A truthy non-string (a number, a Buffer, an object that came
  // through a value this app did not write) would throw a `TypeError` straight out
  // of the caller in Task 13's proxy, which is a 500 on the whole portal. The type
  // test is the first guard for the running program, not a courtesy to TypeScript.
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  try {
    // Reject an algorithm swap before trusting anything in the header: a token
    // that says alg=none is not a token, it is a request to be let in.
    const head = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string };
    if (head.alg !== "HS256") return null;

    // Compared as the base64url TEXT it arrived in, not as decoded bytes, and
    // that is the stricter choice: decoding both sides would accept non-canonical
    // signatures (`+`, `/`, a padding char) that re-encode to the same 32 bytes,
    // making this verifier looser than the PostgREST it has to agree with. Do not
    // "fix" this to compare bytes.
    const expected = Buffer.from(sign(`${header}.${body}`));
    const actual = Buffer.from(signature);
    // Without this length guard, timingSafeEqual throws on a short signature.
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    const now = Math.floor(Date.now() / 1000);
    // Every check is inside the try on purpose. This function's contract is that
    // a bad token is a `null` and never an exception — Task 13's proxy calls it on
    // every request, and a throw there is a 500 on the whole portal. A body that
    // decodes to `null` would make the reads below throw, so they are caught here
    // instead of guarded one by one. `Number.isInteger` is what kills both a null
    // `exp` (a never-expiring token) and `Infinity` (the same thing wearing a
    // number), which a `typeof === "number"` test passes.
    if (!Number.isInteger(claims.exp) || claims.exp <= now) return null;
    if (!Number.isInteger(claims.iat)) return null;
    if (claims.aud !== AUDIENCE || claims.iss !== ISSUER) return null;
    if (claims.role !== "authenticated" && claims.role !== "anon" && claims.role !== "service_role") {
      return null;
    }
    if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
    return claims;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Re-run the probe, then the repo gates.**

```bash
node --env-file=docker/.env scripts/prove-token-shape.mjs
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/lib/auth/token.ts scripts/prove-token-shape.mjs
```

Expected: `PASS token round trip, tamper refusal, null refusal, lifetime guards, verify guards`, then both gates silent.

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
- Modify: `tsconfig.json`
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

This one value *is* a URI, and it stays one deliberately: it is read verbatim from the environment by `new Pool({ connectionString: … })`, never built by interpolating a password, so the misparse risk that made Task 4's script go field-based does not apply to the code — only to whoever types the value. The rule to write into `.env.example`'s comment is therefore about authoring, not parsing: **if you rotate `LOCAL_DB_PASSWORD`, percent-encode it here too** (`@` → `%40`, `/` → `%2F`, `%` → `%25`), because `pg` parses this string with the RFC 3986 userinfo grammar and an unencoded `@` makes it look for the host in the middle of your password.

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
    // No `ssl` option at all. TLS here is the connection string's business
    // (`?sslmode=…`), and a default of `{ rejectUnauthorized: false }` would
    // silently turn certificate verification off the first time this points at
    // anything other than loopback — which is exactly what KVM2 will be.
  });
  return pool;
}
```

- [ ] **Step 3: Write `src/lib/auth/passwords.ts`.**

```ts
// The extension is load-bearing, not stylistic. This module is imported by a
// plain-Node probe (Task 8's note on probe resolution: an explicit `.ts`
// specifier, a relative path, no loader), and Node's ESM resolver refuses an
// extensionless `./db`. Step 4 enables the matching TypeScript option.
import { getAuthPool } from "./db.ts";

export type PasswordCheck =
  | { ok: true; userId: string }
  | { ok: false; reason: "unknown_user" | "wrong_password" | "banned" };

/**
 * Verifies a staff password against the migrated bcrypt hash.
 *
 * `extensions.crypt(submitted, stored) = stored` is pgcrypto's own comparison: it
 * re-salts the submitted password with the stored hash's salt, so the comparison
 * is a string equality on a derived value and never touches the secret itself.
 * Both calls are schema-qualified because pgcrypto is installed `with schema
 * extensions` and this pool's default search_path is `"$user", public` — an
 * unqualified `crypt(...)` raises "function does not exist" (measured).
 *
 * The unknown-user case still pays for a bcrypt round anyway. That is deliberate:
 * without it, a missing account answers faster than a wrong password, and the
 * login form becomes an email-enumeration oracle. The round is generated inside
 * the database (`gen_salt('bf', 10)` — the same cost factor the fixtures were
 * seeded with), because a hand-written hash literal in this file would be a fake
 * credential: it cannot be proven to be real bcrypt output, it goes stale the
 * moment `seed-local-staff` re-hashes with a fresh salt, and a secret-shaped
 * string in source is what a secret scanner (and the next reviewer) flags first.
 */
export async function verifyStaffPassword(email: string, password: string): Promise<PasswordCheck> {
  const normalized = email.trim().toLowerCase();
  const { rows } = await getAuthPool().query(
    `select id,
             (encrypted_password is not null
               and extensions.crypt($2, encrypted_password) = encrypted_password) as password_ok,
             banned_until is not null and banned_until > now() as is_banned
       from auth.users
      where lower(email) = $1
      limit 1`,
    [normalized, password]
  );

  if (!rows.length) {
    await getAuthPool().query("select extensions.crypt($1, extensions.gen_salt('bf', 10)) as x", [password]);
    return { ok: false, reason: "unknown_user" };
  }
  const row = rows[0] as { id: string; password_ok: boolean; is_banned: boolean };
  if (!row.password_ok) return { ok: false, reason: "wrong_password" };
  if (row.is_banned) return { ok: false, reason: "banned" };
  return { ok: true, userId: row.id };
}
```

- [ ] **Step 4: Enable `.ts` import specifiers in `tsconfig.json`.**

Add one line next to `"noEmit": true`:

```jsonc
"noEmit": true,
"allowImportingTsExtensions": true,
```

Why the compiler needs this at all: Step 3's specifier is what lets `node scripts/prove-password-verify.mjs` load `passwords.ts`, and `tsc` answers `TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled` to it (measured — with the specifier changed and the flag absent, the project reports **3** `error TS` lines instead of the accepted 2). The option is legal precisely because this project has `"noEmit": true`: TypeScript refuses the pair of `.ts` specifiers plus emit, and this repo never emits from `tsc` — Next transpiles with its own bundler, which resolves `./db.ts` as a literal path.

The option only *permits*: every existing extensionless specifier in `src/` keeps compiling, and the measured baseline after the change is the same two generated-artifact errors as before (`validator.ts(58,39) TS2307`, `validator.ts(66,69) TS2344` plus its one indented continuation). Remember the exit-code rule from Task 8: the first `tsc` run after a source edit exits **2**, an unchanged re-run exits **1**, with byte-identical diagnostics — read the gate on the output, never on the exit code.

- [ ] **Step 5: Write and run `scripts/prove-password-verify.mjs`.**

```js
/* scripts/prove-password-verify.mjs — Run: node scripts/prove-password-verify.mjs
 * Reads the fixture password from docker/.env and never prints it. */
import { readFileSync } from "node:fs";
import { getAuthPool } from "../src/lib/auth/db.ts";
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
// Mixed case because that is what a typing human produces, and because this is
// the only call that exercises normalisation: deleting `.trim().toLowerCase()`
// makes this call answer `unknown_user` and the probe goes red (measured). It
// deliberately does *not* cover the SQL `lower(email)` — every fixture email is
// stored in lower case, so losing only that half still passes. The two guards
// are redundant on purpose; say so instead of letting the PASS line imply a
// coverage the fixtures cannot give (adding a mixed-case fixture is Plan 2 work).
const badStart = performance.now();
const bad = await verifyStaffPassword("Owner.Local@SharmDreams.test", pw + "-nope");
const badMs = performance.now() - badStart;
const ghostStart = performance.now();
const ghost = await verifyStaffPassword("nobody@sharmdreams.test", pw);
const ghostMs = performance.now() - ghostStart;

if (!good.ok) throw new Error(`correct password rejected: ${JSON.stringify(good)}`);
if (bad.ok || bad.reason !== "wrong_password") throw new Error(`wrong password accepted: ${JSON.stringify(bad)}`);
if (ghost.ok || ghost.reason !== "unknown_user") throw new Error(`bad unknown-user path: ${JSON.stringify(ghost)}`);
// The unknown-user path only defends against email enumeration while it
// actually pays for a hash round, and its return value cannot show that: with
// the equalising query deleted the path still answers `unknown_user`. Measured
// through this pool on the local container — one cost-10 bcrypt round takes a
// call to ~50 ms and the bare lookup answers in ~4 ms — so the unknown path is
// compared against *the same run's* wrong-password path. A fixed millisecond
// threshold would only mis-time a loaded machine; this ratio absorbs it.
if (ghostMs < badMs / 3) {
  throw new Error(`unknown-user path answered in ${ghostMs.toFixed(1)}ms against a ${badMs.toFixed(1)}ms hash round — the timing-equalising round is gone`);
}
// Close the pool or this script sits on the pool's 30s idle timeout after
// printing its result — a probe that finishes but does not exit reads as a hang.
await getAuthPool().end();
console.log("PASS correct/wrong/unknown answered correctly, a mixed-case login normalised to the right row, and the unknown-user path paid for a hash round");
console.log(`  seeded user id: ${good.userId} | wrong-password ${badMs.toFixed(1)}ms, unknown-user ${ghostMs.toFixed(1)}ms`);
```

```bash
node scripts/prove-password-verify.mjs
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/lib/auth/db.ts src/lib/auth/passwords.ts
```

No `--experimental-strip-types`: type stripping is unflagged in this Node major (measured on v24.21.0), and the flag is only accepted-and-redundant. Node will print `MODULE_TYPELESS_PACKAGE_JSON` because the repo's `package.json` has no `"type"` field; that warning is not a failure and the field must not be added — Next's own files and the repo's CommonJS-era scripts assume the default.

Expected: the PASS line with a real uuid and two millisecond figures, where the unknown-user figure is not less than a third of the wrong-password figure. A `function extensions.crypt(...) does not exist` means pgcrypto was not installed in the `extensions` schema — check `select extname, extnamespace::regnamespace from pg_extension where extname='pgcrypto'` before changing the call. A failure that *mentions* `$2a$` means the image's pgcrypto is older than the hash format — report the `select extversion from pg_extension where extname='pgcrypto'` value rather than switching to a Node library. A `timing-equalising round is gone` failure means the unknown-user path answered in well under a third of the same run's wrong-password path — check that `passwords.ts` still issues its `extensions.crypt($1, extensions.gen_salt('bf', 10))` query before touching the ratio.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/auth/db.ts src/lib/auth/passwords.ts scripts/prove-password-verify.mjs docker/.env.example tsconfig.json
git commit -m "feat(auth): verify staff passwords with pgcrypto over the local pool"
```

---

### Task 10: Isolate the 16 storage call sites behind one module

**Files:**
- Create: `src/lib/files/store.ts`
- Modify: the 14 files that currently call `supabase.storage` — find them with `grep -rln "supabase\.storage" src/` (the plan's earlier pattern, `"\.storage\.from("`, finds only 5 of the 16: 11 sites break the line between `storage` and `.from(`, and a line-anchored grep cannot see them)
- Modify: `src/lib/config.ts:48-52` (add the missing `candidateCvs` bucket)

**Interfaces:**
- Produces:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** A file entry as the portal needs it: the storage key, whether it is a folder,
 *  and the three metadata columns the File Manager renders. A folder is what
 *  storage reports as an entry with no object id. */
export interface FileStoreEntry {
  path: string;
  name: string;
  isFolder: boolean;
  bytes: number | null;
  mimeType: string | null;
  updatedAt: string | null;
}

export interface FileStore {
  upload(input: { bucket: string; path: string; body: Blob | ArrayBuffer | string; contentType?: string; upsert?: boolean }): Promise<{ ok: boolean; error?: string }>;
  signedUrl(input: { bucket: string; path: string; seconds: number; download?: string }): Promise<{ url: string | null; error?: string }>;
  download(input: { bucket: string; path: string }): Promise<{ bytes: Uint8Array | null; contentType: string | null; error?: string }>;
  remove(input: { bucket: string; paths: string[] }): Promise<{ ok: boolean; failed: string[]; error?: string }>;
  list(input: { bucket: string; prefix: string; limit?: number; sortBy?: { column: "name" | "created_at" | "updated_at"; order: "asc" | "desc" } }): Promise<{ entries: FileStoreEntry[]; error?: string }>;
}

/** The caller hands over the client it already holds, so opening this seam can
 *  never change *who* is allowed to touch the byte. Structural, not
 *  `SupabaseClient`, because `createSupabaseServerClient()` returns the `@supabase/ssr`
 *  flavour and a seam that forced a cast at every call site is not a seam. */
export function getFileStore(client: { storage: SupabaseClient["storage"] }): Promise<FileStore>;
```

Task 11 does not touch storage because of this task; Plan 2 adds a disk-backed `FileStore` and changes one `return` inside `getFileStore()`.

**Why `getFileStore` takes a client, and why there is no `vendor.ts`.** An earlier draft of this task created `src/lib/supabase/vendor.ts` returning *one* service-key client, and had all 16 sites go through it. Measured against the tree, that would have quietly escalated privileges on 11 of the 16 sites while claiming to change no behaviour — the current authorities are:

| authority today | sites | where |
| --- | --- | --- |
| request-bound staff client (`createSupabaseServerClient()`, anon key + the signed-in staff JWT, RLS enforced) | 8 | `(admin)/assessments/actions.ts:477`, `(admin)/candidates/assessment-actions.ts:171`, `(admin)/candidates/attachment-actions.ts:37`, `(admin)/candidates/cv-actions.ts:223`, `(admin)/files/actions.ts:128`, `api/files/link/route.ts:51`, `api/files/upload/route.ts:104`, `api/files/upload/route.ts:140` |
| service-role client (`getSupabaseServiceClient()`, `bypassrls`) | 4 | `api/attempt/[token]/video/route.ts:38`, `app/careers/actions.ts:361`, `modules/assessment/application/gradeAttempt.ts:477`, `modules/screening/application/screen-application.ts:210` |
| anon client (`getSupabaseAnonClient()`, no identity — used on a **public** upload route) | 1 | `api/careers/upload/route.ts:83` |
| client received as a function parameter | 3 | `(admin)/files/storage-list.ts:26` (`Supabase`), `modules/careers/cv-links.ts:51` and `:52` (`StaffClient`) |

A single service-key store would have made an anonymous applicant's CV upload, and every staff file read, run as `service_role`. The bucket policies in `supabase/schema.sql` (1763-1798) are the second gate behind the portal's own checks, and dropping them is a decision for whoever replaces the bytes — Plan 2 — not a side effect of a refactor. So: no new client, no new file, and the dated two-backends decision lives in `store.ts`'s header comment instead. Task 17 and Plan 2 delete the three `src/lib/supabase/{server,service,anon}.ts` factories that this seam still delegates through.

- [ ] **Step 1: Re-derive the site list before editing.**

```bash
grep -rn "supabase\.storage" src/ | tee /d/tmp/storage-sites.txt
grep -rln "supabase\.storage" src/ | wc -l
```

Expected: **16 accessor call sites across 14 files** (correction #3). Do not use the pattern `"\.storage\.from("` — it finds only **5**, because 11 of the 16 sites break the line between `storage` and `.from(`, and a line-anchored grep cannot see a call that spans lines. (The spec's §2 "accessor lines | **5**" and §7 "5 `.storage.from(bucket)` lines" are that artifact; Task 18 corrects them.) Paste the list into your commit message body so the next reader can check the count instead of trusting it. If the number differs, stop and reconcile the difference with the tree — the tree wins.

- [ ] **Step 2: Add the bucket `config.ts` omits.** [src/lib/config.ts:48-52](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/lib/config.ts#L48-L52) lists three buckets while `supabase/schema.sql` seeds four, including `candidate-cvs` (line 2162). Add the line so a Plan 2 writer is not pointed at a bucket that already exists:

```ts
  buckets: {
    candidateVideos: "candidate-videos",
    candidateAudio: "candidate-audio",
    candidateCvs: "candidate-cvs",
    resumes: "resumes",
  },
```

- [ ] **Step 3: Write `src/lib/files/store.ts`.**

```ts
/* src/lib/files/store.ts
 * One interface for every byte the portal touches, so the storage *backend* is
 * decided once instead of sixteen times.
 *
 * The dated decision this file exists to record: during Plan 1 the *rows* move
 * to the local Postgres/PostgREST stack while the *bytes* stay with the vendor,
 * because the local `storage.objects` shim holds metadata and no file. So the
 * port runs two backends at once, and every method here still talks to the
 * client it is handed. Plan 2 replaces the body of `getFileStore` with a
 * disk-backed store over `/data/uploads` and a `files` table (spec §7); no call
 * site changes, and the `client` parameter stops being read rather than being
 * cast away.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FileStoreEntry {
  path: string;
  name: string;
  isFolder: boolean;
  bytes: number | null;
  mimeType: string | null;
  updatedAt: string | null;
}

export interface FileStore {
  upload(input: { bucket: string; path: string; body: Blob | ArrayBuffer | string; contentType?: string; upsert?: boolean }): Promise<{ ok: boolean; error?: string }>;
  signedUrl(input: { bucket: string; path: string; seconds: number; download?: string }): Promise<{ url: string | null; error?: string }>;
  download(input: { bucket: string; path: string }): Promise<{ bytes: Uint8Array | null; contentType: string | null; error?: string }>;
  remove(input: { bucket: string; paths: string[] }): Promise<{ ok: boolean; failed: string[]; error?: string }>;
  list(input: { bucket: string; prefix: string; limit?: number; sortBy?: { column: "name" | "created_at" | "updated_at"; order: "asc" | "desc" } }): Promise<{ entries: FileStoreEntry[]; error?: string }>;
}

/** Plan 2 returns a disk-backed store here; no call site changes. */
export async function getFileStore(client: { storage: SupabaseClient["storage"] }): Promise<FileStore> {
  const { storage } = client;
  return {
    async upload({ bucket, path, body, contentType, upsert }) {
      const { error } = await storage
        .from(bucket)
        .upload(path, body, { contentType, upsert });
      return { ok: !error, error: error?.message };
    },
    async signedUrl({ bucket, path, seconds, download }) {
      const { data, error } = await storage
        .from(bucket)
        .createSignedUrl(path, seconds, download === undefined ? undefined : { download });
      return { url: data?.signedUrl ?? null, error: error?.message };
    },
    async download({ bucket, path }) {
      const { data, error } = await storage.from(bucket).download(path);
      if (error || !data) return { bytes: null, contentType: null, error: error?.message };
      const buffer = await data.arrayBuffer();
      // `type` is the blob's own content type, and gradeAttempt hands it to the
      // transcriber. Returning null here would silently pin every recording to
      // that call's "video/webm" fallback.
      return { bytes: new Uint8Array(buffer), contentType: data.type || null, error: undefined };
    },
    async remove({ bucket, paths }) {
      const { error } = await storage.from(bucket).remove(paths);
      return { ok: !error, failed: error ? paths : [], error: error?.message };
    },
    async list({ bucket, prefix, limit = 1000, sortBy }) {
      const { data, error } = await storage.from(bucket).list(prefix, { limit, sortBy });
      return {
        // Storage keys are prefix + leaf, with the separator already inside the
        // prefix ("applications/<id>/"). Joining with "/" here would turn an
        // empty prefix into "/file.pdf" and a real prefix into a doubled slash.
        entries: (data ?? []).map((entry) => ({
          path: `${prefix}${entry.name}`,
          name: entry.name,
          isFolder: typeof entry.id !== "string",
          bytes: typeof entry.metadata?.size === "number" ? entry.metadata.size : null,
          mimeType: typeof entry.metadata?.mimetype === "string" ? entry.metadata.mimetype : null,
          updatedAt: entry.updated_at ?? null,
        })),
        error: error?.message,
      };
    },
  };
}
```

Type notes for the engineer writing this:

- `supabase-js`'s `upload()` accepts `File | Blob | ArrayBuffer | string`, not the wider `BodyInit`. That is why `body` above is already narrowed. If `tsc` still complains, narrow further — do **not** paper over it with `as never`, because the whole point of this seam is that its types describe what Plan 2 must reproduce.
- If `tsc` rejects an entry field (the `storage-js` types vary by version on `metadata`, `id`, `updated_at`), cast *at that one property* with a comment naming what the vendor type got wrong; never widen `FileStoreEntry` to `Record<string, unknown>`, which would move the vendor's shape back into the call sites and defeat the task.
- `getFileStore` is `async` even though this body awaits nothing, so Plan 2's disk store can open files without changing the call sites again.

- [ ] **Step 4: Rewrite each of the 16 sites** to build the store from the client that site already had, then call the matching method:

```ts
const files = await getFileStore(supabase);   // same authority as before this line
```

  - The 8 staff sites, the 4 service sites and the 1 anon site keep their existing client call verbatim above it. Changing which client a site holds is **out of scope for this task and a finding if you do it**.
  - `storage-list.ts` and `cv-links.ts` keep receiving their client as a parameter and call `getFileStore(supabase)` inside; their callers are unchanged.
  - `storage-list.ts`'s `listObjects` now returns `FileStoreEntry[]` (or maps them into its own `ListOutcome`), and the four consumers that read `row.name` / `row.id` / `row.metadata.size` / `row.metadata.mimetype` / `row.updated_at` off untyped entries — `files/actions.ts:175`, `files/actions.ts:256` (the walk), `storage-list.ts:objectMetadata` and anything fed by them — switch to `entry.name`, `entry.isFolder`, `entry.bytes`, `entry.mimeType`, `entry.updatedAt`. The folder rule is `isFolder`, which is the same test the code used (`no object id`). Deleting the `asRecord`/`as unknown[]` casts in those loops is the point of doing it.
  - `gradeAttempt.ts` keeps its fallback: `transcribeRecording(bytes, contentType ?? "video/webm")`.
  - `api/files/link/route.ts:53` passes `download` **only when the response should be a download** — the inline branch must keep sending no disposition.
  - `cv-links.ts:51,52` are two `signedUrl` calls, one with and one without `download`; they stay two calls, and the `null`s-without-throwing contract stays.

Keep the surrounding error handling, logging and activity-trail writes exactly as they are; this task moves a call, it does not change a behaviour. For each file, re-read the site after editing and confirm the same four things survive: the bucket name, the path expression, the failure branch (including the message text a site quotes), and the client the site runs as.

- [ ] **Step 5: Prove nothing regressed.**

```bash
grep -rn "supabase\.storage" src/ | grep -v "src/lib/files/store.ts" | wc -l
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src
node scripts/check-staff-routes.mjs
node scripts/check-themes.mjs
```

Expected: `0` storage accessors outside `store.ts`, `eslint src` silent (0 errors; one pre-existing warning in an untouched file is acceptable — quote it), and the two repo scripts pass. tsc is read on its **output**, not its exit code: the accepted baseline is 2 `error TS` lines + 1 indented continuation, all inside generated `.next/types/validator.ts`. The live file paths cannot be proved on the local stack (no bytes behind the shim) — say so in the commit body rather than implying a proof you did not run. Do not start the dev server.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/files/store.ts src/lib/config.ts
git add -u src
git commit -m "refactor(files): route every storage accessor through one file store"
```

Body: the 16 sites with their `file:line`, the count of files touched, the authority table showing which client each site kept, and the explicit note that byte-level behaviour is unchanged — the store still delegates to the caller's vendor client, so this is a seam, not a migration.


### Task 11: The PostgREST builder, and the one seam that adopts it

**Files:**
- Create: `src/lib/rest/query-builder.ts`
- Create: `src/lib/rest/client.ts`
- Create: `src/lib/rest/auth-shim.ts`
- Create: `src/lib/auth/cookies.ts` (Task 12 extends this same file with the writers; see ruling T11-R1)
- Modify: `src/lib/supabase/server.ts` (whole body)
- Modify: `src/lib/supabase/service.ts`, `src/lib/supabase/anon.ts`
- Modify: `.env.example` (add `SUPABASE_REST_BASE=` — Task 11 is the first task that fails without it)
- Test: `scripts/prove-rest-builder.mjs`

**Interfaces:**
- Consumes: `SUPABASE_REST_BASE` (the gateway `http://localhost:54321/rest/v1`), `mintSessionToken()` / `verifySessionToken()` / `mintServiceToken()` from Task 8.
- Produces: `createRestClient({ baseUrl, token }) => RestClient` where `RestClient` is `{ from(table): Query; rpc(name, body): Promise<Result> }` — `token` may be a string, `null`, or a function returning either, so a service client can mint per request without its callers changing shape (T11-R2); `createAuthShim(readCookie)`; `SESSION_COOKIE = "sdg_session"`; and `createSupabaseServerClient()` — **same name, same import path, same call shape** — returning `{ ...RestClient, auth }`. All 127 call sites and their 454 table chains (442 of them a literal) keep compiling, and `getSupabaseServiceClient()` keeps its synchronous call shape at all 62 of its call sites.

**Why this task creates `src/lib/auth/cookies.ts` (T11-R1).** Step 5's shim needs `SESSION_COOKIE`, and the draft of this task had Task 12 own that file — measured against the tree, `src/lib/auth/` today holds `db.ts login-target.ts passwords.ts session.ts staffRoutes token.ts`, so importing a constant from a file that does not exist until the next task means Task 11's own `tsc` gate cannot pass. The file is therefore created here with the single constant, and Task 12 adds `cookieAttributes()`, `SESSION_TTL_SECONDS` and the writer pair to the same module. The alternative — repeating the literal `"sdg_session"` in Step 6, Step 5, Task 13 and Task 15 — is the drift the plan already forbids in Task 12's Interfaces block.


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

/** A bearer, or a factory for one. The factory may be async because a
 * service-role bearer is a *minted* token with a 60 s life (Task 8), and a
 * client built once at module scope cannot hold a token that expires — see
 * Step 7. Staff and anon callers keep passing a plain string or `null`. */
type Bearer = string | null;
type BearerSource = Bearer | (() => Bearer | Promise<Bearer>);

interface RestClientConfig {
  baseUrl: string;                      // http://localhost:54321/rest/v1
  token: BearerSource;                  // the bearer this request carries
  fetchImpl?: typeof fetch;
}

export function createRestClient(config: RestClientConfig) {
  const doFetch = config.fetchImpl ?? fetch;
  // A trailing slash here produces `http://…/rest/v1//applications`, which
  // PostgREST answers with a 404 that reads like a missing table. Config's own
  // `restUrl` default has always ended in `/rest/v1/`, so the transport strips
  // it rather than trusting every caller.
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  async function authHeaders(): Promise<Record<string, string>> {
    const bearer = typeof config.token === "function" ? await config.token() : config.token;
    return bearer ? { Authorization: `Bearer ${bearer}` } : {};
  }

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
      return { data: null, error: { message: `rest: ${baseUrl} unreachable — ${(cause as Error).message}` }, count: null };
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

  async function run(table: string, builder: QueryBuilder): Promise<Result> {
    const shape = builder.shape_();
    const headers: Record<string, string> = {
      Accept: shape.single || shape.maybeSingle ? "application/vnd.pgrst.object+json" : "application/json",
      ...(await authHeaders()),
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
      // the port would mean editing 454 chains — the thing spec §1 forbids.
      return Object.assign(builder, {
        then<T1, T2>(onFulfilled: (r: Result) => T1 | PromiseLike<T1>, onRejected?: (e: unknown) => T2 | PromiseLike<T2>) {
          return run(table, builder).then(onFulfilled, onRejected);
        },
      });
    },

    async rpc(name: string, body?: object): Promise<Result> {
      const url = `${baseUrl}/rpc/${encodeURIComponent(name)}`;
      let res: Response | null = null;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", ...(await authHeaders()) },
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

- [ ] **Step 4b: Create `src/lib/auth/cookies.ts`** with only the constant, so Step 5 can import it and `tsc` can pass. Task 12 adds `cookieAttributes()`, `SESSION_TTL_SECONDS` and the writer pair to this same module — it must not recreate the file.

```ts
/** The one cookie name for a staff session. Task 12's writer, Task 13's proxy
 * and Task 15's browser proof all read it from here; a literal repeated in
 * five files is how a cookie gets renamed in four of them. */
export const SESSION_COOKIE = "sdg_session";
```

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
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { createRestClient } from "@/lib/rest/client";
import { createAuthShim } from "@/lib/rest/auth-shim";

/**
 * The one seam. 127 call sites construct this per request; none of them knows
 * that PostgREST is now ours. Returns the same `{ from, rpc, auth }` shape the
 * supabase-js client did, which is why the port is a re-point rather than a
 * rewrite (spec §6).
 */
export async function createSupabaseServerClient() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? null;
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

Two notes on that file. The cookie name comes from `src/lib/auth/cookies.ts` (Step 4b), not a literal — the same constant is what Task 12 writes, Task 13's proxy reads and Task 15 inspects in DevTools. And `process.env` is read here instead of `src/lib/config.ts` deliberately: `config.ts`'s existing `restUrl` is derived from `NEXT_PUBLIC_SUPABASE_URL` and ends in `/rest/v1/`, which is the vendor URL this task is retiring, so pointing the new transport at it would send the app back to the vendor through the door Task 11 is closing. Task 17 replaces `restUrl` with `restBase: optional(process.env.SUPABASE_REST_BASE)` in `config.ts` and these three reads with it; a trailing slash in the value is already harmless because `createRestClient` strips it.

- [ ] **Step 7: Re-point the other two server factories**, or the port is decorative. `createSupabaseServerClient` reaching the local stack means nothing while **62 call sites of `getSupabaseServiceClient()` across 22 consumer files** still reach the vendor and 8 of `getSupabaseAnonClient()` across 6 files reach it too — the service client in particular writes candidate records, drains the WhatsApp queue and reads the tracking codes, so leaving it on the vendor would split every flow down the middle.

Two surfaces the service factory still has to answer for, measured before writing this step: `getFileStore(supabase)` at four of its sites (Step 7b) and `supabase.auth.admin.*` at **13 sites in `src/modules/settings/application/user-actions.ts`** (113, 134, 211, 230, 254, 270, 460, 521, 541, 587, 597, 633, 687, 776, 782, 808, 830, 881, 905, 967, 993, 1074, 1093, 1167 — the *client* is made 13 times, some clients make two admin calls). Those 13 calls are GoTrue's admin API over a `users` table that does not become ours until Task 14, so this task re-points the **rows** and hands back the vendor's `auth` untouched:

```ts
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";
import { createRestClient } from "@/lib/rest/client";
import { mintServiceToken } from "@/lib/auth/token";

/**
 * Service-role access. BYPASSES Row Level Security via `bypassrls` — the local
 * `service_role` has the `bypassrls` attribute (01-roles.sql), and PostgREST
 * maps this bearer's `role` claim onto that database role.
 *
 * The bearer is a short-lived token signed here with `AUTH_JWT_SECRET`, so no
 * long-lived secret leaves the process.
 *
 * `auth` is the ONE surface still pointed at the vendor: GoTrue's admin API has
 * no local equivalent until Task 14 writes `authAdmin()` over the ported
 * `auth.users` (Task 4). Every `.from()`/`.rpc()` on this object is local.
 */
let serviceAuth: ReturnType<typeof createClient>["auth"] | null = null;

export function getSupabaseServiceClient() {
  const base = process.env.SUPABASE_REST_BASE;
  if (!base) {
    throw new Error("[supabase] SUPABASE_REST_BASE is not set — run the local stack (Tasks 1-2).");
  }
  serviceAuth ??= createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey!).auth;
  return {
    // Lazy bearer, so the factory stays synchronous AND no bearer can outlive
    // its own expiry: the token is minted per request, not per module.
    ...createRestClient({ baseUrl: base, token: () => mintServiceToken(60) }),
    auth: serviceAuth,
  };
}
```

That is the second reason `token` is a function (T11-R2). A module-global client holding a 60-second token is a bug — a page rendered at the 61st second would send an expired bearer and get a 401 that reads like an RLS failure; a global holding an hour-long token trades that for an hour of un-revocable privilege. Minting per call costs a local HMAC over a 36-byte payload, measured in microseconds, and buys both: the shortest TTL in the system *and* the call shape every one of the 62 sites already uses. **No call site changes in this step, and `await` must not be added to any of them** — if `tsc` reports a `Promise` here, the factory went async by accident.

`src/lib/supabase/anon.ts` keeps its whole doc comment — the `jobs_public_read` reasoning is still exactly why a tokenless read is safe to prerender — and replaces the body with `createRestClient({ baseUrl, token: null })`. **Delete the mock-client branch** (`anon.ts:31-40`), which today silently returns empty data during a build with no credentials. Without the vendor there is no "no credentials" state that is worth supporting: the base URL is a local container, and the build now genuinely requires the stack to be up. That is a real consequence of this migration, not a regression — say so in the commit body, because it means `npm run build` on a machine with no `docker compose up` will now fail loudly where it used to produce a quietly empty careers page.

- [ ] **Step 7b: Cut the last vendor dependency the row re-point exposes — `getFileStore`'s client.** Task 10 handed each of the 15 call sites' *existing* client to `getFileStore(client)`, which was right then: all three factories were vendor clients, so the request-bound staff client kept the vendor's bucket policies as a second gate. This step removes the vendor row clients, and that removes the premise. Measured against the vendor's own auth, a staff bearer from `mintSessionToken()` is signed with *our* `AUTH_JWT_SECRET` and is rejected by gotrue, so after this task **there is no vendor identity left for a staff or service byte** — the only credential that can still reach the vendor's storage API is `SUPABASE_SERVICE_ROLE_KEY`. Do not smuggle that through by hanging a service-key `storage` off all three factories, which would look per-authority and not be. State it in one place instead:

```ts
/**
 * The bytes still live with the vendor (spec §7: the local `storage.objects`
 * shim holds metadata, not files), and after Task 11 the vendor has no other
 * identity for us — our session token is signed with `AUTH_JWT_SECRET`, which
 * gotrue will not accept. So every byte the portal touches here moves under
 * the service key, which is a deliberate widening relative to the eight staff
 * sites that used to run under the signed-in staff JWT and the vendor's bucket
 * policies. The portal's own checks — the staff guard, the ownership predicates
 * in the actions, the format table on the upload routes — are now the gate on
 * a byte. Plan 2 deletes this whole path: `getFileStore()` returns a
 * disk-backed store over `/data/uploads` + a `files` table, the vendor client
 * and `@supabase/supabase-js` go with it (Task 17's importer list shrinks by
 * this file), and the widening ends the day the bytes do.
 */
const vendor = createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey!);

export async function getFileStore(): Promise<FileStore> {
  const { storage } = vendor;
  …the same five method bodies as Task 10 wrote…
}
```

Then change the 15 `getFileStore(supabase)` call sites (14 files) to `getFileStore()` — the client variable stays wherever the same file also reads rows, and `storage-list.ts` / `cv-links.ts` keep the parameter their callers pass for *their* row queries. `tsc` finds every one you miss: an extra argument to a zero-parameter function is an error, not a warning.

- [ ] **Step 8: Prove the builder against the running stack** (this is the first time app code and PostgREST meet):

```bash
node --experimental-strip-types scripts/prove-rest-builder.mjs
node --env-file=.env.local --input-type=module -e "
process.env.SUPABASE_REST_BASE='http://localhost:54321/rest/v1';
const fs=await import('node:fs');
process.env.AUTH_JWT_SECRET=fs.readFileSync('docker/.env','utf8').match(/^AUTH_JWT_SECRET=(.+?)\r?$/m)[1];
const { createRestClient } = await import('./src/lib/rest/client.ts');
const { mintSessionToken } = await import('./src/lib/auth/token.ts');
const { Pool } = await import('pg');
const pool = new Pool({ connectionString: process.env.AUTH_DB_URL });
const { rows: [{ auth_user_id }] } = await pool.query(
  \"select auth_user_id from public.user_profiles where role = 'SUPER_ADMIN' and email = 'owner.local@sharmdreams.test' limit 1\");
await pool.end();
const token = await mintSessionToken({ sub: auth_user_id, role: 'authenticated' });
const api = createRestClient({ baseUrl: process.env.SUPABASE_REST_BASE, token });
const r = await api.from('user_profiles').select('id, role');
console.log('rows', Array.isArray(r.data) ? r.data.length : r.data, 'error', r.error?.message ?? null);
const c = await api.from('user_profiles').select('*', { count: 'exact', head: true });
console.log('count', c.count);
" --experimental-strip-types
```

The `sub` must be **looked up, not invented** (T11-R3): `profiles_self_read` is `(auth_user_id = auth.uid()) OR is_staff()`, and `is_staff()` is the only half that admits a row it does not own. With a fabricated uuid both halves are false → **0 rows and no error**, and Step 8 would then blame `is_staff()` for losing `SECURITY DEFINER` — a false alarm manufactured by the probe itself. `scripts/prove-local-stack.mjs:95-101` already reads a real staff `auth_user_id` this way; copy that rather than inventing a uuid.

Expected: `rows 3 error null` (Task 6 seeded three profiles, and a `SUPER_ADMIN`'s `auth_user_id` makes `is_staff()` true for all of them), then `count 3`. If the row count is 3 but `count` is `null`, the HEAD/`Prefer: count=exact` path is wrong — that is the bug this probe exists to catch, since three sites read counts that way.

- [ ] **Step 9: Typecheck, lint, and run the whole repo's gates** — 127 call sites now resolve to a new type, so this is the first gate that will actually complain:

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Expect real fallout, and fix it at the *builder*, not at the call sites: a chain the builder does not support is a missing method, not a bug in the caller. Record in the commit body how many distinct call-site errors appeared and which methods you had to add. If a method outside the measured 24 shows up, your measurement was wrong — re-run the greps and update Slice C's preamble table. The two errors you must NOT see are (a) any complaint about `getSupabaseServiceClient()` needing an `await` — it does not, see Step 7 — and (b) a `.storage` error on a row client, because Step 7b removed the parameter.

- [ ] **Step 10: Commit.**

```bash
git add src/lib/rest src/lib/auth/cookies.ts src/lib/files/store.ts
git add src/lib/supabase/server.ts src/lib/supabase/service.ts src/lib/supabase/anon.ts
git add -u src
git commit -m "feat(rest): serve the 454 query chains from our own PostgREST client"
```

Body: the tsc error count you started with and ended with; any builder method you had to add beyond the measured 24; the 15 `getFileStore(supabase)` → `getFileStore()` edits with the reason Step 7b gives (a staff byte has no vendor identity after this task, so the service key is the only credential that reaches the vendor's storage API, and the portal's own checks are now the gate on a file); the deliberate removal of `anon.ts`'s credential-free mock, with the consequence that `npm run build` now requires the local stack; the fact that `getSupabaseServiceClient()` stayed synchronous at all 62 sites; and the deliberate intermediate state the next two tasks inherit — reads go through our PostgREST while `src/proxy.ts` still verifies a gotrue session and the Team console's 13 `auth.admin.*` calls still hit the vendor, which is also why `src/lib/auth/cookies.ts` is created here with one constant rather than waiting for Task 12.

---

## Slice D — the door: cookies, sign-in, sign-out, and the idle window

The vendor's auth service did four things for this app: checked a password, issued a JWT, kept that JWT in a cookie jar the browser could not read, and refreshed it. Tasks 8–11 built the JWT and the password check. This slice wires them to the door, and in doing so removes the last thing the browser used to talk to Supabase about.

**The one design change worth stating before it surprises anyone.** [src/app/login/LoginForm.tsx:31-35](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/login/LoginForm.tsx#L31-L35) calls `signInWithPassword` *from the browser*, and [src/modules/analytics/presentation/SignOutButton.tsx:25](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/analytics/presentation/SignOutButton.tsx#L25) calls `signOut()` there too. That is possible only because gotrue is a public HTTP endpoint. On the local stack **there is no browser-reachable auth endpoint on purpose** — `rest` publishes no port (Task 2) and the gateway answers only `/rest/v1`, which cannot verify a password. So sign-in becomes a Server Action that runs on the Next server, and the cookie becomes `httpOnly`, which is strictly better than what the vendor gave us: today the browser jar holds `sb-…` tokens that any XSS on the portal could read.

The cost: the password crosses to the server as form data over the app's own origin, and the sign-in form can no longer show gotrue's specific error strings. Three reasons are enough (`wrong_password`, `unknown_user`, `banned`), and the copy is written in Step 4.

### Task 12: Session cookies and the sign-in action

**Files:**
- Modify: `src/lib/auth/cookies.ts` (Task 11 Step 4b created it with `SESSION_COOKIE`; this task adds the rest — do not recreate the file or duplicate the constant)
- Create: `src/app/login/actions.ts`
- Modify: `src/app/login/LoginForm.tsx`
- Modify: `src/modules/analytics/presentation/SignOutButton.tsx`
- Delete: nothing yet — `src/lib/supabase/client.ts` loses its last importers here and is removed in Task 17.

**Interfaces:**
- Consumes: `verifyStaffPassword(email, password)` from Task 9, returning `{ ok: true, userId } | { ok: false, reason: "unknown_user" | "wrong_password" | "banned" }`; `mintSessionToken({ sub, role }, ttlSeconds?)` from Task 8 — the optional TTL exists precisely so this file can pass `SESSION_TTL_SECONDS` instead of inheriting the token's 900-second default.
- Produces: `SESSION_COOKIE` / `LAST_ACTIVE_COOKIE` constants; `startSession(userId)` and `endSession()` — the Server-Action-side pair that writes through `next/headers`. Task 13 adds the proxy-side pair, `writeSession(response, userId)` / `clearSession(response)`, to this same file. Also the server actions `signInAction(formData)` and `signOutAction()`. Task 11 Step 4b already created this file with `SESSION_COOKIE`, because Task 11's own shim and `server.ts` read it — so this task extends that module rather than writing it, and the two tasks are a pair in the direction of the writers only.

- [ ] **Step 1: Extend `src/lib/auth/cookies.ts`.** Task 11 Step 4b created this file with `SESSION_COOKIE` alone; keep that line and add the rest below to it. A second `export const SESSION_COOKIE` is a redeclaration error, and if you wrote the file from scratch instead, Task 11's `server.ts` and Task 11 Step 5's shim silently now point at a different module than the one the writers use.

```ts
import { cookies } from "next/headers";
import { mintSessionToken } from "@/lib/auth/token";

/** The signed session bearer. httpOnly, so no script on any page can read it. */
export const SESSION_COOKIE = "sdg_session";

/** When this browser last touched a staff page. Read by the proxy's idle timeout. */
export const LAST_ACTIVE_COOKIE = "sdg_staff_last_active";

/**
 * The bearer's lifetime in seconds, used for its `exp` and for the
 * `sdg_session` cookie's `maxAge` together.
 *
 * Those two must be equal: a cookie that outlives its bearer reads as "signed
 * in" while every query 401s, and a bearer that outlives its cookie is
 * unreachable.
 *
 * The value is 24 hours because `security.session_timeout_minutes` is
 * operator-configurable from 15 to 1440 minutes
 * (`src/modules/settings/domain/schema.ts:235-236`, seeded at 480), and the
 * idle timeout is enforced by Task 13's proxy by comparing that window against
 * `sdg_staff_last_active`. A one-hour bearer would sign an unread dashboard tab
 * out at 60 minutes on an 8-hour setting: the bearer's expiry becomes the de
 * facto timeout and the setting stops meaning anything. At 86_400 the bearer
 * lives exactly as long as the longest window staff can configure, so the idle
 * check always bites first or at the same instant. Task 8's 15-minute default
 * would be worse still, silently signing an idle tab out every quarter-hour
 * regardless of any setting.
 *
 * This is a ceiling on an *idle* gap, not on a session's length — Task 13
 * re-mints the bearer on every staff request, so an active staff member never
 * sees it.
 */
const SESSION_TTL_SECONDS = 86_400;

/**
 * The idle stamp lives 30 days, deliberately longer than the bearer it
 * accompanies.
 *
 * That is counter-intuitive after the rule above, but the proxy reads the stamp
 * as `Number(request.cookies.get(LAST_ACTIVE_COOKIE)?.value)` and skips the
 * idle branch entirely when the result is not finite
 * (`src/lib/supabase/middleware.ts:137-144`), so an *absent* stamp reads as
 * "active". A stamp that expired before its session would therefore disable the
 * timeout instead of enforcing it. 30 days is what
 * `src/lib/supabase/middleware.ts:159-167` already writes for this same cookie
 * name, so the two writers agree; Task 13 folds that file's duplicate
 * `sdg_staff_last_active` literal (`middleware.ts:21`) into this module.
 */
const LAST_ACTIVE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The attributes the two writes share — only the lifetime differs per cookie. */
function cookieAttributes(maxAge: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    // Locally this is http://localhost and the flag would make the cookie
    // unsendable; production terminates TLS at the gateway (Plan 2) and sets it.
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

export async function startSession(userId: string): Promise<void> {
  const jar = await cookies();
  const token = await mintSessionToken({ sub: userId, role: "authenticated" }, SESSION_TTL_SECONDS);
  jar.set(SESSION_COOKIE, token, cookieAttributes(SESSION_TTL_SECONDS));
  // Stamp activity at the door so the first portal request after sign-in is not
  // itself judged as an idle one.
  jar.set(LAST_ACTIVE_COOKIE, String(Date.now()), cookieAttributes(LAST_ACTIVE_TTL_SECONDS));
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(LAST_ACTIVE_COOKIE);
}
```

That is the whole file for now — two writers, not three. The renewal the proxy needs is `writeSession`, which Task 13 adds here: the proxy cannot call `cookies()` at all, so a `next/headers`-based `renewSession` would be dead code the moment it was written, and dead code in the identity spine is worse than missing code.

**Correction applied when this task was implemented (ledger `T12-R2`/`T12-R3`):** the draft's `SESSION_TTL_SECONDS = 3600` and its single shared `cookieAttributes()` object are both superseded by the fence above — a one-hour bearer capped the idle ceiling below the longest window staff can configure (15…1440 min), and the idle stamp must outlive the bearer or its absence reads as "active". Task 13's writer reuses `cookieAttributes(maxAge)` with the two module-local lifetimes in this same file.

Neither setter takes an email: `SessionUser.email` already comes from `user_profiles`, and a parameter the function discards would misdescribe the interface. The two writes share the one `cookieAttributes(maxAge)` helper but **not** one lifetime: the session cookie's `maxAge` equals its bearer's `exp`, while the idle stamp lives 30 days, because the proxy skips its idle branch when the stamp is unreadable (`middleware.ts:137-144`) — an *absent* stamp reads as "active", so a stamp that expired with the bearer would disable the timeout instead of enforcing it. The app owns exactly these two cookie names, so `endSession` deletes exactly these two; sweeping other names "just in case" would delete a cookie Plan 2 has not invented yet.

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

**Corrected as this task was implemented (ledger `T12-R4`…`T12-R6`) — the fence above is the draft, the landed `src/app/login/actions.ts` is the contract.** Four things in it were wrong: (1) `await endSession()` on *every* failure tore down a live session on a merely-wrong password, while the throttled and empty-credential returns left it alone — `verifyStaffPassword` answers `banned` only *after* the password compared true (`src/lib/auth/passwords.ts:48-49`), so the teardown belongs on the `banned` branch alone; (2) `recordFailure(email)` ran *after* the ~250 ms bcrypt `await`, so a concurrent burst all read an under-limit Map and every request reached the verifier — the charge now happens before the `await`, in the same synchronous block as the check, which makes "8 attempts" 8 concurrent attempts too; (3) a `banned` answer consumed the same budget, which buried the one sentence that tells a disabled staff member to ask a super admin — it now releases its pre-charge like a success does, and only the two guessing reasons count; (4) the Map was keyed by an attacker-chosen string with no eviction path for a key never retried, so a long-lived container grew without bound — expired entries are now swept where the write already happens, and `MAX_TRACKED_KEYS` caps it.

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

[src/lib/supabase/middleware.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/lib/supabase/middleware.ts) is 171 lines that do five things, and exactly one of them needs the vendor: `createServerClient(...)` + `supabase.auth.getUser()` is a **network round trip on every matched request** whose only answer is "is this JWT valid". [src/lib/auth/token.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/lib/auth/token.ts) from Task 8 answers that locally with an HMAC compare, so the port is a downgrade in latency and an upgrade in behaviour. Everything else in the file — the staff-path redirect, the role check, the timeout read, the idle sign-out — moves unchanged. The `sb-` jar cleanup does **not**: Step 2's difference #1 replaces it with `clearSession`, which deletes exactly the two cookies this app owns.

**Files:**
- Create: `src/lib/auth/guard.ts`
- Modify: `src/lib/auth/cookies.ts` (add the proxy-side writers)
- Modify: `src/proxy.ts` (whole body)
- Delete: `src/lib/supabase/middleware.ts`

**Interfaces:**
- Consumes: `verifySessionToken(token)` from Task 8, `SESSION_COOKIE` / `LAST_ACTIVE_COOKIE` / `cookieAttributes(maxAge)` / `SESSION_TTL_SECONDS` / `LAST_ACTIVE_TTL_SECONDS` from Task 12 (all module-local in `cookies.ts`, which is why the writers land in the same file — the bearer is written with the first lifetime and the stamp with the second), `isStaffPath()` / `loginSearch()` which stay where they are, `coerceNumber` from `@/modules/settings/infrastructure/settingsReader`.
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
  response.cookies.set(SESSION_COOKIE, token, cookieAttributes(SESSION_TTL_SECONDS));
  response.cookies.set(LAST_ACTIVE_COOKIE, String(Date.now()), cookieAttributes(LAST_ACTIVE_TTL_SECONDS));
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

/**
 * `security.session_timeout_minutes` fallback, matching the seeded row.
 *
 * Used only when the read fails or the row is unreadable, so a database hiccup
 * leaves the timeout at the value the platform ships with rather than signing
 * every recruiter out on a short window.
 */
const DEFAULT_SESSION_TIMEOUT_MINUTES = 480;

/**
 * How long the proxy remembers the idle window between requests.
 *
 * `readGlobalSettings` is cached for the render, but the proxy runs outside it
 * and cannot use `"use cache"`, and one portal click fires this file once per
 * matched request. Without a memo the same GLOBAL row was read on every one of
 * them. A saved timeout therefore takes up to a minute to bite here — the bound
 * the cached render reads already accept.
 */
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
  const verified = bearer ? await verifySessionToken(bearer) : null;
  // A signature that checks is not yet a session. `role` only picks which
  // Postgres role `authenticator` switches into, and the RLS predicates key off
  // `auth.uid()` and `is_staff()` — measured in Task 8's review, an `anon`-role
  // token carrying a staff `sub` reads the same rows as an `authenticated` one,
  // while a `service_role` token reaches `jobs` outright, where a staff token is
  // refused with 403. This app mints `authenticated` at sign-in and nothing else,
  // so any other role on a request is a hand-made jar and is dropped exactly like
  // an expired one. Task 16's cron token never reaches this code path.
  const claims = verified?.role === "authenticated" ? verified : null;

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
  //
  // `error` is logged, not branched on: "row missing" and "read refused" must
  // both fall through to the page-level `requireStaff` (difference #3), but
  // `createRestClient` answers an unreachable gateway with
  // `{ data: null, error }` rather than a throw, so a logged error is the only
  // trace this gate's failure mode leaves. Silence here reads as "no candidate
  // got in", and the bounce would have stopped enforcing without anyone seeing.
  const { data: profile, error: profileError } = await api
    .from("user_profiles")
    .select("role")
    .eq("auth_user_id", claims.sub)
    .maybeSingle();
  if (profileError) {
    console.warn("[guard] staff role read failed; falling through to requireStaff", profileError.message);
  }

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
2. It **renewal-writes on every staff request**, which the old file could not do — the vendor's token was refreshed inside `getUser()`, and here the bearer is re-minted with a fresh `exp`. This is what keeps a working recruiter signed in past the bearer's own lifetime.
3. `profile && !STAFF_ROLES.has(...)` keeps the current file's odd-but-correct shape: a **missing profile row does not redirect here**, it falls through to the page-level `requireStaff`, which is the guard that has the redirect-with-context. "No profile" and "wrong role" are different failures and only one of them is a candidate poking at the portal.

**Corrections applied when this task was reviewed (ledger `T13-R1`/`T13-R3`):** The fence above originally carried one-line versions of the two timeout comments, which threw away the reasoning that protects correction #5 — a reader who does not know the proxy runs outside the render cache and cannot use `"use cache"` is exactly the reader who "improves" the memo, and a reader who does not know the 60 s bound is *user-visible* ("a saved timeout takes up to a minute to bite") cannot judge whether it is acceptable. The deleted file's full paragraphs are restored. Separately, difference #3's shape silently swallowed the profile read's `error`: `createRestClient` answers an unreachable gateway with `{ data: null, error }` rather than a throw, so "PostgREST is down", "row missing" and "read refused" all read as a falsy profile, and the only layer keeping a signed-in candidate out of recruiter analytics would stop enforcing with no trace. The pass-through semantics are unchanged — an outage must not lock a recruiter out — but the error is now logged, because a silent fail-open is indistinguishable from "no candidate got in".

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

Two things still assume the vendor after Task 13: [src/lib/auth/session.ts:37-49](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/lib/auth/session.ts#L37-L49) resolves the signed-in staff member through `supabase.auth.getUser()`, and [src/modules/settings/application/user-actions.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts) drives the entire Team console through `supabase.auth.admin.*` — **13 call sites, all in that one file**, measured as `listUsers` ×6 ([user-actions.ts:143](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L143), [:279](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L279), [:469](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L469), [:791](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L791), [:1002](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L1002), [:1102](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L1102)), `updateUserById` ×4 ([:550](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L550), [:606](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L606), [:817](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L817), [:839](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L839)), `deleteUser` ×2 ([:239](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L239), [:914](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L914)), `createUser` ×1 ([:220](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L220)) — 6+4+2+1 = 13. Those are the staff create / deactivate / password-reset / edit actions built in tasks #52 and #182–#184, and without an equivalent the Team console is a page of buttons that throw.

The admin surface is *not* a PostgREST problem — `auth` is deliberately outside `PGRST_DB_SCHEMAS` (Task 2), so no HTTP route may reach `auth.users`. It is a `pg` problem: the same pool Task 9 opened can read and write that table as the superuser. That is why the shim sits on the pool and not on the builder.

**Files:**
- Modify: `src/lib/auth/session.ts`
- Create: `src/lib/auth/admin-users.ts`
- Modify: `src/lib/supabase/service.ts` (replace the vendor `auth` handle with `admin: authAdmin`)
- Modify: `src/lib/rest/auth-shim.ts` (one line: what counts as a session)
- Modify: `src/modules/settings/application/user-actions.ts` (the `ServiceClient` doc comment only — Step 4)
- Already done in Task 11, verified not re-edited: `question-actions.ts`, `suite-authoring-actions.ts`, `cv-actions.ts`, `questions/actions.ts`, `src/modules/live/infrastructure/changeWatch.ts`, `permissions.ts` all import `type { RestClient }`

**Interfaces:**
- Consumes: `verifySessionToken()` (Task 8), `getAuthPool()` (Task 9), `createRestClient()` (Task 11), the cookie jar.
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
// The `@/` alias is safe in this file and only in this file: `server-only`
// means Next loads it, so no plain-Node probe has to resolve the specifier
// (contrast Task 9's `./db.ts`, which a probe does import).
import { getAuthPool } from "@/lib/auth/db";

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
      // `banned_until` is cast to text HERE, not left as the `timestamptz` `pg`
      // hands back as a JS Date: `AdminUserRow` declares `string | null`, and
      // `user-actions.ts:483` puts the value into a `Record<string, string|null>`
      // that the Team console renders. Returning a Date would make that type a
      // lie that only shows up as a formatting bug in the browser.
      `select id, email, raw_user_meta_data as user_metadata,
              to_char(banned_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as banned_until
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
       values ('authenticated', 'authenticated', lower($1), extensions.crypt($2, extensions.gen_salt('bf', 10)),
               case when $3 then now() else null end, $4::jsonb, now(), now())
       returning id`,
      [input.email, input.password, input.email_confirm ?? false, JSON.stringify(input.user_metadata ?? {})],
    );
    if (error) return { data: null, error };
    return { data: { user: rows[0] }, error: null };
  },

  async updateUserById(
    id: string,
    patch: { email?: string; email_confirm?: boolean; password?: string; ban_duration?: string; user_metadata?: Record<string, unknown> },
  ): Promise<Result<null>> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.email) {
      values.push(patch.email.toLowerCase());
      sets.push(`email = $${values.length}`);
      // GoTrue's `email_confirm` is the same column Task 12's INSERT writes, and
      // the Team console's rename path sets it: a moved address that comes back
      // unconfirmed is an account that cannot sign in.
      values.push(patch.email_confirm !== false);
      sets.push(`email_confirmed_at = case when $${values.length} then coalesce(email_confirmed_at, now()) else null end`);
    }
    if (patch.password) {
      values.push(patch.password);
      sets.push(`encrypted_password = extensions.crypt($${values.length}, extensions.gen_salt('bf', 10))`);
    }
    if (patch.ban_duration !== undefined) {
      values.push(banUntil(patch.ban_duration));
      sets.push(`banned_until = $${values.length}`);
    }
    if (patch.user_metadata) {
      values.push(JSON.stringify(patch.user_metadata));
      sets.push(`raw_user_meta_data = $${values.length}::jsonb`);
    }
    if (sets.length === 0) return { data: null, error: null };

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
    return { rows: (await getAuthPool().query(text, values)).rows, error: null };
  } catch (cause) {
    const e = cause as { message?: string; code?: string };
    return { rows: [], error: { message: e.message ?? "Database error", code: e.code } };
  }
}
```

The `23505` unique-violation code survives this path untouched: `run` forwards Postgres' own `code`, and [user-actions.ts:230-234](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L230-L234) branches on exactly that to say "That email is already in use." Do not flatten it into a string.

The `sets` fragments in `updateUserById` are the only place in this file where SQL is assembled rather than written: each pushed string is a literal column assignment, and every value still travels as a `$n` parameter. Keep it that way — a caller-supplied column name here would be the injection this whole file exists to avoid.

- [ ] **Step 3: Attach it to the SERVICE client** so the 13 sites keep compiling. `src/lib/rest/auth-shim.ts` is the wrong host for `admin` and was named here before the call sites were counted: every one of the 13 reaches `auth.admin.*` through `getSupabaseServiceClient()`, while the shim is attached to `createSupabaseServerClient()` — a handle no admin call ever touches. So in `src/lib/supabase/service.ts`: delete the `serviceAuth` global and its `createClient` import, delete the `SUPABASE_SERVICE_ROLE_KEY` throw (it existed only to feed that handle — the row calls sign with `mintServiceToken`), and return `auth: { admin: authAdmin }` beside the spread. `ReturnType<typeof getSupabaseServiceClient>` — which is what `user-actions.ts` calls `ServiceClient` — then still has `.auth.admin.*`, and nothing else in `src` reads `.auth` on this object: measured, the only other `.auth.*` uses are `getUser()` on the *server* client (`session.ts:41`, `job-actions.ts:141`, `transcriptStore.ts:71`, `credential-actions.ts:252/388/462/657`, `user-actions.ts:311`), and those already go through the shim.

  Update this file's own doc comment while you are in it — "`auth` is the ONE surface still pointed at the vendor" is false from this commit onward.

  One more line, in `src/lib/rest/auth-shim.ts:19`, because this task is what makes it wrong: `if (!c || c.role === "anon") return null;` accepts *any* non-`anon` claim as a user, while Step 1's `getSessionUser` and `src/lib/auth/guard.ts:71` both require `role === "authenticated"`. A `service_role` bearer in the session cookie is dropped at the door by the guard and still read as a signed-in user by every call site behind it. Not exploitable today — minting requires `AUTH_JWT_SECRET`, and anyone holding it can use PostgREST directly — but the two layers must state one definition of "a session". Change the shim to `if (!c || c.role !== "authenticated") return null;`.

- [ ] **Step 4: Confirm the type annotations are already swapped, and fix the prose that says otherwise.** This step was written against the tree before Task 11 moved the row calls; re-measured at HEAD there is nothing left to swap — `question-actions.ts:4`, `suite-authoring-actions.ts:4`, `cv-actions.ts:4`, `questions/actions.ts:4`, `permissions.ts:5` and `changeWatch.ts:4` (its real path is `src/modules/live/infrastructure/changeWatch.ts`, not the settings one written here) all already import `type { RestClient } from "@/lib/rest/client"`. Run the check rather than trusting this sentence:

```bash
grep -rn "SupabaseClient" src
```

Expected: one line, `src/modules/settings/application/user-actions.ts:21`, inside the doc comment above `type ServiceClient`. That comment is now false twice over — it says the thirteen admin calls "keep compiling against the passed-through handle", and Step 3 removes the handle. Rewrite it to say what the object actually is now: a `RestClient` shape over `src/lib/rest` plus the local `authAdmin`. The other prose to correct is `src/lib/rest/auth-shim.ts`'s own comment if Step 3's edit makes it stale.

`src/app/(candidate)/portal/actions.ts` is allowed to still import `createClient` from `@supabase/supabase-js` — it is the owner's off-limits file, and the consequence is spec correction #6: the package stays installed through Plan 1.

- [ ] **Step 5: Gates**, then the live proof in Task 15.

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/lib/auth src/lib/rest src/lib/supabase src/modules/settings
node scripts/check-staff-routes.mjs
```

- [ ] **Step 6: Commit.**

```bash
git add src/lib/auth src/lib/supabase/service.ts src/lib/rest/auth-shim.ts src/modules/settings/application/user-actions.ts
git add -u src
git commit -m "feat(auth): resolve staff sessions and team CRUD without an auth service"
```

Body: the 13 admin sites with the verb each one uses (**6 `listUsers`, 4 `updateUserById`, 2 `deleteUser`, 1 `createUser`**), the `23505` code forwarding, the `user.email` claim fallback that was deliberately dropped, the fact that `getSessionUser` kept its `cache()` wrapper on purpose (task #327), and that the vendor service handle is gone — after this commit nothing in `src` except the owner's off-limits `portal/actions.ts` and `src/lib/files/store.ts` (Task 17) reaches `@supabase/supabase-js` for auth.

**Corrections applied when this task was reviewed (ledger `T14-R1`…`T14-R4`):** the draft attached `authAdmin` to `src/lib/rest/auth-shim.ts`, which is the handle the Team console never uses — Step 3 now attaches it to the service client and deletes the vendor passthrough that only existed to feed the 13 admin calls; Step 4's seven-file annotation swap had already happened in Task 11, so it is now a check plus a prose fix; `updateUserById`'s patch gained `email_confirm` because [user-actions.ts:839-842](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/settings/application/user-actions.ts#L839-L842) sends it as a plain literal; and `listUsers` casts `banned_until` to UTC text because `pg` hands back a `Date` while `AdminUserRow` and the console's `Record<string, string | null>` both say `string`.

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
AUTH_DB_URL=<the same docker/.env value, copied not printed>
APP_URL=http://localhost:3000
```

`AUTH_DB_URL` belongs in this list because Task 14 put it on the critical path: `getAuthPool()` throws without it, and after that task both sign-in (`verifyStaffPassword`) and every Team-console action run through that pool. PostgREST never sees this string — it is the app's own superuser connection, which is exactly why it stays out of `PGRST_DB_URI`.

`APP_URL` matters beyond cosmetics: task #313 made assessment links use the host the app actually runs on, so a stale `3001` here would send a candidate to a port nothing listens on.

- [ ] **Step 2: Start the dev server on 3000** in its own terminal, and leave the owner's 3001 server alone:

```bash
./node_modules/.bin/next dev -p 3000
```

- [ ] **Step 3: Sign in as the recruiter fixture** in the browser, at `http://localhost:3000/login`, and confirm in DevTools → Application → Cookies that `sdg_session` exists with **HttpOnly** and `SameSite=Lax`, and that **no `sb-` cookie was created**. A jar still carrying `sb-` names means the old middleware is somehow still in the chain.

- [ ] **Step 4: Walk the portal** — `/dashboard`, `/candidates`, `/jobs`, `/settings`, and the Team console at `/settings?area=access&section=team`. (Corrected 2026-10-21 after the first run: **there is no `/team` route** — `src/app/(admin)/settings/page.tsx:190-214` renders `TeamSection` as the `team` *section* of the `access` area, and the 16 admin routes are the ones the sidebar lists.) Each must render without error. "Real rows" is only literal on `/settings` and the Team console: `scripts/seed-local-staff.mjs` seeds staff and settings, no openings or applications, so `/candidates` and `/jobs` correctly show their empty states — record that as the expected result, not a failure. Then prove the identity actually reached Postgres: open `/activity`, and confirm a trail row written by this session names *this* user (that is `auth.uid()` resolving through `request.jwt.claims ->> 'sub'` — correction #2 — and it is the single check that distinguishes "policies parse" from "policies evaluate").

- [ ] **Step 5: Exercise the Team console**, because Task 14's admin shim is otherwise unproven: create a staff account, deactivate it, reset its password, edit its name, delete it. Every one of those is a different `authAdmin` verb, and the create path is the only place `23505` matters — create a second account with the same email and confirm the refusal is a clean sentence rather than a raw constraint dump. (Corrected 2026-10-21: the sentence the running app shows is **"A user with that email already exists."** from the `listUsers` pre-check at `src/modules/settings/application/user-actions.ts:279-281`, *not* "That email is already in use." — that wording belongs to the `user_profiles` insert fallback at `:241` and only a race between the pre-check and the insert can reach it. Either sentence satisfies the check; a `duplicate key value violates unique constraint` dump would not.)

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
- Keep dependency: `@supabase/supabase-js` — spec correction #6, for TWO importers, not one: the dead fallback branch in the off-limits `(candidate)/portal/actions.ts`, and `src/lib/files/store.ts`, which since Task 11 Step 7b is the only thing in the app that still reaches the vendor for **bytes**. Task 17's gate is therefore "the remaining importers are exactly those two files", and Plan 2's disk store is what deletes the second.
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

Carry one forward note while you are in the toolchain (Task 9's review found it): `tsconfig.json` now sets `"allowImportingTsExtensions": true` for a single import specifier, and that option is only legal beside `"noEmit": true`. This task must **not** add a `tsc` emit step, a build script that compiles with `tsc`, or an `outDir`. If any later plan wants the repo to emit, that pairing has to be replaced with `rewriteRelativeImportExtensions` or the literal `./db.ts` specifier dies at runtime instead of at the compiler.

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

- [ ] **Step 1: Wipe and rebuild from nothing.** `docker compose down -v` (this deletes the local database — local only, never hosted), then `docker compose up -d --build`, `node scripts/apply-local-schema.mjs` and **`npm run db:seed-local`** (which is `node scripts/seed-local-staff.mjs`). Expected: the counts printed by Task 4 match a fresh `supabase/schema.sql`, and `node scripts/prove-local-stack.mjs` passes all 8 checks, including the load-bearing one: `user_profiles?select=id` answers **200**, not a refusal. Skip the seed and the gate dies at its first line with `run scripts/seed-local-staff.mjs first` — on a wiped volume there is no staff fixture for it to mint a token from, so the seed step is part of the clean slate, not an optional extra. Re-running proofs that Tasks 1 and 3 wrote as `node -e` with the password interpolated into a URI should use `docker exec sharm-dreams-local-db-1 psql -U postgres -d sharm_dreams -c …` instead: the local `pg_hba.conf` trusts loopback, so a credential on the command line buys nothing and risks a misparse.

- [ ] **Step 2: Run the browser proof** (Task 15) against that rebuilt stack, from sign-in through the idle timeout to the Team console.

- [ ] **Step 3: Fix the two figures in the spec.** Edit [docs/superpowers/specs/2026-10-20-docker-self-host-migration-design.md](file:///D:/Nextjs%20Projects/sharm_dreams_group/docs/superpowers/specs/2026-10-20-docker-self-host-migration-design.md):
  - §2's "5 `supabase.storage.from(bucket)` accessor lines" → **16 accessor call sites across 14 files** (`createSignedUrl` ×5, `download` ×4, `remove` ×3, `upload` ×3, `list` ×1). Name the grep that proves it, because a naive `grep -c "\.storage"` returns **23** — the extra 7 are `storage_path` *column* reads, not accessor calls, and quoting 23 would be the same class of error as the 5.
  - §5's `db-anon-role = authenticated` → `anon`, with the reason from correction #1.
  - The RLS policy count → re-count at execution time with `grep -c "^create policy" supabase/schema.sql` and write the number the file says, not the number the spec says. Do the same for every count in this plan before you rely on it.

- [ ] **Step 4: Fix the same figures in the status report.** [docs/STATUS-2026-10-20.md](file:///D:/Nextjs%20Projects/sharm_dreams_group/docs/STATUS-2026-10-20.md) §5 repeats the 5, and §2.4 still calls the cron routes "the two routes nothing schedules" — which is now false, so add the Plan 1 line and its commit hash to §2.4 rather than quietly rewriting history.

- [ ] **Step 5: Say what is left.** Append a "Plan 1 complete, Plan 2 open" section to the status file listing exactly: bytes still live with the vendor (`storage.objects` holds rows, not files — and since Task 11 Step 7b every byte the portal touches is read and written under the service key, so the vendor's bucket policies are no longer a second gate on staff or applicant files); `@supabase/supabase-js` still installed for two importers (the dead fallback in the off-limits candidate file, and `src/lib/files/store.ts`); `@vercel/speed-insights` still loaded; no TLS yet; the live `pg_dump` restore still unrun; KVM2 untouched. This is the list the owner reads to decide what happens next, so it must not round up.

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
