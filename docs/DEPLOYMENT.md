# Deployment

The app is a standard **Next.js 16** server (App Router, Turbopack) with **no separate backend** — route handlers and Server Actions run in the Next.js process. It has three doors into its own data: rows over HTTP to our PostgREST, the identity reads and writers (password hashes, staff CRUD, `public.files` metadata) over `AUTH_DB_URL` with the `pg` pool, and file bytes on a local directory. The first door is RLS-enforced; the second reaches the `auth` schema, which is deliberately *not* in `PGRST_DB_SCHEMAS`, so no HTTP route can read it. Deploy it as the Docker stack described at the end of this file: one Compose project holding Postgres, PostgREST, the app, nginx and the cron poller. Nothing outside that project is required, and nothing in the app calls a hosted service for data.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [AUTHENTICATION.md](AUTHENTICATION.md) · [AI_INTEGRATION.md](AI_INTEGRATION.md) · [TESTING.md](TESTING.md)

---

## Prerequisites

- **Docker with the Compose v2 plugin** — `docker/docker-compose.yml` is the stack, and the app container is only ever proved inside it.
- **Node.js 24** for a host-side `npm run dev` against that stack (the image is `node:24.22.0-alpine3.24`).
- At least one **AI provider key** (or the app runs with AI features degraded and a clear "No AI provider is configured" error).

There is no external database to provision. Postgres, PostgREST and the gateway
come up with `npm run docker:up`, and `npm run db:apply-local` loads
`supabase/schema.sql` into the container's own cluster — see *Target: self-hosted
Docker stack* at the end of this file.

---

## Environment variables — what the code actually reads

Copy `.env.example` → `.env.local`, then set these. The lists below are the variables the source truly reads (`src/lib/config.ts`, `src/lib/config.server.ts`, `src/lib/crypto/secrets.ts`). Note that `.gitignore`'s `.env*` rule means the root template is not tracked in a fresh clone; `docker/.env.example` is, and carries the Compose stack's own values.

Re-derive the whole list with
`grep -rhoE "process\.env\.[A-Z_0-9]+" src | sed 's/process\.env\.//' | sort -u`
and diff it against the tables here. Everything that table prints but these
tables do not name is deliberately absent, because it is not operator config:
`NODE_ENV`, `NEXT_PHASE` and `PORT` are read as facts about the host,
and `HOME`, `USERPROFILE`, `QODER_CLI_HOME`, `QODER_CONFIG_DIR` are set and read
by `src/modules/screening/infrastructure/qoderCompletion.ts` for its own agent-SDK
worker directory.

### Required

| Variable | Read by | Notes |
|----------|---------|-------|
| `REST_BASE_URL` | `src/lib/supabase/{anon,server,service}.ts`, `src/lib/auth/guard.ts` | Where the app's PostgREST answers. Four modules read it straight from the environment and throw when it is unset, so **every row read and write fails without it**. The host's dev server uses `http://localhost:54321/rest/v1` (through the Caddy gateway) while a container in the compose network uses `http://rest:3000` with no prefix, because `/rest/v1` belongs to the proxy. It was called `SUPABASE_REST_BASE` until spec §15 Task 9 renamed it. |
| `SETTINGS_ENCRYPTION_KEY` | crypto/secrets.ts | ≥ 32 chars. Generate: `node scripts/generate-encryption-key.mjs`. Without it, storing provider credentials throws `EncryptionUnavailableError`. |
| `CRON_SECRET` | config.server.ts | Required by `/api/cron/*`; those routes **fail closed (503)** when it is unset. **Not in `.env.example` — add it.** |
| `AUTH_JWT_SECRET` | `src/lib/auth/token.ts:59` (`secret()`) | HS256 secret for the session bearer the app mints and verifies itself. Throws `TokenConfigError` when absent or shorter than 32 chars, and that throw is on the sign-in path — **without it every login 500s**. Must equal `PGRST_JWT_SECRET`, or PostgREST refuses every token the app issues. |
| `AUTH_DB_URL` | `src/lib/auth/db.ts:16` (`getAuthPool()`) | Postgres connection string for the app's own auth pool. Throws when unset, and that pool is what reads the password hash, writes staff rows and keeps the `public.files` size/mime metadata — **without it password verification, all staff CRUD and every stored-byte write fail**. Host form `postgresql://postgres:…@localhost:54320/sharm_dreams`; inside the compose network the stack overwrites it with the `db:5432` form. |
| `UPLOADS_ROOT` | `src/lib/files/paths.ts:66` | The one directory every stored byte resolves inside; a path that lands outside it is refused. `/data/uploads` in the app container (the `uploads` named volume), `.data/uploads` for a host-side `next dev`. **Without it, upload and download throw** — see spec §7. |

