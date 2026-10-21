# Architecture

This document describes how the application is put together: the layering, the module boundaries, the request lifecycle, and where each kind of code belongs.

---

## High level

The app is a **Next.js 16 App Router** project running in its own Docker Compose stack against **PostgreSQL 18 + PostgREST** that this repo configures and owns. There is no separate application server and no hosted backend: route handlers and React Server Actions run inside the Next.js runtime and talk to PostgREST over HTTP, to Postgres over a `pg` pool for the two things REST may not reach, and to a disk volume for file bytes.

Three layers, top to bottom:

1. **Presentation (`src/app`)** — pages, client components, route handlers (`/api/*`), and server actions (`"use server"`). Thin: authorize, call into a module, render.
2. **Domain modules (`src/modules/*`)** — business logic grouped by bounded context, split into `domain` / `application` / `infrastructure` / `presentation` where a module is large enough to need it.
3. **Shared infrastructure (`src/lib`)** — the PostgREST clients, auth/session, the file store, crypto, config, i18n, theming, live channel.

```
Browser ──► nginx ──► Next.js page / route handler / server action
                              │  requireStaff()  (auth + RBAC)
                              ▼
                        src/modules/<domain>       ← business logic
                              │  session · anon · service client
                              ▼
                        src/lib/data-api/* → src/lib/rest/*   ← one PostgREST transport
                              ▼
                     REST_BASE_URL = http://rest:3000   (no prefix: the prefix
                              ▼       belongs to the proxies, see below)
                          PostgREST ──► Postgres (RLS, our own `auth` schema)

   side doors, deliberately not REST:
     src/lib/auth/db.ts  ── pg pool ──► auth.users, bcrypt, staff CRUD  (`auth` is not exposed over HTTP)
     src/lib/files/*     ── disk ─────► /data/uploads volume, metadata in public.files
```

