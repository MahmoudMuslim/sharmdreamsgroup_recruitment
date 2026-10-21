# Sharm Dreams Group — AI-Driven HRMS, ATS & Skill Assessment Platform

[![Next.js](https://img.shields.io/badge/Next.js-16.4-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.3-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL_18+PostgREST-self--hosted-336791?logo=postgresql)](docker/docker-compose.yml)
[![Docker](https://img.shields.io/badge/Docker-Compose_Stack-2496ED?logo=docker)](docker/docker-compose.yml)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-Private-lightgrey)](#)

An enterprise-grade, **AI-Driven Omnichannel HRMS, ATS & Skill Assessment Platform** for multi-company groups (Hospitality, Real Estate, Commercial Development, Corporate Shared Services). A standalone hybrid of Canditech + Greenhouse + Lever + AI Recruiter.

> Production URL: **https://hrms.sharmdreams.com**

---

## 📚 Documentation

This README is the entry point. Detailed, verified documentation lives in [`docs/`](docs/):

| Doc | What it covers |
|-----|----------------|
| [Architecture](docs/ARCHITECTURE.md) | Clean-architecture module layout, request lifecycle, data flow |
| [API Reference](docs/API.md) | Every route handler (`/api/*`) and server action |
| [Database](docs/DATABASE.md) | All 42 tables, relationships, the 88 RLS policies, and the `public.files` table + uploads volume that replaced storage buckets |
| [Authentication & RBAC](docs/AUTHENTICATION.md) | Session tokens, roles, granular permissions, credential store |
| [AI Integration](docs/AI_INTEGRATION.md) | Multi-provider gateway, model failover, capabilities, routing |
| [Deployment](docs/DEPLOYMENT.md) | Docker Compose stack, environment variables, cron jobs |
| [Testing](docs/TESTING.md) | Verification strategy and manual test flows |
| [Contributing](CONTRIBUTING.md) | Developer guide, scripts, conventions |
| [Changelog](CHANGELOG.md) | Release history |

---

## ✨ Core Features

- **Recruiter portal** (16 protected pages) — dashboard, analytics, reports, candidates, jobs, assessments, interviews, onboarding, sourcing, WhatsApp outbox, files, time tracking, activity audit, AI assistant, settings. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#-the-admin-portal--16-routed-pages).
- **Public careers site** — job board, application intake with CV parsing, gate questions, and a grounded **careers chatbot** that captures leads.
- **Candidate portal** — application tracker and a tokenized, timed **assessment runner** (Excel model, video pitch, case study, multiple choice) with an anti-cheating integrity monitor.
- **AI screening & grading** — multi-provider gateway (OpenRouter, Google AI Studio, OpenCode, Qoder, Cloudflare Workers AI, NVIDIA NIM) with model + key failover and per-capability routing.
- **RBAC** — the app's own session tokens, 4 roles and granular, DB-driven permissions enforced by Row Level Security.

### Authentication & RBAC
- Email/password sign-in against `auth.users` in our own Postgres, with pgcrypto bcrypt hashes
- HS256 bearer minted per request (`src/lib/auth/token.ts`) — same claim shape PostgREST expects, verified by the app and no external service
- Roles: `SUPER_ADMIN`, `RECRUITER`, `HIRING_MANAGER`, `CANDIDATE`
- Permissions such as `candidates.read`, `candidates.write`, `assessments.create`, `assessments.grade`, `jobs.manage`, `messages.send`, `scores.view_unmasked`, `settings.manage_users` (full list in [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md))
- Proxy middleware (`src/proxy.ts`, idle-session timeout) + page-level `requireStaff()` on all admin routes
- Details: [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)

### Analytics & Insights
- Assessment completion (open/finish rates, median invite-to-open and time-on-test), score bands, sourcing reply and conversion rates, per-channel message delivery, interview outcomes — all computed by one pure module (`modules/analytics/domain/report.ts`) that the page and the CSV export share. It names what it cannot compute: there is **no per-stage duration, no stage conversion over time and no cohort funnel**, because a stage move overwrites `applications.stage` and only `HIRED` carries a timestamp.
- Server-sent change watch (`/api/live`): the shell polls the fingerprints of 11 watched tables every 5 s, so an open page notices a write on its next poll — nothing is pushed from the write path.
- CSV/Excel/PDF export (`/api/reports/export`, `/api/time/export`, `/api/activity/export`)

### Job & Candidate Management
- Multi-company job openings: Draft/Published/Paused/Closed, multi-currency salary
- Candidate pipeline stages: `NEW → AI_SCREENING → ASSESSMENT → INTERVIEW → OFFER → HIRED/REJECTED`, with archive/restore and a profile drawer (AI meter, screening summary, strengths & gaps, activity trail)

### Assessment Engine
- Templates per role family; question types: **Excel Model** (Handsontable + HyperFormula), **Video Pitch** (MediaRecorder → our own uploads volume), **Case Study** (word-count validated), **Multiple Choice**
- Time limits (5–300 min), scheduled auto-grading (`/api/cron/grading`)
- Integrity monitor (tab-switch / copy-paste → `integrity_events`)
- AI question authoring; the **Question Bank** (`/questions`, `modules/questions/`) is one CRUD surface over both stores — apply-form gate questions and suite questions — with tabs, rails, groups and a Kanban board

### Omnichannel & Sourcing
- WhatsApp + email + in-app templates (`communication_logs`, `notification_templates`), scheduled WhatsApp dispatch (`/api/cron/whatsapp`)
- LinkedIn prospect sourcing with AI profile extraction into `sourced_prospects`

---

## 🏗 Architecture at a Glance

Clean-architecture domains under `src/modules/`, thin route/action layer under `src/app/`, shared infrastructure under `src/lib/`:

```
src/
├── app/            # Route handlers, server actions, pages (App Router)
│   ├── (admin)/    # 16 protected pages  ├── (candidate)/  # portal + test/[token]
│   ├── careers/    # public board + apply├── api/          # 22 route handlers
│   └── login/
├── modules/        # 16 domains: activity, analytics, assessment, assistant,
│                   # candidates, careers, i18n, jobs, live, omnichannel,
│                   # questions, screening, settings, shell, sourcing, timelog
├── lib/            # PostgREST + auth-pool clients, session, files, crypto, config, i18n, theme
├── stores/         # Zustand (assessment runner state)
└── types/          # Shared TypeScript interfaces
```

Full walkthrough (data flow, read/write path, module boundaries): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

**Tech stack:** Next.js 16.4 (App Router, Turbopack) · React 19.3 · TypeScript 5 · Tailwind CSS 4 · PostgreSQL 18 + PostgREST (own data plane — `@supabase/supabase-js` and `@vercel/speed-insights` are uninstalled, nothing in `src` or `scripts` imports either, and file bytes come off our own `uploads` volume) · Zustand 5 · Zod 4 · Handsontable + HyperFormula · exceljs / pdf-lib · mammoth / unpdf · `@qoder-ai/qoder-agent-sdk`.

---

## 🎨 UI Kit & Design System

A hand-rolled, dependency-light library (no component framework) in `modules/analytics/presentation` + `modules/shell/presentation`, themed via CSS custom properties in `app/globals.css`.

**Primitives** (`ui.tsx`): `PageHeader`, `Card`/`CardHeader`, `Button` (`primary`/`outline`/`ghost`), `Badge` (5 tones), `Meter`, `StatTile`, `FilterRail`, `EmptyState`.
**Overlays & forms**: `Drawer` (Escape-close, focus capture, scroll lock), `Field`/`TextInput`/`TextArea`/`Select`, `FormMessage`, `DrawerActions`.
**Shell**: `AppBar` (grouped nav rail, `/` command search, per-route Guide, alerts, theme + language toggle), `AdminShell`, typed `NAV` table, `SdgMark`/`SdgLockup` brand.
**Feedback**: `LiveChrome`/`LiveBadge`/`useLive`, assistant `ReplyChart`/`RichReply`, assessment runners.

**Theming** (`lib/theme.ts`): two palette parents × two tones — Base (opaque) and Liquid glass (translucent film over a moving backdrop), each in Light/Dark. Persisted in `localStorage`, applied pre-paint to avoid flash. `scripts/check-themes.mjs` fails the build if a theme maps to no CSS.

---

## 🚀 Quick Start

### Prerequisites
- Docker Engine with the Compose v2 plugin — Postgres, PostgREST, the gateway, nginx and the cron poller all come up from `docker/docker-compose.yml`
- Node.js 24 (the app image is `node:24.22.0-alpine3.24`)
- At least one AI provider key, or the app runs with AI features degraded

```bash
git clone <repository-url>
cd sharm_dreams_group
npm install
cp docker/.env.example docker/.env   # then fill in its secrets — required before
                                     # docker:up and db:apply-local both read it
npm run docker:up                # db + rest + gateway + app + nginx + cron
npm run db:apply-local           # loads supabase/schema.sql into the stack's own cluster
npm run db:seed-local            # the three staff fixtures the local login reads
npm run stack:prove              # proves the three data doors end to end
cp .env.example .env.local       # host-side `npm run dev` only — see the note below
node scripts/generate-encryption-key.mjs   # AES-256-GCM key for credential storage
```

> `.gitignore`'s `.env*` rule means the **root** template is not tracked, so a fresh
> clone has no `.env.example` to copy; `docker/.env.example` is tracked and is the one
> the stack needs. Create the root `.env.local` by hand (or copy an existing
> developer's) and set the six required variables below. Full list and the known
> template drift: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Required env: `REST_BASE_URL`, `AUTH_DB_URL`, `AUTH_JWT_SECRET`, `UPLOADS_ROOT`, `SETTINGS_ENCRYPTION_KEY`, and `CRON_SECRET` (the cron routes fail closed without it). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the complete, code-verified list — including which provider keys are optional fallbacks and the known `.env.example` drift.

```bash
npm run dev          # dev server (Turbopack) → http://localhost:3001
npx --no-install next typegen && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json   # type check
npm run build        # production build (prebuild: routes, themes, secret audit)
```

### Database
`supabase/schema.sql` is the consolidated DDL — every table (42), the `auth.users` shim, the RLS policies (88) and the console's seed and reference rows (235 idempotent inserts — 9 companies, then 226 lookup rows in the `REFERENCE ROWS` section, which the file's own comment counts) — applied to the stack's own cluster with `npm run db:apply-local`. `npm run db:seed-local` adds the staff logins the identity spine needs, and `supabase/migrations/` (001–030, 026 never written) is the history the dump was made from, not a path anything applies. Table reference: [docs/DATABASE.md](docs/DATABASE.md).

---

## 🔧 Key Scripts

```bash
npm run dev                 # dev server (Turbopack)
npm run build               # build (prebuild: check-staff-routes + check-themes + audit-secrets)
npm run lint                # ESLint
npm run check:routes        # validate staff route / permission coverage
npm run check:themes        # validate theme token coverage
npm run audit:secrets       # validate the deploy surface holds no vendor credential

# The stack
npm run docker:up / docker:down / docker:logs / docker:psql / docker:wipe
npm run db:apply-local      # apply supabase/schema.sql to the stack's own cluster
npm run db:seed-local       # local staff fixtures, written into the stack's auth.users

# Proofs (see docs/TESTING.md for what each asserts)
npm run stack:prove         # identity + RLS parity against the running stack
npm run files:prove         # the eight public.files policies over the HTTP door
npm run files:paths         # path containment (61 checks, plain Node)
npm run files:links         # signed-link forgery (76 checks, plain Node)
npm run files:serve         # bytes over HTTP against the running container

node scripts/generate-encryption-key.mjs   # AES key (run once)
npm run audit:secrets                       # build guard: fails on a vendor credential in the deploy surface

# HOSTED-ONLY — doorways to the retired vendor project, deleted once it is closed
node scripts/apply-schema.mjs              # apply the consolidated schema to the hosted DB
node scripts/apply-migration.mjs <file>    # apply one migration to the hosted DB
node scripts/dump-schema.mjs               # dump the hosted schema into schema.sql
node scripts/verify-schema.mjs <file>      # compare the hosted catalog against schema.sql
```

The first two read `SB_DB` (or `.env.local`'s `SUPABASE_DB_PASSWORD`); `verify-schema.mjs` can be aimed at any other database with `ZZ_DB_URL`. Local SQL changes go through `npm run docker:psql`, and the `supabase/migrations/` files are history, not the apply path.

---

## 🛡 Security (summary)

- AES-256-GCM encryption for stored API keys (`SETTINGS_ENCRYPTION_KEY`)
- Row Level Security on all 42 `public` tables — one explicit `alter table … enable row level security` each (a 43rd enable sits inside the `rls_auto_enable()` event trigger, which arms RLS on any new `public` table) — with the helper functions the ported policies call
- 256-bit unguessable `access_token` per candidate attempt (`randomBytes(32)`, base64url)
- Secrets decrypted only at request time, never sent to the browser; `scripts/audit-secrets.mjs` runs in `prebuild` and fails the build if a vendor credential re-enters the deploy surface
- Candidate bytes live on the stack's own `uploads` volume, resolved through `src/lib/files/paths.ts` (no path may escape `$UPLOADS_ROOT`) and served only by HMAC-signed, expiring links
- Full audit trail (`activity_log`, `credential_audit_log`, `settings_audit_log`)
- Details: [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) · [docs/DATABASE.md](docs/DATABASE.md#rls-policies)

---

## 📄 License

Private proprietary software. All rights reserved — Sharm Dreams Group.

---

**Built for Sharm Dreams Group** — Hospitality, Real Estate, Commercial Development & Corporate Shared Services