> The vendor's five names — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
> `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` — are read
> by no module under `src` any more, and `next build` inlines no `NEXT_PUBLIC_*`
> Supabase value into the client bundle. `node scripts/audit-secrets.mjs` asserts
> both of those against the built artifact. They still appear in the four
> hosted-only scripts under `scripts/`, which are the door the last dump came
> through and are deleted once the hosted project is closed.

### Optional — app

| Variable | Default | Notes |
|----------|---------|-------|
| `APP_URL` | `http://localhost:3000` | Canonical app URL (`appConfig.url`), and the last resort for candidate-facing links. The address a test link carries is resolved by `src/lib/public-url.ts` in this order: **Settings → General → Public site address** (`organisation.public_url`), then `APP_URL` when it names a real host, then the host the request arrived on, then — in development only — this machine's LAN address. Set `APP_URL` (or the setting) on any deployment; a loopback value there means the cron drain has nothing better to fall back to. |
| `AUTH_TOKEN_TTL_SECONDS` | `900` | `src/lib/auth/token.ts:93`. The bearer's lifetime; `cookies.ts` signs the session cookie with its own 86 400 s ceiling, and the proxy re-mints on every staff request, so this value only bounds a token that never gets refreshed. Anything that is not a whole number of seconds from 1 to 86 400 throws instead of minting a token with a null `exp` (which PostgREST reads as *never expires*). |
| `AUTH_TOKEN_ISSUER` | `sharm-dreams-local` | `src/lib/auth/token.ts:36`. The `iss` every token carries, and the one verify compares against. Empty falls back to the default. |
| `AUTH_TOKEN_AUDIENCE` | `sdg_local` | `src/lib/auth/token.ts:37`. The `aud` the app mints, verifies, **and the same variable `PGRST_JWT_AUD` is read from** in `docker/docker-compose.yml`, so the two cannot be rotated apart. Changing it signs out every session at once. |
| `COOKIE_SECURE` | — | `src/lib/auth/cookies.ts:83`. Forces the session cookies' `Secure` flag (`true`/`false`); anything else, including unset, decides it from `APP_URL`'s scheme. Set it behind a TLS-terminating proxy that fronts a plain-HTTP `APP_URL`. |

### Optional — AI providers (Settings → API keys wins over these)

`OPENROUTER_API_KEY`, `GOOGLE_AI_STUDIO_API_KEY`, `OPENCODE_API_KEY`, `QODER_API_KEY`, `CLOUDFLARE_AI_API_TOKEN` + `CLOUDFLARE_AI_ACCOUNT_ID`, `NVIDIA_API_KEY`, `AI_REQUEST_TIMEOUT_MS` (90000). Model-chain defaults: `AI_MODEL_PRIMARY`, `AI_MODEL_FAST`, `AI_MODEL_REASONING`, `AI_MODEL_FALLBACK`.

### Optional — WhatsApp & email

| Variable | Notes |
|----------|-------|
| `WHATSAPP_CLOUD_API_TOKEN` | **This is the name the runtime reads** (`omnichannelConfig.whatsapp.apiToken`). |
| `WHATSAPP_PHONE_NUMBER_ID` | Graph sender. |
| `WHATSAPP_VERIFY_TOKEN` | Default `sharm-dreams-verify`. |
| `SMTP_HOST` / `SMTP_PORT` (587) / `SMTP_USER` / `SMTP_PASSWORD` / `EMAIL_FROM` | Email channel defaults; overridable in the encrypted store. |
| `WHATSAPP_CRON_BATCH_SIZE` (50) / `GRADING_CRON_BATCH_SIZE` (10) | Sweep sizes. |