Two processes own the `/rest/v1` prefix, and neither of them is PostgREST: **nginx**
`location /rest/v1/` proxies to `rest:3000` for anything arriving from a browser, and
**Caddy** on `127.0.0.1:54321` exists only so a process running *outside* the stack (the
owner's `npm run dev` on the host) has a gateway to point `REST_BASE_URL` at. `rest`
publishes no port at all — nothing may bypass a gateway.

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
│   ├── auth/                 # token · cookies · session · guard · passwords · db
│   │                         # · admin-users · staffRoutes · login-target
│   ├── crypto/               # secrets.ts (AES-256-GCM)
│   ├── files/                # paths · disk-store · signed-link · store
│   ├── rest/                 # client · query-builder · auth-shim  (the transport)
│   ├── data-api/             # anon · server · service  (the three clients; was
│   │                         # lib/supabase/ until the legacy-name cleanup)
│   └── *.ts                  # config · config.server · currency · i18n · live ·
│                             # locale-pref · paging · public-url · rail · textSearch ·
│                             # theme · timezone · utils · alert-ack
├── stores/                   # Zustand (useAssessmentStore)
├── types/                    # Shared TypeScript interfaces (index.ts)
└── proxy.ts                  # the pre-request gate (Next.js 16's middleware file)
```

The Compose stack itself is `docker/`: `docker-compose.yml`, `docker/db/initdb/*.sql`
(roles, extensions, the `auth` stand-in), `docker/app/Dockerfile`,
`docker/nginx/nginx.conf`, `docker/Caddyfile`, `docker/cron/`.

---

## The modules (16 domains)

Each folder under `src/modules/` is a bounded context. Larger ones are further divided into `domain` (pure logic), `application` (orchestration / server actions), `infrastructure` (data-access + provider I/O), and `presentation` (client components).

| Module | Responsibility |
|--------|----------------|
| `activity` | Audit-trail recording and the trail/document query used by `/activity` |
| `analytics` | Dashboard metrics, fit buckets, report building/export, **and the shared admin shell, `nav.ts` and UI kit** |
| `assessment` | Attempt lifecycle: build paper, link validity, settings, grading, integrity, answer handling; the candidate-facing runner components |
| `assistant` | In-app agentic assistant: engine, tools, approvals, result budget, Qoder agent runtime, transcript store, chat UI |
| `candidates` | Candidate list filtering (`listFilters.ts`) shared by the browser UI |
| `careers` | Public careers: CV rules, attachment rules, gate questions, job board, company profile, and the **chatbot** (`answer`, `conversation`, `role-card`) |
| `jobs` | Hireable-opening resolution and opening search |
| `i18n` | Translation overrides: reads the per-locale `app_settings` rows, seeds them, and can produce a translation through the AI gateway |
| `live` | Change watch (`changeWatch.ts`) + `Live` components/hook backed by `/api/live` — our own fingerprinted SSE stream, not a vendor realtime |
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
2. Data reads run through a PostgREST client built for that request and carrying the caller's bearer, so **RLS applies** to every query. PostgREST maps the bearer's `role` claim onto the Postgres role (`anon` / `authenticated` / `service_role`) and sets `request.jwt.claims`, which `auth.uid()` then reads.
3. Pure filtering/shaping is delegated to the relevant module's `domain` layer.

### Write path (server action)
1. Client component invokes an action exported from a `*/actions.ts` (`"use server"`).
2. The action re-checks the session + permission, validates with Zod, then writes via the service or session client.
3. Side effects are recorded to `activity_log` / `settings_audit_log` / `credential_audit_log`. Nothing notifies the portal: the `live` channel is a poll, so an open page notices the write on its next fingerprint (see State & realtime below).

### Public path (careers)
- `GET /careers`, `POST /api/careers/upload|prefill|chat|lead`, `GET /api/careers/questions` run with the anon client under public RLS (insert applications/attachments/leads, read published jobs). No session required.

### Candidate attempt path
- `GET /api/attempt/[token]` validates the unguessable `access_token`; `POST start/submit/video`, `PUT draft`, `POST integrity` drive the timed session. Grading runs on submit or via the `cron/grading` batch job. RLS restricts a candidate to their own attempt via the token claim.

---

## Data access (`src/lib/data-api` over `src/lib/rest`)

The folder is `src/lib/data-api/`; it carried the vendor's name until the legacy-name cleanup renamed it. The three constructors kept theirs: **198 call sites across 67 files** name `createSupabaseServerClient()`, `getSupabaseServiceClient()` and `getSupabaseAnonClient()`, and none of them needs to know the transport is now our own PostgREST. Measured by counting each constructor's calls, not its definition: `createSupabaseServerClient()` 129, `getSupabaseServiceClient()` 62, `getSupabaseAnonClient()` 7. Underneath, `src/lib/rest/` is the transport.

| File | Role |
|------|------|
| `data-api/server.ts` | **The one seam.** Per-request client built from the `sdg_session` bearer after it is verified; anything that is not a verified `authenticated` bearer is forwarded as `null`, so the request runs as `anon` and RLS answers it. Returns the `{ from, rpc, auth }` shape the old client had. |
| `data-api/anon.ts` | Module-scoped client with no identity, for public, cacheable reads (`jobs_public_read` → PUBLISHED rows only). Kept separate because a cookie-bound client cannot be prerendered. |
| `data-api/service.ts` | Service-role client. Mints a short-lived bearer locally with `AUTH_JWT_SECRET` (60 s, per call, so no bearer outlives its expiry); the `service_role` DB user carries `bypassrls`, so this **bypasses** RLS. |
| `rest/client.ts` | The PostgREST HTTP client — `from()`, `rpc()`, and the `auth.admin` handle. |
| `rest/query-builder.ts` | The chainable filter/order/select builder that compiles to PostgREST query params. |
| `rest/auth-shim.ts` | `auth.admin` as four parameterised statements over the `pg` pool (`src/lib/auth/db.ts`), because `auth` is deliberately outside `PGRST_DB_SCHEMAS` and no HTTP route may reach `auth.users`. |

Client selection is deliberate: **prefer the request client so RLS is the enforcement layer**; reach for `service.ts` only when a privileged write is required and re-check permissions in code first. There is no browser client — no client component holds a data client, so nothing here can be reached from the page.

---

## State & realtime

- **Zustand** (`src/stores/useAssessmentStore.ts`) holds the candidate runner's transient state (answers, timer, submission status).
- **Realtime is a poll we own.** `/api/live` is a Server-Sent Events stream: one open `EventSource` per tab, and per connection a probe every 5 s (`POLL_MS`) fingerprints the 11 hiring tables in `LIVE_WATCH` — newest `updated_at` stamp plus row count, or a hash of watched columns where a table keeps no stamp. When a fingerprint moves, the stream names the *areas* that changed and the browser re-reads the page it is standing on, through that page's own RLS-scoped queries. No row content crosses the channel, so it leaks nothing a recruiter could not already query; two consecutive failed probes (`STALLED_AFTER`) make the badge admit the channel went quiet rather than claim it is live. `modules/live/infrastructure/changeWatch.ts` owns the watch list and the diff, `lib/live.ts` the client store, `modules/live/presentation/Live.tsx` the hook and badge.

---

## Configuration & theming

- `lib/config.ts` is **client-safe** and imports cleanly into browser code. It reads `APP_URL` and the four `AI_MODEL_*` chain names, and holds the four bucket names — no `NEXT_PUBLIC_*` value any more, because nothing is inlined at build time; the browser only ever needs the origin it was served from. `lib/config.server.ts` is guarded by `server-only` and holds the AI provider keys, WhatsApp/SMTP defaults, and cron config.
- The self-hosting secrets are deliberately *not* in a config module — each is read where it is used, so a missing one fails at the door that needs it: `AUTH_JWT_SECRET` in `auth/token.ts` (and `files/signed-link.ts`), `SETTINGS_ENCRYPTION_KEY` in `crypto/secrets.ts`, `UPLOADS_ROOT` in `files/paths.ts`, `AUTH_DB_URL` in `auth/db.ts`. `REST_BASE_URL` is the one value four modules read straight from the environment and each throws on without it: `data-api/anon.ts:51`, `data-api/server.ts:32`, `data-api/service.ts:21` and `auth/guard.ts:39`.
- Theming is CSS-token driven (`app/globals.css` + `lib/theme.ts`): Base and Liquid-glass parents × Light/Dark, persisted in `localStorage` only (there is no per-user theme column) and applied pre-paint.

---

## Conventions

- Server components by default; `"use client"` only where interactivity requires it.
- Validation with **Zod** at action/handler boundaries.
- Every permission checked server-side; the UI only *reflects* what RLS/actions already enforce.
- New admin pages must be added to `STAFF_ROUTES` and `NAV` or the build fails.
