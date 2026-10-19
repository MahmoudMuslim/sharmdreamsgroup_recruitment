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

### Required

| Variable | Read by | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | config.ts | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | config.ts | Public anon key (inlined into the client bundle). |
| `SUPABASE_SERVICE_ROLE_KEY` | config.ts (server) | Privileged writes; never sent to the browser. |
| `SETTINGS_ENCRYPTION_KEY` | crypto/secrets.ts | ≥ 32 chars. Generate: `node scripts/generate-encryption-key.mjs`. Without it, storing provider credentials throws `EncryptionUnavailableError`. |
| `CRON_SECRET` | config.server.ts | Required by `/api/cron/*`; those routes **fail closed (503)** when it is unset. **Not in `.env.example` — add it.** |

### Optional — app

| Variable | Default | Notes |
|----------|---------|-------|
| `APP_URL` | `http://localhost:3001` | Canonical app URL (`appConfig.url`). |
| `SUPABASE_PROJECT_REF` / `SUPABASE_REST_URL` | derived from URL | Overrides. |
| `SUPABASE_DB_PASSWORD` | — | Used by the direct-`pg` scripts only. |

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
node scripts/create-staff.mjs        # provisions a SUPER_ADMIN user + profile

# 3. Local dev (Turbopack)
npm run dev                          # http://localhost:3001
```

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