> **`.env.example` drift to fix before trusting it:** the template still lists `WHATSAPP_TOKEN` (the registry's display var — the *runtime* reads `WHATSAPP_CLOUD_API_TOKEN`), a `WHATSAPP_WEBHOOK_URL` pointing at `/api/webhooks/whatsapp` (**that route does not exist**), `WHATSAPP_APP_SECRET` (not read), `ENABLE_*` feature flags (not read), and `APP_URL` at `:3000` while `npm run dev` actually listens on `:3001` (so the template's value is not the one a local link test will exercise). It also omits `CRON_SECRET`. Its `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_*` block and `NEXT_PUBLIC_APP_URL` were deleted in spec §15 Task 9; `REST_BASE_URL` replaced the first of those. Treat the tables above as authoritative.

---

## Install & run

```bash
npm install

# 1. Bring up the stack: Postgres on 127.0.0.1:54320, PostgREST behind the Caddy
#    gateway on 127.0.0.1:54321.
cp docker/.env.example docker/.env    # then fill in the secrets
npm run docker:up

# 2. Apply the database and prove the identity/RLS shim answers like the app expects
npm run db:apply-local
npm run stack:prove

# 3. Generate the encryption key, then seed the staff fixtures
node scripts/generate-encryption-key.mjs
npm run db:seed-local

# 4. Local dev (Turbopack) — needs REST_BASE_URL, AUTH_DB_URL, AUTH_JWT_SECRET,
#    UPLOADS_ROOT and SETTINGS_ENCRYPTION_KEY in .env.local
npm run dev                          # http://localhost:3001
```

`node scripts/apply-schema.mjs` and `verify-schema.mjs` still exist, but they
address the hosted project through the `SUPABASE_*` values in `.env.local`; the
local path is `npm run db:apply-local`, which reads the same
`supabase/schema.sql` against the `db` container.

> **Staff accounts come from the stack, not from a script.** The hosted
> `scripts/create-staff.mjs` is retired: it wrote into the vendor's GoTrue
> (`supabase.auth.admin.*`) and reported success on an account this app could
> never see, because the local login reads `auth.users` through `AUTH_DB_URL`
> (`src/lib/auth/passwords.ts:37`). What provisions people now:
>
> - `npm run db:seed-local` — the three staff fixtures, written straight into the
>   local `auth.users` with pgcrypto bcrypt. Fixtures only.
> - **Settings → Team** inside the running app (`/settings`, `createUser` in
>   `src/modules/settings/application/user-actions.ts:258`) — real account
>   provisioning through `authAdmin`. Needs a signed-in `SUPER_ADMIN`, so seed
>   first, then create the people you actually want.

---

## Build

`prebuild` runs two guards before `next build`; both must pass:

```bash
npm run build
#  → node scripts/check-staff-routes.mjs   (route dirs == STAFF_ROUTES == NAV)
#  → node scripts/check-themes.mjs          (4 themes each painted in globals.css)
#  → next build
```

Run them individually with `npm run check:routes` / `npm run check:themes`. Start the production server with `npm start`. Lint with `npm run lint`.

---

## Target: a platform that is not the Compose stack

There is no supported non-Docker production path, and there is no Vercel target:
the app signs its own session tokens, reads its own `auth` schema over `pg`, and
keeps candidate bytes on a filesystem it owns (`UPLOADS_ROOT`). A serverless host
gives you none of those three. If you do run `next build` + `next start` on a bare
Node host anyway, the requirements are the five required variables above, a
PostgREST pointed at the same database, and a scheduler that sends
`x-cron-secret` to `/api/cron/whatsapp` and `/api/cron/grading`.

## Target: Docker / any Node host

