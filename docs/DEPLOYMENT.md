# Deployment

The app is a standard **Next.js 16** server (App Router, Turbopack) with **no separate backend** — route handlers and Server Actions run in the Next.js process and talk to Supabase directly. Deploy it anywhere a Node server (or Vercel) runs, and point it at a Supabase project with the schema applied.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [AUTHENTICATION.md](AUTHENTICATION.md) · [AI_INTEGRATION.md](AI_INTEGRATION.md) · [TESTING.md](TESTING.md)

---

## Prerequisites

- **Node.js 20+** (Next 16 / React 19).
- A **Supabase project** (PostgreSQL 17) with `supabase/schema.sql` applied and `supabase/seed.sql` loaded.
- At least one **AI provider key** (or the app runs with AI features degraded and a clear "No AI provider is configured" error).

---

## Environment variables — what the code actually reads

Copy `.env.example` → `.env.local`, then set these. The lists below are the variables the source truly reads (`src/lib/config.ts`, `src/lib/config.server.ts`, `src/lib/crypto/secrets.ts`).

Re-derive the whole list with
`grep -rhoE "process\.env\.[A-Z_0-9]+" src | sed 's/process\.env\.//' | sort -u`
and diff it against the tables here. Everything that table prints but these
tables do not name is deliberately absent, because it is not operator config:
`NODE_ENV`, `VERCEL`, `NEXT_PHASE` and `PORT` are read as facts about the host,
and `HOME`, `USERPROFILE`, `QODER_CLI_HOME`, `QODER_CONFIG_DIR` are set and read
by `src/modules/screening/infrastructure/qoderCompletion.ts` for its own agent-SDK
worker directory.

### Required

| Variable | Read by | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | config.ts | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | config.ts | Public anon key (inlined into the client bundle). |
| `SUPABASE_SERVICE_ROLE_KEY` | config.ts (server) | Privileged writes; never sent to the browser. |
| `SETTINGS_ENCRYPTION_KEY` | crypto/secrets.ts | ≥ 32 chars. Generate: `node scripts/generate-encryption-key.mjs`. Without it, storing provider credentials throws `EncryptionUnavailableError`. |
| `CRON_SECRET` | config.server.ts | Required by `/api/cron/*`; those routes **fail closed (503)** when it is unset. **Not in `.env.example` — add it.** |
| `AUTH_JWT_SECRET` | `src/lib/auth/token.ts:59` (`secret()`) | HS256 secret for the session bearer the app mints and verifies itself. Throws `TokenConfigError` when absent or shorter than 32 chars, and that throw is on the sign-in path — **without it every login 500s**. Must equal `PGRST_JWT_SECRET`, or PostgREST refuses every token the app issues. |
| `AUTH_DB_URL` | `src/lib/auth/db.ts:16` (`getAuthPool()`) | Postgres connection string for the app's own auth pool. Throws when unset, and that pool is what reads the password hash and writes staff rows — **without it password verification and all staff CRUD fail**. Host form `postgresql://postgres:…@localhost:54320/sharm_dreams`; inside the compose network the stack overwrites it with the `db:5432` form. |

### Optional — app

| Variable | Default | Notes |
|----------|---------|-------|
| `APP_URL` | `http://localhost:3000` | Canonical app URL (`appConfig.url`), and the last resort for candidate-facing links. The address a test link carries is resolved by `src/lib/public-url.ts` in this order: **Settings → General → Public site address** (`organisation.public_url`), then `APP_URL` when it names a real host, then the host the request arrived on, then — in development only — this machine's LAN address. Set `APP_URL` (or the setting) on any deployment; a loopback value there means the cron drain has nothing better to fall back to. |
| `SUPABASE_REST_BASE` | — | Where the app's PostgREST answers. Four modules read it straight from the environment (`src/lib/supabase/{anon,server,service}.ts` and `src/lib/auth/guard.ts`) and throw when it is unset, so it is required, not optional: the host's dev server uses `http://localhost:54321/rest/v1` (through the Caddy gateway) while a container in the compose network uses `http://rest:3000` with no prefix, because `/rest/v1` belongs to the proxy. |
| `SUPABASE_PROJECT_REF` | derived from URL | Override. (`SUPABASE_REST_URL` was retired in Task 17 — the deleted `src/lib/supabase/rest.ts` was its only reader, so naming it here is a no-op.) |
| `SUPABASE_DB_PASSWORD` | — | Used by the direct-`pg` scripts only. |
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

