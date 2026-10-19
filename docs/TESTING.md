# Testing

There is **no automated unit/E2E test runner** in this project (no Jest/Vitest/Playwright in `package.json`). Quality is held by **build-time guards**, **type-checking**, **lint**, and **manual verification flows**. This document describes what exists and how to verify a change.

Related: [DEPLOYMENT.md](DEPLOYMENT.md) · [CONTRIBUTING](../CONTRIBUTING.md) · [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Automated checks

### Build-time guards (`prebuild`)

`npm run build` first runs two scripts that fail the build on drift:

| Script | Command | Asserts |
|--------|---------|---------|
| `scripts/check-staff-routes.mjs` | `npm run check:routes` | The `(admin)` route directories, `STAFF_ROUTES` (`src/lib/auth/staffRoutes.ts`), and the rail `NAV` all list the **same** pages. Add a page without registering it → build fails. |
| `scripts/check-themes.mjs` | `npm run check:themes` | All **4 themes** (Base + Liquid-glass × Light + Dark) are actually painted in `globals.css`. A theme selector with no matching CSS → build fails. |

Run them without a full build:

```bash
npm run check:routes
npm run check:themes
```

### Type-check & lint

```bash
npx tsc --noEmit      # TypeScript strict project (tsconfig.json)
npm run lint          # eslint (eslint.config.mjs, next/core-web-vitals)
npm run build         # also type-checks via Next
```

### Database verification

```bash
node scripts/verify-schema.mjs    # applied tables/policies match schema.sql
node scripts/audit-secrets.mjs    # scan for committed secrets before publishing
```

---

## Manual verification flows

Because most risk is in auth, RLS, and the AI gateway, verify these by hand against a real Supabase project.

### Auth & RBAC
- [ ] Anonymous hit to `/dashboard` → redirected to `/login` with a return path.
- [ ] Candidate session to an admin path → bounced to `/portal?denied=staff-only`.
- [ ] A `HIRING_MANAGER` cannot reach an action gated by, say, `candidates.delete` (explicit deny for `RECRUITER` too).
- [ ] `settings.manage_roles` is the only way to edit role grants.

### RLS
- [ ] A staff query returns only their tenant's rows.
- [ ] A candidate `access_token` reads/submits **only** its own attempt.
- [ ] `provider_credentials` is unreadable except via the service role (a session-client select returns zero rows).

### Public careers
- [ ] Board, single-job, apply form, gate questions, CV upload, and the careers assistant all work **unauthenticated**.
- [ ] A failing gate answer rejects the application at submit.
- [ ] Leaving a lead writes a `sourced_prospects` row with origin `CHATBOT`.

### Assessment runner
- [ ] `start` locks the paper + freezes `question_order`; `draft` autosaves; `submit` triggers grading.
- [ ] Timer expiry behaves per `assessment.lock_on_expiry`.
- [ ] Integrity events (tab switch / copy) land in `integrity_events`.
- [ ] Video take uploads to `candidate-videos`; > 14 MB is rejected as not transcribable.

### AI gateway
- [ ] With no provider key, a screening shows the "No AI provider is configured" error (not a crash).
- [ ] With Settings credentials saved, they **override** env vars.
- [ ] Kill the primary model's key → the gateway walks to the fallback and records it in `attempts`.

### Omnichannel & cron
- [ ] `/api/cron/whatsapp` and `/api/cron/grading` return **503 without** `x-cron-secret`, **200 with** it.
- [ ] A stage change enqueues a scheduled job that the cron then drains.

### Theming (the reason `check-themes` exists)
- [ ] Toggle Base ↔ Liquid-glass, Light ↔ Dark: every surface repaints with no flash.
- [ ] Fixed/floating surfaces (rail, app bar, dialogs, the careers chat) behave — see the glass frost rules in `globals.css`.

---

## Adding tests (if you want them)

Nothing stops a test runner from being introduced. The natural seams are:

- **Domain pure functions** — `modules/careers/chatbot`, `screening` JSON parsing (`parseJsonResponse`/`balancedJsonRegion`), `getCostTier`, `modelChains` ordering, `listFilters`.
- **Gateway** — unit-test `routeFor()` prefix/namespace/bare resolution and chain de-duplication with a fetch stub.
- **RLS** — Postgres-level policy tests via `pgTAP`, run against a throwaway schema.

If you add one, wire it into `package.json` scripts and mention it in [CONTRIBUTING](../CONTRIBUTING.md).
