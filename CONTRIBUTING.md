# Contributing

Thanks for working on **Sharm Dreams Talent Cloud** — an AI-driven HRMS / ATS / skill-assessment platform for Sharm Dreams Group, built on **Next.js 16 (App Router, Turbopack) + Supabase**.

This guide covers setup, layout, conventions, and the checks that must pass before a change lands. For deep dives see [`docs/`](docs/).

---

## Documentation map

| Doc | Read it when… |
|-----|---------------|
| [README](README.md) | You want the overview and how to run the app. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | You need to know where code belongs. |
| [docs/API.md](docs/API.md) | You're adding a route handler or Server Action. |
| [docs/DATABASE.md](docs/DATABASE.md) | You're changing tables, RLS, or storage. |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | You're touching roles, permissions, or secrets. |
| [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md) | You're working with the model gateway. |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | You're configuring env vars or shipping. |
| [docs/TESTING.md](docs/TESTING.md) | You want to know how a change is verified. |
| [docs/RESEARCH.md](docs/RESEARCH.md) | You want the product/feature-parity background. |

---

## Get set up

```bash
npm install
cp .env.example .env.local      # then read docs/DEPLOYMENT.md — the template has known drift
node scripts/generate-encryption-key.mjs
node scripts/apply-schema.mjs
node scripts/create-staff.mjs   # HOSTED project only (GoTrue) — for the self-hosted stack run npm run db:seed-local for fixtures and create people in Settings → Team; see docs/DEPLOYMENT.md
npm run dev                     # http://localhost:3001
```

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
├── lib/            # supabase clients, auth/session, crypto, config, theme, i18n
├── stores/         # Zustand
└── types/          # shared TS interfaces
supabase/           # schema.sql, migrations/, seed.sql
scripts/            # build guards + DB/maintenance scripts
docs/               # the documentation set above
```

---

## Conventions

- **Server components by default**; add `"use client"` only where interactivity requires it.
- **Layering**: pages/route-handlers authorize and render; business logic lives in `src/modules/<domain>`; Supabase access lives in `src/lib/supabase`.
- **Validate at the boundary** with Zod before any DB write.
- **Prefer the session (JWT) client** so RLS enforces access; use the service-role client only for a privileged write after re-checking the permission in code.
- **Fail closed**: a missing secret or permission is an error, never a permissive default.
- **`server-only`** guards any module that reads secrets — importing it from a client component must stay a build error.
- Match the surrounding code's comment density and naming; the codebase explains *why* in comments — keep that habit.

### Adding an admin page

A new page under `src/app/(admin)/<route>/page.tsx` must be registered in **both** `STAFF_ROUTES` (`src/lib/auth/staffRoutes.ts`) and the rail `NAV`, or `check-staff-routes.mjs` fails the build. Guard it with `requireStaff("/<route>")`.

### Changing the database

Edit `supabase/schema.sql` **and** add an ordered migration in `supabase/migrations/0NN_*.sql`. Keep them consistent, then run `node scripts/verify-schema.mjs`. Enable RLS on every new table.

### Theming

Themes are CSS tokens in `src/app/globals.css` (`lib/theme.ts`). All four (Base/Liquid-glass × Light/Dark) must stay painted or `check-themes.mjs` fails. Opt a surface *out* of the glass frost with a dedicated class (see `.careers-chat-shell`) rather than editing the shared frost selector.

---

## Before you open a PR

```bash
npm run check:routes
npm run check:themes
npx tsc --noEmit
npm run lint
npm run build          # runs the guards + a full type-check
node scripts/audit-secrets.mjs
```

Then walk the relevant manual checks in [docs/TESTING.md](docs/TESTING.md).

**Keep docs in sync**: if you add a route, table, permission, provider, or env var, update the matching file in `docs/`. Documentation that only describes what actually ships is the rule for this repo.

---

## Commit & PR etiquette

- Small, focused commits with imperative messages ("Add gate-question validation to apply action").
- One logical change per PR; link the issue.
- Include the doc update in the same PR.
- Never commit `.env.local` or real keys; `.env.example` is a template, not a place for live secrets.

---

## Scripts reference

| Script | Purpose |
|--------|---------|
| `apply-schema.mjs` / `apply-migration.mjs` | Apply consolidated schema / a single migration. |
| `verify-schema.mjs` | Confirm the applied DB matches `schema.sql`. |
| `dump-schema.mjs` | Export the current DB schema. |
| `create-staff.mjs` | Provision a staff user + profile. |
| `generate-encryption-key.mjs` | Produce a `SETTINGS_ENCRYPTION_KEY`. |
| `audit-secrets.mjs` | Scan the tree for committed secrets. |
| `check-staff-routes.mjs` / `check-themes.mjs` | Build guards (run by `prebuild`). |

Questions? Open an issue. Thanks for contributing.
