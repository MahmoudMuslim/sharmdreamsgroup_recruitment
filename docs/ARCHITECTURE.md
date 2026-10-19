# Architecture

This document describes how the application is put together: the layering, the module boundaries, the request lifecycle, and where each kind of code belongs.

---

## High level

The app is a **Next.js 16 App Router** project backed entirely by **Supabase** (PostgreSQL 17 + Auth + Storage). There is no separate application server: route handlers and React Server Actions run inside the Next.js runtime and talk to Supabase directly through server-side clients.

Three layers, top to bottom:

1. **Presentation (`src/app`)** — pages, client components, route handlers (`/api/*`), and server actions (`"use server"`). Thin: authorize, call into a module, render.
2. **Domain modules (`src/modules/*`)** — business logic grouped by bounded context, split into `domain` / `application` / `infrastructure` / `presentation` where a module is large enough to need it.
3. **Shared infrastructure (`src/lib`)** — Supabase clients, auth/session, crypto, config, i18n, theming, realtime.

```
Browser ──► Next.js page / route handler / server action
                     │  requireStaff()  (auth + RBAC)
                     ▼
              src/modules/<domain>       ← business logic
                     │  service-role or session client
                     ▼
              src/lib/supabase/*         ← Supabase access
                     ▼
              Supabase (Postgres + RLS, Auth, Storage)
```

---

## Source layout

```
src/
├── app/                      # Next.js App Router
│   ├── layout.tsx            # Root layout, theme bootstrap, fonts
│   ├── page.tsx              # Public landing
│   ├── login/                # Staff sign-in
│   ├── careers/              # Public job board + chatbot
│   │   ├── [id]/             # Single job, and the door to its application
│   │   ├── apply/[id]/       # The application itself, one step per screen
│   │   ├── CareersBoard.tsx · actions.ts
│   ├── (admin)/              # 16 protected pages (see below)
│   ├── (candidate)/          # Portal + tokenized test runner
│   │   ├── portal/           # Candidate application tracker
│   │   └── test/[token]/     # Timed assessment runner
│   └── api/                  # Route handlers (see docs/API.md)
├── modules/                  # Clean-architecture domains
├── lib/                      # Shared infrastructure
│   ├── auth/                 # session.ts · staffRoutes.ts · login-target.ts
│   ├── crypto/               # secrets.ts (AES-256-GCM)
│   ├── supabase/             # anon · client · server · service · rest · middleware
│   └── *.ts                  # config · config.server · currency · i18n · live ·
│                             # locale-pref · public-url · rail · textSearch · theme ·
│                             # timezone · utils · alert-ack
├── stores/                   # Zustand (useAssessmentStore)
├── types/                    # Shared TypeScript interfaces (index.ts)
└── proxy.ts                  # (test/dev proxy shim)
```

---

## The modules (15 domains)

Each folder under `src/modules/` is a bounded context. Larger ones are further divided into `domain` (pure logic), `application` (orchestration / server actions), `infrastructure` (Supabase + provider I/O), and `presentation` (client components).

| Module | Responsibility |
|--------|----------------|
| `activity` | Audit-trail recording and the trail/document query used by `/activity` |
| `analytics` | Dashboard metrics, fit buckets, report building/export, **and the shared admin shell, `nav.ts` and UI kit** |
| `assessment` | Attempt lifecycle: build paper, link validity, settings, grading, integrity, answer handling; the candidate-facing runner components |
| `assistant` | In-app agentic assistant: engine, tools, approvals, result budget, Qoder agent runtime, transcript store, chat UI |
| `candidates` | Candidate list filtering (`listFilters.ts`) shared by the browser UI |
| `careers` | Public careers: CV rules, attachment rules, gate questions, job board, company profile, and the **chatbot** (`answer`, `conversation`, `role-card`) |
| `jobs` | Hireable-opening resolution and opening search |
| `live` | Realtime change watch (`changeWatch.ts`) + `Live` components/hook backed by `/api/live` |
| `omnichannel` | WhatsApp + SMTP connectors, WhatsApp dispatch, candidate notifications, templates |
| `questions` | **Question Bank** domain — projects a gate or suite question into one shape and owns the rails, search, groups, place lookups, ordering and copy targets the `/questions` console draws (`bank.ts`). Stores nothing of its own |
| `screening` | AI gateway, CV parsing, OpenRouter engine, Qoder completion, application screening |
| `settings` | RBAC/permissions, provider registry, master data, credential resolver, model search, server actions |
| `shell` | `AppBar`, page guide, quick keys, shell actions |
| `sourcing` | Prospect import, profile extraction/reader, prospect profile |
| `timelog` | Time-entry ledger and document |

