# Contributing

Thanks for working on **Sharm Dreams Talent Cloud** — an AI-driven HRMS / ATS / skill-assessment platform for Sharm Dreams Group, built on **Next.js 16 (App Router, Turbopack)** and run on a self-hosted Docker stack: Postgres and PostgREST from this repo's `docker/docker-compose.yml`, files on the stack's own volume. There is no hosted data platform — the only outbound calls the app makes are to the AI providers, Meta's Graph API and the configured SMTP server.

This guide covers setup, layout, conventions, and the checks that must pass before a change lands. For deep dives see [`docs/`](docs/).

---

## Documentation map

| Doc | Read it when… |
|-----|---------------|
| [README](README.md) | You want the overview and how to run the app. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | You need to know where code belongs. |
| [docs/API.md](docs/API.md) | You're adding a route handler or Server Action. |
| [docs/DATABASE.md](docs/DATABASE.md) | You're changing tables, RLS, or the `public.files` / uploads store. |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | You're touching roles, permissions, or secrets. |
| [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md) | You're working with the model gateway. |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | You're configuring env vars or shipping. |
| [docs/TESTING.md](docs/TESTING.md) | You want to know how a change is verified. |
| [docs/RESEARCH.md](docs/RESEARCH.md) | You want the product/feature-parity background. |

---

## Get set up

```bash
npm install

# 1. The stack's own config, then the database containers
cp docker/.env.example docker/.env    # fill in its secrets; tracked, and required
npm run docker:up                     # db + rest + gateway + app + nginx + cron
npm run db:apply-local                # load db/schema.sql into the db container
npm run db:seed-local                 # staff fixtures the local login can use

# 2. Your host-side .env.local (untracked — `.gitignore`'s `.env*` covers the root
#    template too, so a fresh clone has no .env.example to copy; create the file and
#    set REST_BASE_URL, AUTH_DB_URL, AUTH_JWT_SECRET, UPLOADS_ROOT, SETTINGS_ENCRYPTION_KEY, CRON_SECRET)
node scripts/generate-encryption-key.mjs   # prints the AES key line to paste in

# 3. Prove the doors before you change anything
npm run stack:prove                   # identity + RLS parity
npm run dev                           # http://localhost:3001
```

The whole set-up is Docker-first: `node scripts/apply-schema.mjs` is a **HOSTED-ONLY** doorway to the retired vendor project and is not how you get a local database. Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the env list and the template's known drift.

---

## Project layout

```
src/
├── app/            # App Router: pages, route handlers (/api), per-page actions.ts
│   ├── (admin)/    # 16 protected pages
│   ├── (candidate)/# portal + tokenized test runner
│   ├── careers/    # public job board + apply + assistant
│   └── api/        # route handlers
├── modules/        # clean-architecture domains (domain/application/infrastructure/presentation)
├── lib/            # REST clients (lib/data-api + lib/rest), auth/sessions, files, crypto, config, theme, i18n
├── stores/         # Zustand
└── types/          # shared TS interfaces
db/                  # schema.sql (the consolidated DDL the stack loads), migrations/ (history), seed.sql
docker/             # docker-compose.yml, db/initdb/, nginx/, .env.example — the whole self-hosted stack
scripts/            # build guards + DB/maintenance scripts
docs/               # the documentation set above
```

---

## Conventions

- **Server components by default**; add `"use client"` only where interactivity requires it.
- **Layering**: pages/route-handlers authorize and render; business logic lives in `src/modules/<domain>`; the database is reached through one of exactly three doors — the PostgREST client (`src/lib/data-api` over `REST_BASE_URL`), the `pg` pool for the `auth` schema (`src/lib/auth/db.ts`), or the uploads volume (`src/lib/files`).
- **Validate at the boundary** with Zod before any DB write.
- **Prefer the request's session bearer** (`createSupabaseServerClient`) so RLS enforces access. `getSupabaseServiceClient` mints a short-lived `service_role` bearer that **bypasses RLS** — use it only for a privileged write after re-checking the permission in code.
- **Fail closed**: a missing secret or permission is an error, never a permissive default.
- **`server-only`** guards any module that reads secrets — importing it from a client component must stay a build error.
- Match the surrounding code's comment density and naming; the codebase explains *why* in comments — keep that habit.

### Adding an admin page

A new page under `src/app/(admin)/<route>/page.tsx` must be registered in **both** `STAFF_ROUTES` (`src/lib/auth/staffRoutes.ts`) and the rail `NAV`, or `check-staff-routes.mjs` fails the build. Guard it with `requireStaff("/<route>")`.

