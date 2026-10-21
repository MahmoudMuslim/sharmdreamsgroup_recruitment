# Testing

There is **no automated unit/E2E test runner** in this project (no Jest/Vitest/Playwright in `package.json`). Quality is held by **build-time guards**, **type-checking**, **lint**, and **manual verification flows**. This document describes what exists and how to verify a change.

Related: [DEPLOYMENT.md](DEPLOYMENT.md) · [CONTRIBUTING](../CONTRIBUTING.md) · [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Automated checks

### Build-time guards (`prebuild`)

`npm run build` first runs three scripts that fail the build on drift:

| Script | Command | Asserts |
|--------|---------|---------|
| `scripts/check-staff-routes.mjs` | `npm run check:routes` | The `(admin)` route directories, `STAFF_ROUTES` (`src/lib/auth/staffRoutes.ts`), and the rail `NAV` all list the **same** pages. Add a page without registering it → build fails. |
| `scripts/check-themes.mjs` | `npm run check:themes` | All **4 themes** (Base + Liquid-glass × Light + Dark) are actually painted in `globals.css`. A theme selector with no matching CSS → build fails. |
| `scripts/audit-secrets.mjs` | `npm run audit:secrets` | No module under `src` or `scripts` imports the vendor SDK, and no file the build or the stack reads sets or reads a vendor credential. Re-add `SUPABASE_SERVICE_ROLE_KEY` to `docker-compose.yml` → build fails. |

Run them without a full build:

```bash
npm run check:routes
npm run check:themes
npm run audit:secrets
```

### Type-check & lint

```bash
npx --no-install next typegen   # regenerate the route types Next 16 checks against
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json   # strict project
npm run lint                    # eslint (eslint.config.mjs, next/core-web-vitals)
npm run build                   # runs `prebuild` (the three guards) and type-checks
```

The expected clean result is **0 TypeScript errors, 0 lint errors**. There is one long-standing lint *warning* (`PortalTracker.tsx` — a `react-hooks` exhaustive-deps case in the candidate portal) that is deliberately left alone; do not "fix" it as a drive-by.

### Database & self-hosting proofs

The platform migration left behind a set of executable proofs. These are the gates a slice must pass before it is called done, and every one of them reads `docker/.env` — none of them can reach the hosted project.

| Script | Command | Needs | Asserts |
|--------|---------|-------|---------|
| `prove-file-paths.mjs` | `npm run files:paths` | nothing (plain Node) | `src/lib/files/paths.ts` refuses to turn `..`, an absolute path, a backslash or a control character into a filesystem path. |
| `prove-signed-links.mjs` | `npm run files:links` | nothing (plain Node) | an `/api/files/f/[token]` link cannot be forged, re-pointed at another object, or stretched past its expiry. Nearly every check is a forgery. |
| `prove-local-stack.mjs` | `npm run stack:prove` | running stack | our own PostgREST answers the way the vendor did for the same `uid` — tokenless reads, `auth.uid()` reach, `is_staff()`, and every `rpc/` signature the app calls. Computes the expected answer in SQL on the same connection, so a disagreement is behavioural, not transport. |
| `prove-files-rls.mjs` | `npm run files:prove` | running stack | the eight `public.files` policies bind the HTTP door: a candidate reaches only their own attempt's video, staff can delete the media buckets, a bucket the policies do not name is undeletable, and `anon` holds insert+select only. Inserts its own probe rows and deletes them before exiting. |
| `prove-serving.mjs` | `npm run files:serve` | running stack + a loaded volume | mints real links and asks the running app for the bytes: the volume is mounted where `paths.ts` looks, every object resolves through its own link, and a `Range` request returns exactly the slice asked for. |

The two pure-Node proofs are the cheap ones and run in seconds; the three stack proofs need `npm run docker:up` and `npm run db:apply-local` first.

```bash
npm run audit:secrets                # vendor names/values absent from the shipped surface
node scripts/verify-schema.mjs       # HOSTED-ONLY — the vendor project's catalog vs schema.sql
```

`audit-secrets.mjs` scans the deploy surface (`src`, `docker/`, the manifests) for the three shapes that count as a *read* of a vendor name, and the `.next` bundle for the vendor secret values; it prints no credential. Its verdict is split on purpose: the deploy-surface and SDK-import scans set the exit code — `0` when clean, `1` on any hit — so `prebuild` can fail a build, while the bundle scan is informational unless you name a bundle as `$1`, because the host's `.next/static` is a dev artifact and the bundle that ships lives in the image. A missing `.env.local` or `.next` prints a skip line rather than a pass. `verify-schema.mjs` is the last hosted doorway of its kind and is banner-marked for deletion — aim it at another database with `ZZ_DB_URL`, or use `npm run stack:prove`, which checks behaviour rather than catalog membership.

---

## Manual verification flows

Because most risk is in auth, RLS, the file store and the AI gateway, verify these by hand against the local self-hosted stack: `npm run docker:up`, `npm run db:apply-local`, `npm run db:seed-local`, then sign in at `http://localhost:3000` with a seeded staff account (`docker/.env` holds the password; nothing here prints it).

### Auth & RBAC
- [ ] Anonymous hit to `/dashboard` → redirected to `/login` with a return path.
- [ ] Candidate session to an admin path → bounced to `/portal?denied=staff-only`.
- [ ] A `HIRING_MANAGER` cannot reach an action gated by, say, `candidates.delete` (explicit deny for `RECRUITER` too).
- [ ] `settings.manage_roles` is the only way to edit role grants.

### RLS
- [ ] A staff query returns only their tenant's rows.
- [ ] A candidate `access_token` reads/submits **only** its own attempt — and note which half enforces it: the route validates the token and writes through the service client, so break the policy deliberately and re-run `npm run files:prove` to see the backstop fire.
- [ ] `provider_credentials` is unreadable except by the bypass-RLS login. The table has RLS enabled and **zero policies** (`supabase/schema.sql`), so a read through the session or anon door returns zero rows; only the service client's locally minted bearer sees them.

### Public careers
- [ ] Board, single-job, apply form, gate questions, CV upload, and the careers assistant all work **unauthenticated**.
- [ ] A failing gate answer rejects the application at submit.
- [ ] Leaving a lead writes a `sourced_prospects` row with origin `CHATBOT`.

### Assessment runner
- [ ] `start` locks the paper + freezes `question_order`; `draft` autosaves; `submit` triggers grading.
- [ ] Timer expiry behaves per `assessment.lock_on_expiry`.
- [ ] Integrity events (tab switch / copy) land in `integrity_events`.
- [ ] Video take uploads to the `candidate-videos` bucket on the uploads volume. Above 50 MB the route answers 413 (and `nginx.conf`'s 52 MB `client_max_body_size`, plus the `Content-Length` check in `src/lib/files/upload-guard.ts`, refuse ahead of it); above 14 MB it is stored but `transcribeRecording()` refuses, so grading parks it for a human rather than failing.
- [ ] CV upload on the public apply form is capped at 5 MB (`CV_MAX_MB`, `src/modules/careers/cv-rules.ts`) with its type rules, and the staff attachment door applies the same shared format table.

### AI gateway
- [ ] With no provider key, a screening shows the "No AI provider is configured" error (not a crash).
- [ ] With Settings credentials saved, they **override** env vars.
- [ ] Kill the primary model's key → the gateway walks to the fallback and records it in `attempts`.

### Omnichannel & cron
- [ ] `/api/cron/whatsapp` and `/api/cron/grading` answer **401** with a wrong or missing `x-cron-secret`, **503** when `CRON_SECRET` is unset (fails closed), and **200** with the header from `docker/.env`.
- [ ] A stage change enqueues a scheduled job that the `cron` container then drains — watch it with `docker compose -f docker/docker-compose.yml --env-file docker/.env logs -f cron`.

### Theming (the reason `check-themes` exists)
- [ ] Toggle Base ↔ Liquid-glass, Light ↔ Dark: every surface repaints with no flash.
- [ ] Fixed/floating surfaces (rail, app bar, dialogs, the careers chat) behave — see the glass frost rules in `globals.css`.

---

## Adding tests (if you want them)

Nothing stops a test runner from being introduced. The natural seams are:

- **Domain pure functions** — `modules/careers/chatbot`, `screening` JSON parsing (`parseJsonResponse`/`balancedJsonRegion`), `getCostTier`, `modelChains` ordering, `listFilters`.
- **Gateway** — unit-test `routeFor()` prefix/namespace/bare resolution and chain de-duplication with a fetch stub.
- **RLS** — the policy surface already has executable proofs against the running stack (`stack:prove`, `files:prove`); `pgTAP` would move them into the database itself, against a throwaway schema.

If you add one, wire it into `package.json` scripts and mention it in [CONTRIBUTING](../CONTRIBUTING.md).