> **`.env.example` drift to fix before trusting it:** the template still lists `WHATSAPP_TOKEN` (the registry's display var — the *runtime* reads `WHATSAPP_CLOUD_API_TOKEN`), a `WHATSAPP_WEBHOOK_URL` pointing at `/api/webhooks/whatsapp` (**that route does not exist**), `WHATSAPP_APP_SECRET` (not read), `ENABLE_*` feature flags (not read), and `NEXT_PUBLIC_APP_URL` at `:3000` (the code reads `APP_URL`, default `:3001`). It also omits `CRON_SECRET`. Treat the tables above as authoritative.

---

## Install & run

```bash
npm install

# 1. Apply the database (pick one path)
node scripts/apply-schema.mjs        # consolidated schema.sql (idempotent)
node scripts/verify-schema.mjs       # confirm tables/policies landed

# 2. Generate the encryption key, then create a first admin
node scripts/generate-encryption-key.mjs
node scripts/create-staff.mjs        # HOSTED PROJECT ONLY - writes to GoTrue, deleted in Plan 2

# 3. Local dev (Turbopack)
npm run dev                          # http://localhost:3001
```

> **On the self-hosted stack, `create-staff.mjs` is the wrong command.** It talks
> to the vendor's hosted GoTrue (`supabase.auth.admin.*`), so it creates the
> account in the Supabase project, reports success, and the local login — which
> reads `auth.users` through `AUTH_DB_URL`
> (`src/lib/auth/passwords.ts:37`) — cannot see it. What works locally:
>
> - `npm run db:seed-local` — the three staff fixtures, written straight into the
>   local `auth.users` with pgcrypto bcrypt. Fixtures only.
> - **Settings → Team** inside the running app (`/settings`, `createUser` in
>   `src/modules/settings/application/user-actions.ts:258`) — real account
>   provisioning through `authAdmin`. Needs a signed-in `SUPER_ADMIN`, so seed
>   first, then create the people you actually want.
>
> `create-staff.mjs` is for the hosted project only and is scheduled for deletion
> in Plan 2.

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

## Target: Vercel

1. Import the repo; set the **Environment Variables** above (at minimum the five required ones).
2. Framework preset **Next.js**; build/start scripts come from `package.json`.
3. Add `@qoder-ai/qoder-agent-sdk` is already marked `serverExternalPackages` in `next.config.ts` — no extra config needed for its on-disk worker.
4. **Crons:** add a `vercel.json` `crons` entry (or use the Vercel UI) pointing at `/api/cron/whatsapp` and `/api/cron/grading`, sending the `x-cron-secret: $CRON_SECRET` header.

## Target: Docker / any Node host

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
EXPOSE 3000
CMD ["npm","start"]
```

Provide the env vars at runtime; nothing is baked into the image. Put a scheduler (pg_cron, systemd timer, or an external cron) behind the two `/api/cron/*` endpoints with the shared secret header.

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
- [ ] `CRON_SECRET` set; both cron routes return 200 with the header, 503 without.
- [ ] A staff login reaches `/dashboard`; a candidate token reaches only its own attempt.
- [ ] Public careers board, apply form, and the careers assistant work unauthenticated.
- [ ] Storage buckets `resumes`, `candidate-audio`, `candidate-videos` exist with RLS.
- [ ] `npm run build` passes both prebuild guards.

---

## Security notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client; it is read only in server modules.
- `provider_credentials` has RLS with **zero policies** — only the service role can read it; secrets are AES-256-GCM at rest.
- Run `node scripts/audit-secrets.mjs` to scan for accidentally committed secrets before publishing.
- Prefer the session (JWT) client everywhere so RLS stays the enforcement layer.