> **Note:** auth is *not* a module — it lives in `src/lib/auth` (session, staff-route guard) and `src/modules/settings` (role/permission model). See [AUTHENTICATION.md](AUTHENTICATION.md).

---

## The admin portal — 16 routed pages

Every entry below is a real `page.tsx` under `src/app/(admin)/` and is listed in `STAFF_ROUTES` (`src/lib/auth/staffRoutes.ts`). A `scripts/check-staff-routes.mjs` build step compares the three sources of truth — route directories, `STAFF_ROUTES`, and the rail's `NAV` — and fails the build if they drift.

| Route | Purpose |
|-------|---------|
| `/dashboard` | KPIs + pipeline funnel |
| `/analytics` | Assessment / sourcing / messaging / interview trends |
| `/reports` | Row-level lists, CSV/Excel/PDF export |
| `/time` | Time tracking |
| `/activity` | Audit trail |
| `/candidates` (+ `/candidates/[id]`) | Pipeline + candidate dossier |
| `/sourcing` | LinkedIn-sourced prospect pool |
| `/jobs` | Job openings |
| `/questions` | Question Bank — apply-form and test-suite questions in one CRUD console, as a tabbed list or a Kanban board |
| `/assessments` | Assessment suite builder |
| `/interviews` | Scheduled panels |
| `/onboarding` | New-hire checklists |
| `/files` | Stored CVs & recordings |
| `/whatsapp` | Outbox / candidate alerts |
| `/assistant` | Agentic recruitment assistant |
| `/settings` | Credentials, model routing, team, master data |

---

## Request lifecycle

### Read path (server component)
1. Page calls `requireStaff(route)` → resolves the session (`getSessionUser`, cached per request) and enforces staff role.
2. Data reads run through a Supabase client created with the user's JWT, so **RLS applies** to every query.
3. Pure filtering/shaping is delegated to the relevant module's `domain` layer.

### Write path (server action)
1. Client component invokes an action exported from a `*/actions.ts` (`"use server"`).
2. The action re-checks the session + permission, validates with Zod, then writes via the service or session client.
3. Side effects are recorded to `activity_log` / `settings_audit_log` / `credential_audit_log`, and a live change is published so the `live` hook refreshes affected views.

### Public path (careers)
- `GET /careers`, `POST /api/careers/upload|prefill|chat|lead`, `GET /api/careers/questions` run with the anon client under public RLS (insert applications/attachments/leads, read published jobs). No session required.

### Candidate attempt path
- `GET /api/attempt/[token]` validates the unguessable `access_token`; `POST start/submit/video`, `PUT draft`, `POST integrity` drive the timed session. Grading runs on submit or via the `cron/grading` batch job. RLS restricts a candidate to their own attempt via the token claim.

---

## Supabase access layer (`src/lib/supabase`)

| File | Role |
|------|------|
| `anon.ts` | Public/anon client for unauthenticated surfaces |
| `client.ts` | Browser client (client components) |
| `server.ts` | SSR client created per request with the user's cookies/JWT (RLS-scoped reads/writes) |
| `service.ts` | Service-role client — bypasses RLS; used only for privileged server operations |
| `rest.ts` | Direct PostgREST/HTTP helpers |
| `middleware.ts` | Session refresh + the edge staff gate (idle timeout, candidate bounce) |

Client selection is deliberate: **prefer the session (JWT) client so RLS is the enforcement layer**; reach for `service.ts` only when a privileged write is required and re-check permissions in code first.

---

## State & realtime

- **Zustand** (`src/stores/useAssessmentStore.ts`) holds the candidate runner's transient state (answers, timer, submission status).
- **Realtime** is a lightweight server-published channel: `modules/live` + `lib/live.ts` + `/api/live`, surfaced through `useLive`/`LiveBadge`.

---

## Configuration & theming

- `lib/config.ts` is **client-safe** (only `NEXT_PUBLIC_*` + model chains); `lib/config.server.ts` is guarded by `server-only` and holds provider keys, the service-role secret, WhatsApp/SMTP defaults, and cron config.
- Theming is CSS-token driven (`app/globals.css` + `lib/theme.ts`): Base and Liquid-glass parents × Light/Dark, persisted in `localStorage` and applied pre-paint.

---

## Conventions

- Server components by default; `"use client"` only where interactivity requires it.
- Validation with **Zod** at action/handler boundaries.
- Every permission checked server-side; the UI only *reflects* what RLS/actions already enforce.
- New admin pages must be added to `STAFF_ROUTES` and `NAV` or the build fails.