### Changing the database

Edit `db/schema.sql` **and** add an ordered migration in `db/migrations/0NN_*.sql` — the schema file is what the stack loads, the migration is the history that explains the change. Apply to the running stack with `npm run db:apply-local` (whole file) or `npm run docker:psql` (one migration), then prove the identity/RLS contract still holds:

```bash
npm run stack:prove    # identity + RLS parity against the local stack
```

Enable RLS on every new table. `node scripts/verify-schema.mjs <file>` is marked **HOSTED-ONLY**: it reads `.env.local` and compares a catalog against `schema.sql`, so it only belongs to the local stack when deliberately aimed at it with `ZZ_DB_URL`.

### Theming

Themes are CSS tokens in `src/app/globals.css` (`lib/theme.ts`). All four (Base/Liquid-glass × Light/Dark) must stay painted or `check-themes.mjs` fails. Opt a surface *out* of the glass frost with a dedicated class (see `.careers-chat-shell`) rather than editing the shared frost selector.

---

## Before you open a PR

```bash
npm run check:routes
npm run check:themes
npm run audit:secrets   # fatal on the deploy surface; see the exit contract below
npx --no-install next typegen
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
npm run lint
npm run build          # runs all three guards, then the full type-check
```

Then walk the relevant manual checks in [docs/TESTING.md](docs/TESTING.md) — including the proofs that need the stack running (`npm run stack:prove`, `npm run files:prove`, `npm run files:serve`).

**Keep docs in sync**: if you add a route, table, permission, provider, or env var, update the matching file in `docs/`. Documentation that only describes what actually ships is the rule for this repo.

---

## Commit & PR etiquette

- Small, focused commits with imperative messages ("Add gate-question validation to apply action").
- One logical change per PR; link the issue.
- Include the doc update in the same PR.
- Never commit `.env.local`, `docker/.env` or real keys. `.gitignore`'s `.env*` rule covers both — `docker/.env.example` is tracked by an explicit negation, and it is a template, not a place for live secrets.

---

## Scripts reference

**The stack**

| Script | Purpose |
|--------|---------|
| `apply-local-schema.mjs` (`npm run db:apply-local`) | Load `db/schema.sql` into the stack's `db` container. |
| `seed-local-staff.mjs` (`npm run db:seed-local`) | Write the local staff fixtures into the stack's `auth.users`. |
| `generate-encryption-key.mjs` | Produce a `SETTINGS_ENCRYPTION_KEY`. |
| `check-staff-routes.mjs` / `check-themes.mjs` / `audit-secrets.mjs` | Build guards — all three run in `prebuild`, so a `next build` (host or image) fails on an unguarded route, an unpainted theme, or a vendor credential in the deploy surface. |
| `audit-secrets.mjs` (`npm run audit:secrets`) | The secret scan, and the one gate with a split verdict: the deploy-surface name scan and the SDK-import scan are always fatal, while the bundle scan is informational unless you name a bundle (`node scripts/audit-secrets.mjs .probe-static`). That is deliberate — on the host `.next/static` is whatever `next dev` last wrote, so a stale bundle must not fail a build of code that never ships it. A missing `.env.local` or `.next` is a skip, not a pass; the script says so. |

**Proofs** (details and what each asserts: [docs/TESTING.md](docs/TESTING.md))

| Script | Needs the stack |
|--------|-----------------|
| `prove-file-paths.mjs`, `prove-signed-links.mjs` | no |
| `prove-local-stack.mjs` (identity/RLS parity), `prove-files-rls.mjs`, `prove-serving.mjs` | yes |
| `prove-token-shape.mjs`, `prove-password-verify.mjs`, `prove-rest-builder.mjs` | the identity-spine foundation proofs — run with `node`, see each file's header for the flags; `prove-password-verify.mjs` needs `db` up |

**Hosted cut-over and HOSTED-ONLY** — `extract-vendor-files.mjs` (needs `SUPABASE_SERVICE_ROLE_KEY`, which `.env.local` no longer holds) and `apply-migration.mjs` are marked or behave as **HOSTED-ONLY**: they reach the retired vendor project and are waiting on the owner to close that account and delete them. `apply-schema.mjs` and `dump-schema.mjs` join them; `verify-schema.mjs` is HOSTED-ONLY by default and useful locally only when aimed with `ZZ_DB_URL`. `verify-extracted-files.mjs` runs entirely against the copies already in `docker/data/vendor-files`, so it stays.

Questions? Open an issue. Thanks for contributing.