The image is `docker/app/Dockerfile`, built by Compose, not by the sketch above.
`prebuild` runs inside the builder stage, so the two guards gate the image too.
Nothing vendor-facing is passed as a build argument: the client bundle inlines no
key, which is what `node scripts/audit-secrets.mjs` checks against the built
artifact. Provide the env at runtime through `docker/.env`; the app container
takes the rest from `env_file: ../.env.local`, with its `environment:` block
overriding the in-network forms of `REST_BASE_URL` and `AUTH_DB_URL` and the
published `APP_URL`.

---

## Target: self-hosted Docker stack (KVM2)

`docker/docker-compose.yml` is the stack the app now runs on — Postgres,
PostgREST, the built app, nginx in front on `${NGINX_PORT}`, and the cron
poller. Values come from `docker/.env` (copy `docker/.env.example`);
`npm run docker:up` starts it, `npm run db:apply-local` applies
`supabase/schema.sql`, `npm run db:seed-local` writes the local staff fixtures.

### Rotating `LOCAL_PGRST_PASSWORD`

The PostgREST login role's password is **env-authoritative on a fresh volume**:
`docker/db/initdb/05-set-pgrst-password.sh` runs after `00-roles.sql` and resets
`authenticator` to `LOCAL_PGRST_PASSWORD`, which the same file passes to
`PGRST_DB_URI`. The literal in `00-roles.sql` is only the first-boot default used
when the variable is unset or empty.

To rotate it on a host:

1. Change `LOCAL_PGRST_PASSWORD` in the secrets file that feeds `docker/.env`
   (never in the committed `.env.example`).
2. `npm run docker:wipe` — **this deletes the `db-data` volume.**
3. `npm run docker:up`, then `npm run db:apply-local` and `npm run db:seed-local`
   (or restore a `pg_dump`) to rebuild the database it removed.

Step 2 is not optional bookkeeping: `/docker-entrypoint-initdb.d` runs only while
`PGDATA` is empty, so on an existing volume the role keeps the password it was
first given and `rest` restart-loops against a `PGRST_DB_URI` that no longer
matches it. That is the failure this rule exists to prevent — if you see `rest`
cycling with a `password authentication failed for user "authenticator"`, the
volume predates the value in `docker/.env`.

---

## Scheduled jobs

Both cron endpoints accept `GET` or `POST` and require `x-cron-secret`:

| Endpoint | Does | Suggested cadence |
|----------|------|-------------------|
| `/api/cron/whatsapp` | Drains `scheduled_whatsapp_jobs` (stage-change alerts). | every 1–5 min |
| `/api/cron/grading` | Re-grades submitted attempts whose AI grading failed. | every 5–15 min |

---

## Post-deploy checklist

- [ ] `SETTINGS_ENCRYPTION_KEY` set and provider credentials save (Settings → API keys).
- [ ] `CRON_SECRET` set; both cron routes return 200 with the header, 503 without, and the `cron` container is actually calling them (`docker compose logs cron`).
- [ ] A staff login reaches `/dashboard`; a candidate token reaches only its own attempt.
- [ ] Public careers board, apply form, and the careers assistant work unauthenticated.
- [ ] `npm run stack:prove` — the identity/RLS parity gate over the running stack.
- [ ] `UPLOADS_ROOT` is the mounted `uploads` volume and bytes round-trip through the streaming route: `npm run files:serve` against the container.
- [ ] `npm run build` passes both prebuild guards.

---

## Security notes

- There is no long-lived privileged key to leak. The `service_role` bearer is minted per request by `src/lib/auth/token.ts` from `AUTH_JWT_SECRET` and lives for 60 s; nothing in the client bundle carries a credential at all, because `next build` no longer inlines a vendor key.
- `provider_credentials` has RLS with **zero policies** — only the service-role bearer can read it; secrets are AES-256-GCM at rest.
- Run `node scripts/audit-secrets.mjs` (and again with the image's `.next/static` copied out, as its header describes) before publishing: it scans the shipped bundle for every secret value in `.env.local`, then asserts the deploy surface reads no vendor credential.
- Prefer the session-token client everywhere so RLS stays the enforcement layer. The direct `pg` pool (`AUTH_DB_URL`) is the deliberate exception — it is the only way in to the `auth` schema and to `public.files` metadata, and it is what `authAdmin` keeps narrow on purpose.
