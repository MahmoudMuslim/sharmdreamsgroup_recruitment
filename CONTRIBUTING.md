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

# 1. Both env files first — `docker:up` cannot start without either
cp docker/.env.example docker/.env    # fill in its secrets (the template is tracked,
                                      # the copy is ignored)
cp .env.example .env.local            # the `app` service reads it as `env_file`;
                                      # Compose exits 1 when it is missing
node scripts/generate-encryption-key.mjs   # prints the AES key line for .env.local
npm run docker:up                     # db + rest + gateway + app + nginx + cron
npm run db:apply-local                # load db/schema.sql into the db container
npm run db:seed-local                 # staff fixtures the local login can use

# 2. Fill the four the template omits. `.env.example` is tracked and carries
#    REST_BASE_URL and SETTINGS_ENCRYPTION_KEY; docker-compose.yml injects
#    AUTH_DB_URL, AUTH_JWT_SECRET, UPLOADS_ROOT and CRON_SECRET into the
#    container from docker/.env, but a host-side `next dev` reads all six
#    from .env.local — add the missing four there.

# 3. Prove the doors before you change anything
npm run stack:prove                   # identity + RLS parity
npm run dev                           # asks for :3000; nginx holds it, so Next
                                      # shifts to the next free port (:3001)
```

The whole set-up is Docker-first — `npm run db:apply-local` is the only way the schema reaches a database. Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the env list and the template's known drift.

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
- **Prefer the request's session bearer** (`createServerRestClient`) so RLS enforces access. `getServiceRestClient` mints a short-lived `service_role` bearer that **bypasses RLS** — use it only for a privileged write after re-checking the permission in code.
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

Enable RLS on every new table — the file carries an explicit `alter table … enable row level security` per table, and `rls_auto_enable()` arms any new one. Nothing compares a catalog against `schema.sql` any more: `stack:prove` checks the behaviour, which is the claim that matters.

**Order matters on a cluster that already exists.** `db/schema.sql` declares a new column inside its `create table if not exists`, so a cluster that predates that column never gets it from the file — and the later `comment on column` then aborts the whole apply. Measured 2026-10-22 on this repo's own stack, which predates `031_job_headcount.sql`: the run stopped with `42703 column "positions_needed" … does not exist`. Because the apply sends the file as one simple-protocol query, Postgres wraps it in a single implicit transaction, so nothing landed and the proofs still read 8/8 and 20/20 — the refusal is loud, not partial. The rule follows: on a live cluster, run the ordered migration first with `npm run docker:psql`, then `npm run db:apply-local` to prove the file still describes the result. A fresh cluster needs only the second command.

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

**Nothing here reaches the retired vendor project.** The five hosted doorways (`apply-schema.mjs`, `apply-migration.mjs`, `dump-schema.mjs`, `verify-schema.mjs`, `extract-vendor-files.mjs`) are deleted, along with the vendor credential lines in the owner's `.env.local`, so the local stack is the only data plane these commands can address. The two files left from the cut-over — `load-vendor-files.mjs` and `verify-extracted-files.mjs` — work entirely against the copies already in `docker/data/vendor-files`; that directory is gitignored and is now the only place those bytes exist that the repo can reach.

Questions? Open an issue. Thanks for contributing.
