# Job distribution to external boards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the platform's open roles in the formats external boards and crawlers can read — `JobPosting` JSON-LD, a sitemap, a robots file, an RSS feed and a CSV — with no credentials, no new table, and no touch to the candidate portal.

**Architecture:** Two pure domain modules do all the thinking (`src/modules/careers/job-posting.ts` maps a role onto schema.org; `src/modules/careers/job-distribution.ts` writes the sitemap entries, the RSS document and the CSV), and five thin surfaces call them. One read change gives the domain the dates it needs. Nothing new decides what is public — the existing anonymous RLS policy `jobs_public_read` does that, exactly as it does for the board today.

**Tech Stack:** Next.js 16.4 App Router with Cache Components, React 19.3, TypeScript 5 strict, PostgREST over the anon key, plain-Node proof scripts (this repo has no test runner).

**Spec:** [docs/superpowers/specs/2026-10-24-job-distribution-design.md](../../specs/2026-10-24-job-distribution-design.md) — approved by the owner 2026-10-25. Every task below argues from it; read it before starting.

---

## Global Constraints

These bind every task. They are copied from the spec and from the repository's standing rules.

- **No new dependency.** Nothing is installed for this slice. `package.json` and `package-lock.json` must not change.
- **No migration, no DDL.** No `npm run db:apply-local`, no `docker:psql`, no `ALTER`/`CREATE`/`DROP` anywhere. This slice reads columns that already exist.
- **No credentials.** No board account, no API key, no outbound push. Every surface is crawlable or hand-carried.
- **Nothing new becomes public.** Every surface reads through `getAnonRestClient()` and the `jobs_public_read` policy that the careers board already uses. A draft role cannot appear in the sitemap, feed, CSV or JSON-LD — by the database refusing the row, not by a filter this code adds.
- **The candidate portal is off-limits.** No edit to `src/app/(candidate)/`, `NoticeInbox`, or `communication_logs`. `src/app/(admin)/` is not touched either.
- **Escaping is not optional.** The JSON-LD string is `JSON.stringify(...).replace(/</g, "\\u003c")` (Next's own recipe, `node_modules/next/dist/docs/01-app/02-guides/json-ld.md`). XML and CSV writers escape their own output. No role text reaches a response unescaped.
- **One base URL.** `appConfig.url` ([src/lib/config.ts:39](../../../src/lib/config.ts)) is the only public base-URL source. A trailing slash is normalised away before any path is appended.
- **One date rule.** `dateOf` in `job-posting.ts` is the single place the "which date does a role publish on" decision lives. `sitemapEntries`, `rssFeed` and `jobsCsv` all ask it rather than each deciding.
- **A metadata route or feed route that reads the database must call `await connection()`.** The Docker image builds with no database and no secrets (`.dockerignore` excludes `.env*`), and a `use cache` scope reachable from a prerendered route is executed during the build's cache-warming phase. `await connection()` is the mechanism the careers pages already use ([src/app/careers/page.tsx:171](../../../src/app/careers/page.tsx)).
- **Every task ends green**, in this order:
  - `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0
  - `npm run lint` → clean, except the two tolerated pre-existing warnings: the unused `overrides` in `scripts/prove-scoring-rubric.mjs`, and `react-hooks/exhaustive-deps` in `src/app/(candidate)/portal/PortalTracker.tsx`
  - `node scripts/prove-job-distribution.mjs` → `NNN checks passed`
- **Proof scripts run with plain node** (`node scripts/<name>.mjs`). A `MODULE_TYPELESS_PACKAGE_JSON` warning on a plain-node run is benign and expected.
- **Domain modules import React-free and `next`-free** and perform no I/O — no fetch, no cookies, no `fs`. A proof script must be able to import them with only fixtures.
- **Commit subject is conventional lowercase with a why-body.** `git add` only the files the task names. Never `git add -A`.
- **Do not kill the dev server on localhost:3001** and do not start a competing `next dev`/`next build`. `docker compose build app` is the isolated build — stop at "Built" and ask before serving.

---

## File structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `src/modules/careers/job-board.ts` | Modify | `PublicJob` gains the three date columns and nothing else |
| `src/app/careers/actions.ts` | Modify | `JOB_COLUMNS` selects them; `toJob` maps them |
| `src/modules/careers/job-posting.ts` | Create | The schema.org mapping: the date rule, `jobPosting`, `jobPostingJsonLd` |
| `src/modules/careers/job-distribution.ts` | Create | The pull surfaces: `partitionByDate`, `sitemapEntries`, `jobsCsv`, `rssFeed` |
| `src/app/careers/[id]/page.tsx` | Modify | Surface (a): one `<script type="application/ld+json">` |
| `src/app/sitemap.ts` | Create | Surface (b) |
| `src/app/robots.ts` | Create | Surface (c) |
| `src/app/api/careers/feed.xml/route.ts` | Create | Surface (d) |
| `src/app/api/careers/jobs.csv/route.ts` | Create | Surface (e) |
| `scripts/prove-job-distribution.mjs` | Create + grow | The whole offline proof: fixtures + source pins + one read-only live check |
| `docs/superpowers/specs/2026-10-24-job-distribution-design.md` | Modify | Only its `Status:` line, in the last task |

`scripts/prove-job-distribution.mjs` is appended to by every task; no task rewrites a section another task landed.

---

## Where this plan differs from the spec, and why

Four points. Each is stated here so a reviewer meets it as a decision, not a surprise.

1. **`hiringOrganization.name` gains a second step.** The spec's chain is `company.name` → group profile → `"Sharm Dreams Group"`. This plan inserts `job.company_name` after the company row: `company?.name` → `job.company_name` → `options.groupName` → `GROUP_NAME`. `getPublicCompanies()` filters `is_active = true`, so a role filed under a retired company resolves to no `PublicCompany` at all — while the role's own join still carries its employer's name, which is exactly what the page already prints for it ([src/app/careers/[id]/page.tsx:260](../../../src/app/careers/[id]/page.tsx)). Naming the group instead would assert an employer the record does not claim. The spec's own principle — "a role whose company row is missing still names an employer" — is better served by the role's own name than by the group's.
2. **`rssFeed`'s signature carries the channel title.** The spec's sketch was `rssFeed(jobs, baseUrl)`, but its §3(d) requires the channel to carry the group's name. Neither `jobs` nor `baseUrl` can supply that, so the signature takes an options object. The requirement wins over the sketch.
3. **`jobLocation` is typed, not `unknown[]`.** The spec wrote `jobLocation?: unknown[]` in a design sketch. Task 2 declares the `Place` and `Country` interfaces (the `PostalAddress` sits inline inside `Place`, because nothing else in the file names it) and types the two fields with them, so a reader of the domain sees the shape the module promises. Same emitted JSON, one less `unknown` in the domain.
4. **The feed escapes text, not attributes — and says so.** §3(d) of the spec gives the escaping rule for both (`&`, `<`, `>` in text; plus `"` in attributes). Every attribute this feed emits is the literal `isPermaLink="true"`: no role text ever lands in an attribute, so an attribute escaper would have no caller, and `@typescript-eslint/no-unused-vars` would report it as a warning in a suite the Global Constraints hold to two. The rule is honoured by never writing one, and Task 5's module comment states the condition that would make it live. A reviewer who wants the quote case covered should extend the fixture, not add a dead function — Task 5's third bite direction is exactly that fixture.

No other deviation is authorised.

---

### Task 1: The public read gains the three dates

`datePosted` has no source today: `JOB_COLUMNS` selects neither `posted_at` nor `created_at`, and `toJob` maps neither. Nothing else in the slice works until this does.

**Files:**
- Modify: `src/modules/careers/job-board.ts` (the `PublicJob` interface, currently `:17-37`)
- Modify: `src/app/careers/actions.ts:48-49` (`JOB_COLUMNS`) and `:72-99` (`toJob`)
- Create: `scripts/prove-job-distribution.mjs`

**Interfaces:**
- Produces: `PublicJob.posted_at: string | null`, `PublicJob.created_at: string`, `PublicJob.closing_at: string | null` — read by every later task. `scripts/prove-job-distribution.mjs` with the `check` / `sourceHas` harness and its section 1.

- [ ] **Step 1: Create the proof script with a failing section 1**

Create `scripts/prove-job-distribution.mjs`. The header, the `@/`-alias resolver and the `check`/`sourceHas` helpers are copied from the house pattern in `scripts/prove-coding-question.mjs:1-53` — read that file, do not re-invent the harness.

```js
/* scripts/prove-job-distribution.mjs
 * Run: node scripts/prove-job-distribution.mjs
 *
 * Nothing here needs a database, a board account or a browser. What is pinned is
 * the part every surface shares: the columns the public read is allowed to see,
 * the schema.org mapping, the three pull artifacts, and the fact that each of the
 * five doors actually opens onto the module rather than writing its own version.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// The modules under test import through the app's `@/` alias and through
// extensionless sibling paths. Plain Node resolves neither, so teach this one
// process the bundler's mapping before any dynamic import runs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".") && context.parentURL?.startsWith("file:")
        ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
        : null;
    if (base) {
      for (const candidate of [base, `${base}.ts`]) {
        if (existsSync(candidate) && candidate.endsWith(".ts")) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function sourceHas(name, rel, needles) {
  const text = read(rel);
  const missing = needles.filter((needle) => !text.includes(needle));
  check(name, missing.length === 0, missing.map((n) => `missing ${JSON.stringify(n)}`).join(", "));
}

// ---------------------------------------------------------------------------
// 1. The public read carries the dates a posting is dated by.
// ---------------------------------------------------------------------------
// Pinned against the column list itself, not against the file: `posted_at`
// already appears in actions.ts as the board's sort key, so a loose substring
// check would pass before this slice exists.
const jobColumns = ((/const JOB_COLUMNS =\s*\n?\s*"([^"]+)"/.exec(read("src/app/careers/actions.ts")) ?? [])[1] ?? "")
  .split(",")
  .map((name) => name.trim());
for (const column of ["posted_at", "closing_at", "created_at"]) {
  check(`the public read selects ${column}`, jobColumns.includes(column));
}
sourceHas("toJob maps the three date columns", "src/app/careers/actions.ts", [
  "posted_at:",
  "closing_at:",
  "created_at:",
]);
sourceHas("PublicJob declares the three date columns", "src/modules/careers/job-board.ts", [
  "posted_at: string | null;",
  "created_at: string;",
  "closing_at: string | null;",
]);
check(
  "the published-only rule stays where the policy puts it",
  read("src/app/careers/actions.ts").includes('.eq("status", "PUBLISHED")'),
  "a surface that stopped filtering on PUBLISHED would publish a draft"
);

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`${passed} checks passed`);
```

- [ ] **Step 2: Run it and watch section 1 fail**

Run: `node scripts/prove-job-distribution.mjs`
Expected: exit 1 with five failures — `✗ the public read selects posted_at`, `✗ the public read selects closing_at`, `✗ the public read selects created_at`, `✗ toJob maps the three date columns`, `✗ PublicJob declares the three date columns`. The sixth check (the PUBLISHED filter) passes; it pins code that already exists.

- [ ] **Step 3: Add the three fields to `PublicJob`**

In `src/modules/careers/job-board.ts`, inside `export interface PublicJob` (currently `:17-37`), after the `company_name: string | null;` line:

```ts
  /**
   * The day the role went public, or null for a row that reached PUBLISHED
   * before the column was stamped. `posted_at` is set on the first publication
   * and never removed (`src/app/(admin)/jobs/job-actions.ts`), so a published
   * role normally has a real day; `created_at` is the fallback, and a role with
   * neither is not dated enough to publish to the world.
   */
  posted_at: string | null;
  created_at: string;
  /** The advertised closing date, or null. Feeds `validThrough` only. */
  closing_at: string | null;
```

- [ ] **Step 4: Select the columns**

In `src/app/careers/actions.ts`, replace the `JOB_COLUMNS` value at `:48-49`. Keep the comment above it untouched — it explains why `experience_level` is absent, and that is still true:

```ts
const JOB_COLUMNS =
  "id, title, tenant_id, department, sector, location, employment_type, description, requirements, min_salary_usd, max_salary_usd, salary_currency, posted_at, closing_at, created_at, tenants_and_companies(name)";
```

- [ ] **Step 5: Map them in `toJob`**

In `src/app/careers/actions.ts`, inside `toJob`, after the `company_name:` line and before the closing `};`:

```ts
    // `created_at` is `not null` in the database, so an absent value means the
    // read shape changed, not that the row has no date; it becomes "" and
    // `dateOf` treats "" as absent. The other two are nullable columns.
    posted_at: typeof row.posted_at === "string" ? row.posted_at : null,
    created_at: String(row.created_at ?? ""),
    closing_at: typeof row.closing_at === "string" ? row.closing_at : null,
```

- [ ] **Step 6: Run the proof and the gates**

Run: `node scripts/prove-job-distribution.mjs` → `6 checks passed`
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0 (the three fields are additive; `toJob` is the only place a `PublicJob` is constructed, so no other file can break)
Run: `npm run lint` → clean apart from the two tolerated warnings

- [ ] **Step 7: Prove the read still returns real rows, read-only**

The board must still work with the widened column list. Start nothing new — reuse the stack the user already has running.

Run: `node scripts/prove-local-stack.mjs` and confirm it still passes (it exercises the real REST reads). Do **not** start a second dev server. If the stack is not reachable, record that in the task report instead of starting containers; do not treat an unreachable local database as a failure of this task.

- [ ] **Step 8: Commit**

```bash
git add src/modules/careers/job-board.ts src/app/careers/actions.ts scripts/prove-job-distribution.mjs
git commit -m "$(cat <<'EOF'
feat(careers): carry a role's dates into the public read

A JobPosting is required to say when it was posted, and the public board's
column list reads neither posted_at nor created_at today. Nothing in the
distribution slice works until the record behind it is dated, so this widens
one select and one mapping — toJob is the only place a PublicJob is built.
EOF
)"
```

---

### Task 2: `job-posting.ts` — the date rule and the fields Google requires

**Files:**
- Create: `src/modules/careers/job-posting.ts`
- Modify: `scripts/prove-job-distribution.mjs` (append section 2, before the `if (failures.length > 0)` block)

**Interfaces:**
- Consumes: `PublicJob` (type-only), `PublicCompany` (type-only), `PublicJob.posted_at` / `.created_at` / `.company_name` from Task 1.
- Produces: `GROUP_NAME: string`, `dateOf(job: PublicJob): string | null`, `jobPosting(job: PublicJob, company: PublicCompany | null, options: { baseUrl: string; groupName?: string }): JobPosting | null`, `interface JobPosting`. Task 3 adds `jobPostingJsonLd` to the same file.

- [ ] **Step 1: Write the failing checks**

Append to `scripts/prove-job-distribution.mjs`, above the final `if (failures.length > 0)`:

```js
// ---------------------------------------------------------------------------
// 2. The schema.org mapping: what a role becomes, and what it cannot become.
// ---------------------------------------------------------------------------
const { GROUP_NAME, dateOf, jobPosting } = await import(
  pathToFileURL(path.join(root, "src/modules/careers/job-posting.ts")).href
);

/** The smallest role that is a role. Every fixture starts here. */
const role = (over = {}) => ({
  id: "3f2a1b00-0000-4000-8000-000000000001",
  title: "Site Quantity Surveyor",
  department: "Commercial",
  sector: "real_estate",
  location: "Sharm El Sheikh",
  employment_type: "FULL_TIME",
  experience_level: null,
  description: "Measure the work before it is poured.",
  requirements: ["5 years on site", "AutoCAD"],
  min_salary_usd: null,
  max_salary_usd: null,
  salary_currency: "USD",
  company_id: "tenant-1",
  company_name: "Dreams Development",
  posted_at: "2026-10-01T00:00:00.000Z",
  created_at: "2026-09-20T00:00:00.000Z",
  closing_at: null,
  ...over,
});

const company = (over = {}) => ({
  id: "tenant-1",
  name: "Dreams Development",
  legal_name: null,
  slug: "dreams-development",
  sector: "real_estate",
  tagline: null,
  description: null,
  history: null,
  careers_pitch: null,
  founded_year: null,
  ownership_type: null,
  employee_range: null,
  headquarters: null,
  milestones: [],
  benefits: [],
  website: null,
  is_group_profile: false,
  sort_order: 100,
  ...over,
});

check("dateOf prefers the day it went public", dateOf(role()) === "2026-10-01T00:00:00.000Z");
check(
  "dateOf falls back to the day the row was made",
  dateOf(role({ posted_at: null })) === "2026-09-20T00:00:00.000Z"
);
check(
  "dateOf treats blank text as no date at all",
  dateOf(role({ posted_at: "  ", created_at: "" })) === null
);

const posted = jobPosting(role(), company(), { baseUrl: "https://careers.example/" });
check("a role with a date makes a posting", posted !== null);
check("the trailing slash is not doubled into the url", posted?.url === `https://careers.example/careers/${role().id}`);
check("the title names the role, not the employer", posted?.title === "Site Quantity Surveyor");
check("the description is the column verbatim", posted?.description === "Measure the work before it is poured.");
check("datePosted is the publication day", posted?.datePosted === "2026-10-01T00:00:00.000Z");
check("the employer is the role's own company", posted?.hiringOrganization.name === "Dreams Development");
check("a company with no legal name files none", posted?.hiringOrganization.legalName === undefined);
check("a company with no website files no sameAs", posted?.hiringOrganization.sameAs === undefined);
check("the apply form is one click away", posted?.directApply === true);
check(
  "the identifier is the role's own id",
  posted?.identifier.value === "3f2a1b00-0000-4000-8000-000000000001" &&
    posted?.identifier.name === "Job ID"
);
check("a role with no closing date says none", posted?.validThrough === undefined);
check(
  "a role that closes on a day carries it",
  jobPosting(role({ closing_at: "2026-11-30T00:00:00.000Z" }), company(), {
    baseUrl: "https://careers.example",
  })?.validThrough === "2026-11-30T00:00:00.000Z"
);

// The employer chain, step by step. Each step must name an employer; only the
// first one may name the wrong company.
check(
  "a legal name that differs from the name is filed",
  jobPosting(role(), company({ legal_name: "Dreams Development LLC" }), {
    baseUrl: "https://careers.example",
  })?.hiringOrganization.legalName === "Dreams Development LLC"
);
check(
  "a legal name identical to the name is not repeated",
  jobPosting(role(), company({ legal_name: "Dreams Development" }), {
    baseUrl: "https://careers.example",
  })?.hiringOrganization.legalName === undefined
);
check(
  "a filed website becomes sameAs",
  jobPosting(role(), company({ website: "https://dreams.example" }), {
    baseUrl: "https://careers.example",
  })?.hiringOrganization.sameAs === "https://dreams.example"
);
check(
  "a role with no company row keeps its own company name",
  jobPosting(role(), null, { baseUrl: "https://careers.example", groupName: "Sharm Dreams" })
    ?.hiringOrganization.name === "Dreams Development"
);
check(
  "a role whose join carried no name falls to the group",
  jobPosting(role({ company_name: null }), null, {
    baseUrl: "https://careers.example",
    groupName: "Sharm Dreams Holdings",
  })?.hiringOrganization.name === "Sharm Dreams Holdings"
);
check(
  "with neither company nor group it names the group it belongs to",
  jobPosting(role({ company_name: null }), null, { baseUrl: "https://careers.example" })
    ?.hiringOrganization.name === GROUP_NAME
);

// The one null case: a role that cannot be dated is not published.
check(
  "an undated role makes no posting at all",
  jobPosting(role({ posted_at: null, created_at: "" }), company(), {
    baseUrl: "https://careers.example",
  }) === null
);
check("the group literal is the one the spec names", GROUP_NAME === "Sharm Dreams Group");
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/prove-job-distribution.mjs`
Expected: the process exits with an unresolved-import / module-not-found error for `src/modules/careers/job-posting.ts`. That is the failure for this step; the file does not exist yet.

- [ ] **Step 3: Write the module**

Create `src/modules/careers/job-posting.ts`:

```ts
/**
 * The schema.org `JobPosting` for one published role.
 *
 * Kept out of the page and out of the routes because five surfaces publish the
 * same record in five formats, and a role that reads as posted on Monday in the
 * sitemap and Tuesday in the feed is worse than a role nobody indexes. Both
 * imports are type-only: this module has no runtime dependency on the board's
 * vocabularies or the company parser, and a proof script can exercise every rule
 * here against a plain object.
 */

import type { PublicJob } from "@/modules/careers/job-board";
import type { PublicCompany } from "@/modules/careers/company-profile";

/**
 * `job_openings` has no country column and its `location` is free text, and the
 * public company read deliberately lists only the columns the public page
 * prints. So the country in a posting is the group's own country — a named
 * constant, not a per-role fact.
 */
const COUNTRY = "Egypt";

/** The employer a role falls back to when nothing above it names one. */
export const GROUP_NAME = "Sharm Dreams Group";

/**
 * The two shapes that carry "where the work happens".
 *
 * Typed rather than `unknown[]` because a posting's place is the one part of this
 * object another module reads back — the proof checks a nested path, and so does
 * nothing else in the domain. A `Country` is a name, not a code: `job_openings`
 * has no country column, and the value is the group's own country.
 */
export interface Country {
  "@type": "Country";
  name: string;
}

export interface Place {
  "@type": "Place";
  address: {
    "@type": "PostalAddress";
    addressLocality: string;
    addressCountry: Country;
  };
}

export interface JobPosting {
  "@context": "https://schema.org";
  "@type": "JobPosting";
  title: string;
  description: string;
  datePosted: string;
  hiringOrganization: {
    "@type": "Organization";
    name: string;
    legalName?: string;
    sameAs?: string;
  };
  url: string;
  identifier: { "@type": "PropertyValue"; name: string; value: string };
  directApply: boolean;
  employmentType?: string;
  jobLocationType?: string;
  jobLocation?: Place[];
  applicantLocationRequirements?: Country[];
  validThrough?: string;
}

/** Blank-as-absent text, so a column of spaces cannot become a published value. */
function trimmed(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

/**
 * The one date rule, in one place.
 *
 * `posted_at` is the day the role went public; `created_at` is the fallback for a
 * row that reached PUBLISHED without one. Both blank means the role has no day to
 * publish on, and `datePosted` is one of Google's required properties — so the
 * caller gets null and every surface decides what to do about it. The feed, the
 * sitemap and the CSV all ask this function rather than each inventing a date.
 */
export function dateOf(job: PublicJob): string | null {
  return trimmed(job.posted_at) ?? trimmed(job.created_at);
}

/** The role's canonical page, on the one public base URL the app has. */
function jobUrl(job: PublicJob, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/careers/${job.id}`;
}

/**
 * The employer, in the order the record supports.
 *
 * The role's own company row first. Then the name the role's own join carried —
 * `getPublicCompanies` asks for active rows only, so a role filed under a retired
 * company resolves to no company at all while still naming its employer, which is
 * the name the page itself prints. Then the group profile, then the group.
 */
function employerName(
  job: PublicJob,
  company: PublicCompany | null,
  groupName: string | undefined
): string {
  return (
    trimmed(company?.name) ??
    trimmed(job.company_name) ??
    trimmed(groupName) ??
    GROUP_NAME
  );
}

/**
 * The role as Google wants it, or null when the record cannot make a valid posting.
 *
 * Returning null rather than a half-built object forces every caller to decide
 * what to do, and the decision is stated once: a role with no date is not
 * published to the world.
 */
export function jobPosting(
  job: PublicJob,
  company: PublicCompany | null,
  options: { baseUrl: string; groupName?: string }
): JobPosting | null {
  const datePosted = dateOf(job);
  if (!datePosted) return null;

  const employer = employerName(job, company, options.groupName);
  const posting: JobPosting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    datePosted,
    hiringOrganization: { "@type": "Organization", name: employer },
    url: jobUrl(job, options.baseUrl),
    identifier: { "@type": "PropertyValue", name: "Job ID", value: job.id },
    directApply: true,
  };

  const legalName = trimmed(company?.legal_name);
  if (legalName && legalName !== employer) posting.hiringOrganization.legalName = legalName;
  const website = trimmed(company?.website);
  if (website) posting.hiringOrganization.sameAs = website;

  const closing = trimmed(job.closing_at);
  if (closing) posting.validThrough = closing;

  return posting;
}
```

- [ ] **Step 4: Run the proof and the gates**

Run: `node scripts/prove-job-distribution.mjs` → all section-1 and section-2 checks pass
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0
Run: `npm run lint` → clean apart from the two tolerated warnings

- [ ] **Step 5: Prove the null branch bites both ways**

The spec's rule is "no date ⇒ no posting", and a check that passes for the wrong reason is worse than no check. Confirm the two directions by hand, without editing the module:

Run:

```bash
node --input-type=module -e '
const { registerHooks } = await import("node:module");
console.log(typeof (await import("./src/modules/careers/job-posting.ts")).jobPosting);
' 2>/dev/null || echo "plain node cannot import .ts — expected; the proof script is the harness"
```

Then read the two checks just landed (`an undated role makes no posting at all`, `dateOf treats blank text as no date at all`) and confirm one asserts `=== null` and the other `=== null` for a *different* input shape (blank strings vs nulls). Both directions — present and absent — are asserted inside the script; record in the report which check covers which.

- [ ] **Step 6: Commit**

```bash
git add src/modules/careers/job-posting.ts scripts/prove-job-distribution.mjs
git commit -m "$(cat <<'EOF'
feat(careers): map a published role onto schema.org JobPosting

Google requires datePosted, and the platform has two columns that could answer
it. Which one is decided once, here, so the sitemap, the feed and the CSV cannot
each invent their own date for the same role. A role with neither is returned as
null rather than half-built: a posting nobody can date is a claim the record
does not make.
EOF
)"
```

---

### Task 3: `job-posting.ts` — employment, place, and the string that goes in the tag

`employment_type` mixes contracts with workplace arrangements, and schema.org does not know the difference. This is the task where the mapping stops being a copy and starts being a judgement.

**Files:**
- Modify: `src/modules/careers/job-posting.ts`
- Modify: `scripts/prove-job-distribution.mjs` (append section 3)

**Interfaces:**
- Consumes: `jobPosting`, `PublicJob` from Task 2.
- Produces: `jobPostingJsonLd(posting: JobPosting): string`. Task 6 is the only page that calls it.

- [ ] **Step 1: Write the failing checks**

Append above the final `if (failures.length > 0)` in `scripts/prove-job-distribution.mjs` (`role` and `company` from section 2 are still in scope):

```js
// ---------------------------------------------------------------------------
// 3. Employment and place: where the platform's vocabulary and Google's diverge.
// ---------------------------------------------------------------------------
const { jobPostingJsonLd } = await import(
  pathToFileURL(path.join(root, "src/modules/careers/job-posting.ts")).href
);

const post = (over) => jobPosting(role(over), company(), { baseUrl: "https://careers.example" });

// Google names a contract; the column mixes contracts with arrangements.
check("FULL_TIME is the same word both sides", post({ employment_type: "FULL_TIME" })?.employmentType === "FULL_TIME");
check("PART_TIME is the same word both sides", post({ employment_type: "PART_TIME" })?.employmentType === "PART_TIME");
check("CONTRACT becomes Google's CONTRACTOR", post({ employment_type: "CONTRACT" })?.employmentType === "CONTRACTOR");
check("INTERNSHIP becomes Google's INTERN", post({ employment_type: "INTERNSHIP" })?.employmentType === "INTERN");
check(
  "REMOTE names an arrangement, not a contract, so it says nothing",
  post({ employment_type: "REMOTE" })?.employmentType === undefined
);
check(
  "HYBRID names an arrangement, not a contract, so it says nothing",
  post({ employment_type: "HYBRID" })?.employmentType === undefined
);
check(
  "a code the CHECK constraint never saw is OTHER, not a guess",
  post({ employment_type: "FREELANCE_ROTATION" })?.employmentType === "OTHER"
);
check("an empty job type says nothing", post({ employment_type: "" })?.employmentType === undefined);

// Place.
const place = post({})?.jobLocation?.[0];
check(
  "a role with a place carries it as a PostalAddress",
  place?.address?.addressLocality === "Sharm El Sheikh" &&
    place?.address?.addressCountry?.name === "Egypt"
);
check("a role that is not remote files no location type", post({})?.jobLocationType === undefined);

// Remote: the arrangement is carried by jobLocationType, which is where Google looks.
const remoteByType = post({ employment_type: "REMOTE", location: "" });
check("a remote role files TELECOMMUTE", remoteByType?.jobLocationType === "TELECOMMUTE");
check("a remote role with no place files no jobLocation", remoteByType?.jobLocation === undefined);
check(
  "a remote role names the countries an applicant may live in",
  remoteByType?.applicantLocationRequirements?.[0]?.name === "Egypt"
);
const remoteByText = post({ employment_type: "FULL_TIME", location: "Remote" });
check("the word remote in the location text is enough to be remote", remoteByText?.jobLocationType === "TELECOMMUTE");
check("and it loses no employment contract for it", remoteByText?.employmentType === "FULL_TIME");
const remoteWithOffice = post({ employment_type: "REMOTE", location: "Cairo / Remote" });
check(
  "a remote role that also names a real place keeps the hiring office",
  remoteWithOffice?.jobLocation?.[0]?.address?.addressLocality === "Cairo / Remote" &&
    remoteWithOffice?.jobLocationType === "TELECOMMUTE"
);
const hybrid = post({ employment_type: "HYBRID", location: "Sharm El Sheikh" });
check("a hybrid role files HYBRID and keeps its place", hybrid?.jobLocationType === "HYBRID" && hybrid?.jobLocation?.length === 1);
check(
  "a non-remote role files no applicant location requirements",
  post({})?.applicantLocationRequirements === undefined
);
check(
  "a role with an empty location is not a crash, just an addressless posting",
  post({ location: "   " })?.jobLocation === undefined
);

// baseSalary is deliberately absent: the platform stores an amount and a
// currency and no period, so any unitText would be invented.
check(
  "no salary is emitted, because no period is recorded",
  post({ min_salary_usd: 40000, max_salary_usd: 60000 })?.baseSalary === undefined
);

// The string that goes inside the <script> tag.
const ld = jobPostingJsonLd(
  jobPosting(role({ description: "We are hiring. </script><script>alert(1)</script>" }), company(), {
    baseUrl: "https://careers.example",
  })
);
check("the escape is the JSON escape, not a stripped tag", ld.includes("\\u003c/script>"));
check("no literal angle bracket survives to close the tag", !ld.includes("<"));
check(
  "what the browser parses back is the text the author typed",
  JSON.parse(ld).description === "We are hiring. </script><script>alert(1)</script>"
);
check(
  "a posting with no angle brackets round-trips untouched",
  JSON.parse(jobPostingJsonLd(post({}))).title === "Site Quantity Surveyor"
);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/prove-job-distribution.mjs`
Expected: exit 1 with `jobPostingJsonLd` reported as `undefined is not a function` (or the checks listed as failed). No `employmentType` on the posting yet.

- [ ] **Step 3: Add the vocabulary and place rules**

In `src/modules/careers/job-posting.ts`, above `jobPosting`, add:

```ts
/** Google names a contract; the platform's column mixes contracts with arrangements. */
const EMPLOYMENT_TYPES: Record<string, string> = {
  FULL_TIME: "FULL_TIME",
  PART_TIME: "PART_TIME",
  CONTRACT: "CONTRACTOR",
  INTERNSHIP: "INTERN",
};

/**
 * Codes that describe where the work happens, not what the worker is on.
 *
 * The platform's own column default is FULL_TIME, but a recruiter who filed
 * "Remote" replaced that default rather than added to it, so the contract is
 * genuinely unrecorded. Stating FULL_TIME would be a claim the record does not
 * make; the arrangement is not lost — `jobLocationType` is where Google looks
 * for it.
 */
const ARRANGEMENT_ONLY = new Set(["REMOTE", "HYBRID"]);

/** A role is remote when the text says so or the code says so. */
function isRemote(job: PublicJob): boolean {
  return /\bremote\b/i.test(job.location) || job.employment_type.trim().toUpperCase() === "REMOTE";
}

function employmentTypeOf(job: PublicJob): string | null {
  const code = job.employment_type.trim().toUpperCase();
  if (!code) return null;
  const mapped = EMPLOYMENT_TYPES[code];
  if (mapped) return mapped;
  return ARRANGEMENT_ONLY.has(code) ? null : "OTHER";
}

function locationTypeOf(job: PublicJob): string | null {
  if (isRemote(job)) return "TELECOMMUTE";
  return job.employment_type.trim().toUpperCase() === "HYBRID" ? "HYBRID" : null;
}

/**
 * The recruiter's own words, or null when they name no place.
 *
 * "Remote" alone is an arrangement; "Cairo / Remote" still names an office. The
 * text is returned whole rather than re-spelled, because `location` is free text
 * and editing it would invent an address nobody filed.
 */
function placeOf(location: string): string | null {
  const words = location.split(/\s+/).filter(Boolean);
  return words.some((word) => !/^remote[.,!?]$/i.test(word)) ? location.trim() : null;
}

function placeValue(locality: string): Place {
  return {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: locality,
      addressCountry: { "@type": "Country", name: COUNTRY },
    },
  };
}
```

- [ ] **Step 4: Wire the rules into `jobPosting`**

Inside `jobPosting`, after the `validThrough` block and before `return posting;`:

```ts
  const employmentType = employmentTypeOf(job);
  if (employmentType) posting.employmentType = employmentType;

  const locationType = locationTypeOf(job);
  if (locationType) posting.jobLocationType = locationType;

  const locality = placeOf(job.location);
  // A remote role keeps an office only when its text names one, and always names
  // the countries an applicant may live in — Google requires at least one.
  if (locality) posting.jobLocation = [placeValue(locality)];
  if (isRemote(job)) {
    posting.applicantLocationRequirements = [{ "@type": "Country", name: COUNTRY }];
  }
```

- [ ] **Step 5: Add the JSON-LD writer**

At the bottom of `src/modules/careers/job-posting.ts`:

```ts
/**
 * The exact string that goes inside the `<script type="application/ld+json">` tag.
 *
 * Next's own recipe (`node_modules/next/dist/docs/01-app/02-guides/json-ld.md`):
 * every `<` becomes the JSON escape, which parses back to `<` in the object and
 * cannot close the tag the description opened. The proof script parses the same
 * string this returns, so the escaping is tested rather than asserted.
 *
 * `baseSalary` is absent by design. Google wants a `MonetaryAmount` with a
 * `unitText` — YEAR, MONTH, HOUR — and the platform records an amount and a
 * currency and no period. A `salary_period` column would make this emittable
 * honestly; that column is not in this slice.
 */
export function jobPostingJsonLd(posting: JobPosting): string {
  return JSON.stringify(posting).replace(/</g, "\\u003c");
}
```

- [ ] **Step 6: Run the proof and the gates**

Run: `node scripts/prove-job-distribution.mjs` → all sections pass
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0
Run: `npm run lint` → clean apart from the two tolerated warnings

Note on the `JobPosting` interface: `jobLocation` and `applicantLocationRequirements` are the typed `Place[]` / `Country[]` the deviation section names, declared in Task 2 and used by `placeValue` here. The proof script reads their nested fields from a `.mjs`, where types are stripped, so the typing is for the domain's own readers — if a later task needs a field the interface does not carry, extend `Place` rather than widen the field back to `unknown[]`.

- [ ] **Step 7: Prove the escape pin bites**

A pin that would pass on a stripped-tag implementation is not a pin. Temporarily change the escape in `jobPostingJsonLd` from `.replace(/</g, "\\u003c")` to `.replace(/</g, "")`, run `node scripts/prove-job-distribution.mjs`, confirm `no literal angle bracket survives to close the tag` still passes while `the escape is the JSON escape, not a stripped tag` and `what the browser parses back is the text the author typed` fail, then restore the exact original line. Record the two failing check names in the report.

- [ ] **Step 8: Commit**

```bash
git add src/modules/careers/job-posting.ts scripts/prove-job-distribution.mjs
git commit -m "$(cat <<'EOF'
feat(careers): state a role's contract and place the way Google reads them

The employment_type column mixes contracts with workplace arrangements and
schema.org does not know the difference, so REMOTE and HYBRID lose
employmentType rather than borrowing FULL_TIME — the contract was replaced, not
recorded. Salary is left out for the same reason: an amount with no period is
not a MonetaryAmount. The JSON-LD writer escapes the way Next's own guide does,
so a description containing a closing tag cannot break out of the script.
EOF
)"
```

---

### Task 4: `job-distribution.ts` — sitemap entries and the CSV hand-off

**Files:**
- Create: `src/modules/careers/job-distribution.ts`
- Modify: `scripts/prove-job-distribution.mjs` (append section 4)

**Interfaces:**
- Consumes: `PublicJob` (type-only), `dateOf` (runtime) from `job-posting.ts`.
- Produces: `interface SitemapEntry { url: string; lastModified: string; changeFrequency: "daily" | "weekly"; priority: number }`, `partitionByDate(jobs: PublicJob[]): { publishable: PublicJob[]; undated: string[] }`, `sitemapEntries(jobs: PublicJob[], baseUrl: string): SitemapEntry[]`, `jobsCsv(jobs: PublicJob[], baseUrl: string): string`.

- [ ] **Step 1: Write the failing checks**

Append above the final `if (failures.length > 0)`:

```js
// ---------------------------------------------------------------------------
// 4. The pull surfaces: what a crawler and a recruiter's upload form read.
// ---------------------------------------------------------------------------
const { partitionByDate, sitemapEntries, jobsCsv } = await import(
  pathToFileURL(path.join(root, "src/modules/careers/job-distribution.ts")).href
);

check(
  "a dated role becomes one sitemap entry",
  sitemapEntries([role()], "https://careers.example").length === 1
);
const entry = sitemapEntries([role()], "https://careers.example")[0];
check("the entry points at the canonical page", entry.url === `https://careers.example/careers/${role().id}`);
check("and carries the date the posting carries", entry.lastModified === "2026-10-01T00:00:00.000Z");
check("a published role changes daily", entry.changeFrequency === "daily" && entry.priority === 0.8);
check(
  "an undated role is left out rather than given a made-up date",
  sitemapEntries([role({ posted_at: null, created_at: "" })], "https://careers.example").length === 0
);
check(
  "the trailing slash is normalised here too",
  sitemapEntries([role()], "https://careers.example/")[0].url === `https://careers.example/careers/${role().id}`
);

const split = partitionByDate([role(), role({ id: "undated-1", posted_at: null, created_at: "" })]);
check("partitionByDate keeps what it can publish", split.publishable.length === 1 && split.undated.length === 1);
check("and names the one it could not", split.undated[0] === "undated-1");

const csv = jobsCsv([role()], "https://careers.example");
const [head, row] = csv.trimEnd().split("\n");
check(
  "the header is the ten columns the spec names, and no salary",
  head === "title,company,location,job_type,department,sector,description,requirements,date_posted,url"
);
check("every field in the row is quoted", (row.match(/"/g) ?? []).length >= 18 && row.startsWith('"Site Quantity Surveyor"'));
check("the stored job type code travels, not a rendered label", row.includes('"FULL_TIME"'));
check("requirements are joined with a semicolon and a space", row.includes('"5 years on site; AutoCAD"'));
check("the url is the canonical page", row.endsWith(`"https://careers.example/careers/${role().id}"`));
check("and the date is the publication day", row.includes('"2026-10-01T00:00:00.000Z"'));

const messy = jobsCsv(
  [role({ title: 'Big "Boss", Jr', description: "line one\nline two", requirements: [] })],
  "https://careers.example"
);
check('an internal quote is doubled, not escaped with a backslash', messy.includes('"Big ""Boss"", Jr"'));
check("a description with a newline stays inside its quoted field", messy.includes('"line one\nline two"'));
check(
  "one role is one record, even when its text spans lines",
  messy.startsWith('title,company,location,job_type,department,sector,description,requirements,date_posted,url\n"Big ""Boss"", Jr"')
);
check(
  "a role with no requirements files an empty cell, not the word null",
  jobsCsv([role({ requirements: [] })], "https://careers.example").split("\n")[1].includes('""')
);
check(
  "a role with no company name files an empty company cell",
  jobsCsv([role({ company_name: null })], "https://careers.example").split("\n")[1].startsWith(
    '"Site Quantity Surveyor","",'
  )
);
check("an undated role makes no row", jobsCsv([role({ posted_at: null, created_at: "" })], "https://careers.example").trimEnd().split("\n").length === 1);
check("no roles at all is still a header", jobsCsv([], "https://careers.example").trimEnd() === "title,company,location,job_type,department,sector,description,requirements,date_posted,url");
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/prove-job-distribution.mjs`
Expected: module-not-found for `src/modules/careers/job-distribution.ts`.

- [ ] **Step 3: Write the module's date split and sitemap**

Create `src/modules/careers/job-distribution.ts`:

```ts
/**
 * The three pull surfaces: a sitemap, an RSS feed and a CSV.
 *
 * Each takes the published roles and the one public base URL and returns the
 * whole artifact, so the routes that serve them are thin — read, call, respond —
 * and a reviewer can read the escaping rules once. `dateOf` is imported for
 * real, not as a type: the sitemap, the feed, the CSV and the JSON-LD all ask the
 * same question and must get the same day.
 */

import type { PublicJob } from "@/modules/careers/job-board";
import { dateOf } from "@/modules/careers/job-posting";

/** Structurally what `MetadataRoute.Sitemap` asks for, without importing `next`. */
export interface SitemapEntry {
  url: string;
  lastModified: string;
  changeFrequency: "daily" | "weekly";
  priority: number;
}

/** The base URL with no trailing slash, so paths never become `//careers/{id}`. */
function origin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * The roles that can be published, and the ids of the ones that cannot.
 *
 * Every surface drops an undated role; only the caller can say anything about it,
 * so the split is exposed rather than buried in each writer. The route logs the
 * ids — a role silently missing from a sitemap is the kind of bug nobody notices
 * until a recruiter asks why.
 */
export function partitionByDate(jobs: PublicJob[]): {
  publishable: PublicJob[];
  undated: string[];
} {
  const publishable: PublicJob[] = [];
  const undated: string[] = [];
  for (const job of jobs) {
    if (dateOf(job)) publishable.push(job);
    else undated.push(job.id);
  }
  return { publishable, undated };
}

/**
 * One entry per published role.
 *
 * `/` and `/careers` are added by the route, which knows the site; this knows the
 * roles. An undated role is skipped here as well as in `partitionByDate` — the
 * writers stay total so no caller can build a broken artifact by handing them the
 * raw board.
 */
export function sitemapEntries(jobs: PublicJob[], baseUrl: string): SitemapEntry[] {
  const base = origin(baseUrl);
  const entries: SitemapEntry[] = [];
  for (const job of jobs) {
    const lastModified = dateOf(job);
    if (!lastModified) continue;
    entries.push({
      url: `${base}/careers/${job.id}`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }
  return entries;
}
```

- [ ] **Step 4: Add the CSV writer**

Append to the same file:

```ts
/**
 * One RFC 4180 field: always quoted, internal quotes doubled.
 *
 * A role's description is free text a recruiter typed, so commas and newlines are
 * ordinary. Quoting every field rather than the ones that need it means the rule
 * has no branch to get wrong.
 */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

const CSV_HEADER = [
  "title",
  "company",
  "location",
  "job_type",
  "department",
  "sector",
  "description",
  "requirements",
  "date_posted",
  "url",
];

/**
 * The hand-off file a recruiter uploads to a named board.
 *
 * There is no salary column, for the same reason there is no `baseSalary`: the
 * period is unrecorded, and a board's upload form will ask for it — the recruiter
 * answers that, explicitly, on the board. `job_type` carries the stored code
 * rather than a rendered label, because the board has its own vocabulary and the
 * record's own words are the honest thing to hand over. This is a hand-off, not
 * automation, and the CSV says so by carrying nothing a board has to be told.
 */
export function jobsCsv(jobs: PublicJob[], baseUrl: string): string {
  const base = origin(baseUrl);
  const rows = jobs
    .map((job) => {
      const posted = dateOf(job);
      if (!posted) return null;
      return [
        job.title,
        job.company_name ?? "",
        job.location,
        job.employment_type,
        job.department,
        job.sector,
        job.description,
        job.requirements.join("; "),
        posted,
        `${base}/careers/${job.id}`,
      ]
        .map((field) => csvField(field ?? ""))
        .join(",");
    })
    .filter((row): row is string => row !== null);

  return [CSV_HEADER.join(","), ...rows].join("\n");
}
```

- [ ] **Step 5: Run the proof and the gates**

Run: `node scripts/prove-job-distribution.mjs` → all sections pass
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0
Run: `npm run lint` → clean apart from the two tolerated warnings

- [ ] **Step 6: Prove the CSV quoting pin bites**

Temporarily change `csvField` to `const csvField = (value: string): string => \`"\${value}"\`;` (no doubling), run the script, confirm `an internal quote is doubled, not escaped with a backslash` fails, and restore the original line exactly. Name the failing check in the report.

- [ ] **Step 7: Commit**

```bash
git add src/modules/careers/job-distribution.ts scripts/prove-job-distribution.mjs
git commit -m "$(cat <<'EOF'
feat(careers): write the sitemap entries and the board-upload CSV

Both are a function of the published roles and the app's own base URL, so the
routes can stay thin and the rules can be proved against fixtures. The CSV
quotes every field rather than the ones that need it — a recruiter's free-text
description makes commas and newlines ordinary — and carries no salary column
because the period is unrecorded and the board will ask for it.
EOF
)"
```

---

### Task 5: `job-distribution.ts` — the RSS feed

XML has more ways to break than CSV, and the description is the least controlled text in the database.

**Files:**
- Modify: `src/modules/careers/job-distribution.ts`
- Modify: `scripts/prove-job-distribution.mjs` (append section 5)

**Interfaces:**
- Consumes: `partitionByDate`, `dateOf`, `origin` from Tasks 2 and 4.
- Produces: `rssFeed(jobs: PublicJob[], options: { baseUrl: string; title: string; link?: string; description?: string; publishedAt?: string }): string`. Task 9's route is the only caller.

- [ ] **Step 1: Write the failing checks**

Append above the final `if (failures.length > 0)`:

```js
// ---------------------------------------------------------------------------
// 5. The feed: XML the recruiter's description cannot break.
// ---------------------------------------------------------------------------
const { rssFeed } = await import(
  pathToFileURL(path.join(root, "src/modules/careers/job-distribution.ts")).href
);

const feed = rssFeed([role()], {
  baseUrl: "https://careers.example",
  title: "Sharm Dreams Group",
  link: "https://careers.example/careers",
  description: "Open roles with the Sharm Dreams Group.",
  publishedAt: "2026-10-01T00:00:00.000Z",
});
check("it is a declaration, then an RSS 2.0 document", feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">'));
check("the channel names the group", feed.includes("<title>Sharm Dreams Group</title>"));
check("the channel links the board", feed.includes("<link>https://careers.example/careers</link>"));
check("one item per published role", (feed.match(/<item>/g) ?? []).length === 1);
check("the item's guid is its canonical url as a permalink", feed.includes(`<guid isPermaLink="true">https://careers.example/careers/${role().id}</guid>`));
check("the item links the canonical page", feed.includes(`<link>https://careers.example/careers/${role().id}</link>`));
check("pubDate is the RFC 822 form of the posted day", feed.includes("<pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate>"));
check("the channel's lastBuildDate is the newest item's date", feed.includes("<lastBuildDate>Thu, 01 Oct 2026 00:00:00 GMT</lastBuildDate>"));
check("it closes every tag it opened", feed.trimEnd().endsWith("</channel>\n</rss>"));

const hostile = rssFeed(
  [
    role({
      id: "3f2a1b00-0000-4000-8000-000000000002",
      title: 'Salt & Pepper <b>"bold"</b>',
      description: "]]> ends a CDATA section; <tag> does not survive escaping",
    }),
  ],
  { baseUrl: "https://careers.example", title: "Group & Co", publishedAt: "2026-10-01T00:00:00.000Z" }
);
check("an ampersand in text is escaped", hostile.includes("Salt &amp; Pepper"));
check("angle brackets in text are escaped", hostile.includes('&lt;b&gt;"bold"&lt;/b&gt;'));
check(
  "a quote in text stays a quote, because a text node needs no escaping of it",
  hostile.includes("&lt;b&gt;&quot;") === false
);
check("a CDATA terminator in a description is inert", hostile.includes("]]&gt;"));
check("CDATA is not used at all", !hostile.includes("<![CDATA["));
check(
  "a channel title is escaped too",
  hostile.includes("<title>Group &amp; Co</title>")
);
check(
  "an undated role makes no item",
  rssFeed([role({ posted_at: null, created_at: "" })], {
    baseUrl: "https://careers.example",
    title: "Group",
    publishedAt: "2026-10-01T00:00:00.000Z",
  }).includes("<item>") === false
);
const empty = rssFeed([], { baseUrl: "https://careers.example", title: "Group", publishedAt: "2026-10-01T00:00:00.000Z" });
check("no roles is still a valid channel", empty.includes("<channel>") && empty.includes("</channel>") && !empty.includes("<item>"));
check(
  "the feed's own default link is the board on the base url",
  rssFeed([], { baseUrl: "https://careers.example/", title: "Group", publishedAt: "2026-10-01T00:00:00.000Z" }).includes(
    "<link>https://careers.example/careers</link>"
  )
);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/prove-job-distribution.mjs`
Expected: `rssFeed` is not a function / the import destructures `undefined`.

- [ ] **Step 3: Write the feed**

Append to `src/modules/careers/job-distribution.ts`:

```ts
/**
 * Text, escaped in the one order that works: the ampersand first.
 *
 * Quotes are deliberately left alone. A text node has no delimiter to close
 * early, so `"` carries no meaning here — escaping it would only make the title
 * harder for a human reader of the feed to recognise. The one attribute this
 * module writes is the literal `isPermaLink="true"`, so no role text ever lands
 * where a quote could break it; if the feed gains an attribute that carries a
 * role's words, that value needs its own escaper that adds `"` to `&`, `<`, `>`.
 */
function xmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * RFC 822, the form RSS 2.0 expects.
 *
 * `toUTCString` gives `Thu, 01 Oct 2026 00:00:00 GMT`. An unparseable date from a
 * free-text column returns "" and the caller leaves the element out rather than
 * publishing an epoch nobody meant.
 */
function rfc822(iso: string | null | undefined): string {
  if (!iso) return "";
  const asDate = new Date(iso);
  return Number.isNaN(asDate.getTime()) ? "" : asDate.toUTCString();
}

/**
 * The board as an RSS 2.0 feed, for anyone who aggregates rather than crawls.
 *
 * Text is escaped rather than wrapped in CDATA: a description containing `]]>`
 * would end the section early, and escaping is not hard. The channel title is
 * supplied by the route because it is the group's own name, not something the
 * roles carry.
 */
export function rssFeed(
  jobs: PublicJob[],
  options: {
    baseUrl: string;
    title: string;
    link?: string;
    description?: string;
    publishedAt?: string;
  }
): string {
  const base = origin(options.baseUrl);
  const board = options.link ?? `${base}/careers`;
  const items: string[] = [];

  for (const job of jobs) {
    const posted = dateOf(job);
    if (!posted) continue;
    const url = `${base}/careers/${job.id}`;
    const pubDate = rfc822(posted);
    items.push(
      [
        "    <item>",
        `      <title>${xmlText(job.title)}</title>`,
        `      <link>${xmlText(url)}</link>`,
        `      <guid isPermaLink="true">${xmlText(url)}</guid>`,
        `      <description>${xmlText(job.description)}</description>`,
        ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
        "    </item>",
      ].join("\n")
    );
  }

  // The newest item's date, because a feed that claims a build time before its
  // own newest entry is a feed a reader assumes is stale.
  const newest = items.length > 0
    ? rfc822(jobs.map(dateOf).filter((d): d is string => Boolean(d)).sort().reverse()[0])
    : "";
  const build = newest || rfc822(options.publishedAt);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${xmlText(options.title)}</title>`,
    `    <link>${xmlText(board)}</link>`,
    `    <description>${xmlText(options.description ?? `Open roles with ${options.title}.`)}</description>`,
    ...(build ? [`    <lastBuildDate>${build}</lastBuildDate>`] : []),
    ...items,
    "  </channel>",
    "</rss>",
  ].join("\n");
}
```

- [ ] **Step 4: Run the proof and the gates**

Run: `node scripts/prove-job-distribution.mjs` → all sections pass. If `the feed's own default link is the board on the base url` fails, the `board` line was placed after `origin()` was dropped — fix it, do not weaken the check.
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0
Run: `npm run lint` → clean apart from the two tolerated warnings

- [ ] **Step 5: Prove the escaping pin bites in three directions**

Three directions, because CDATA is the tempting shortcut and quote-escaping is the tempting over-correction.

1. Temporarily wrap the description in a CDATA section (`` `<description><![CDATA[${job.description}]]></description>` ``) and run. Confirm `a CDATA terminator in a description is inert` and `CDATA is not used at all` both fail. Restore.
2. Temporarily change `xmlText` to return `value` unchanged and run. Confirm `an ampersand in text is escaped` and `angle brackets in text are escaped` both fail. Restore.
3. Temporarily add `.replace(/"/g, "&quot;")` to `xmlText` and run. Confirm `a quote in text stays a quote, because a text node needs no escaping of it` fails. Restore.

List the five failing check names in the report.

- [ ] **Step 6: Commit**

```bash
git add src/modules/careers/job-distribution.ts scripts/prove-job-distribution.mjs
git commit -m "$(cat <<'EOF'
feat(careers): write the board as an RSS 2.0 feed

A recruiter with no crawler can hand a feed URL to an aggregator, and a
description a recruiter typed is the least controlled text in the database. So
text is escaped rather than wrapped in CDATA — a description containing the CDATA
terminator would end the section early — and lastBuildDate is the newest item's
own date, because a feed claiming a build before its newest entry reads as stale.
EOF
)"
```

---

### Task 6: Surface (a) — the JobPosting on the role page

The page already reads the role, the board and the companies; it now says who the employer is in a language a crawler reads.

**Files:**
- Modify: `src/app/careers/[id]/page.tsx` (imports at `:1-23`, the component body at `:222-247`)
- Modify: `scripts/prove-job-distribution.mjs` (append section 6)

**Interfaces:**
- Consumes: `jobPosting`, `jobPostingJsonLd` from `job-posting.ts`; `company` and `companies` already in scope at `:232`; `appConfig.url`.
- Produces: one `<script type="application/ld+json">` on a published role page.

- [ ] **Step 1: Write the failing pins**

Append above the final `if (failures.length > 0)`:

```js
// ---------------------------------------------------------------------------
// 6. The five doors: each surface calls the module, and writes no rules of its own.
// ---------------------------------------------------------------------------
sourceHas("the role page emits JobPosting JSON-LD", "src/app/careers/[id]/page.tsx", [
  'type="application/ld+json"',
  "dangerouslySetInnerHTML={{ __html: jobPostingJsonLd(posting) }}",
  "jobPosting(job, company",
  "appConfig.url",
]);
check(
  "the page leaves the tag out when the role cannot be dated",
  read("src/app/careers/[id]/page.tsx").includes("{posting && (")
);
check(
  "the page does not write its own employer rule",
  !read("src/app/careers/[id]/page.tsx").includes("hiringOrganization")
);
check(
  "the page does not re-stringify the posting itself",
  !read("src/app/careers/[id]/page.tsx").includes("JSON.stringify")
);
```

- [ ] **Step 2: Run and watch it fail**

Run: `node scripts/prove-job-distribution.mjs`
Expected: exit 1 with `the role page emits JobPosting JSON-LD` failing on all four needles.

- [ ] **Step 3: Import the two functions**

In `src/app/careers/[id]/page.tsx`, beside the existing careers imports (`:12-20`):

```ts
import { appConfig } from "@/lib/config";
import { jobPosting, jobPostingJsonLd } from "@/modules/careers/job-posting";
```

`groupProfile` and `companyOfJob` are already imported from `company-profile.ts` at `:14-15` — reuse them, do not re-import.

- [ ] **Step 4: Build the posting once, next to the company it describes**

In `CareerDetailPage`, immediately after `const company = companyOfJob(job, companies);` (currently `:232`):

```ts
  // The structured card a crawler reads. The group name comes from the group's
  // own profile row when one is active; the module owns the literal fallback, so
  // the page does not restate it. An undated role gets no card at all — the page
  // still renders, the role simply carries no structured claim it cannot date.
  const posting = jobPosting(job, company, {
    baseUrl: appConfig.url,
    groupName: groupProfile(companies)?.name,
  });
  if (!posting) {
    console.warn(`[careers] role without a date is not published: ${job.id}`);
  }
```

- [ ] **Step 5: Render it**

As the first child of the outer `<div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">` (currently `:248`), before the "all roles" back link:

```tsx
      {posting && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jobPostingJsonLd(posting) }}
        />
      )}
```

- [ ] **Step 6: Run the proof and the gates**

Run: `node scripts/prove-job-distribution.mjs` → all sections pass
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0
Run: `npm run lint` → clean apart from the two tolerated warnings

- [ ] **Step 7: Prove the page is still a page**

The script tag is inert markup, so a browser proof adds nothing a source pin cannot catch — and opening a live role page through a second dev server would conflict with the user's running one. Instead confirm, from the diff, that the render branch cannot remove any existing element: `{posting && (...)}` wraps only the new `<script>`, and no existing JSX moved. State that in the report. If the owner later asks for a browser proof, the check is one line on the role page's view-source: a single `application/ld+json` script whose `description` parses back to the column's text.

- [ ] **Step 8: Commit**

```bash
git add "src/app/careers/[id]/page.tsx" scripts/prove-job-distribution.mjs
git commit -m "$(cat <<'EOF'
feat(careers): put a JobPosting on the role page

The page already reads the role, the board and the companies, so the card costs
one call into the mapping module. A role that cannot be dated gets no card: the
page still renders, and a structured claim nobody can date is the one thing a
crawler should not be told.
EOF
)"
```

---

### Task 7: Surface (b) — `src/app/sitemap.ts`

**Files:**
- Create: `src/app/sitemap.ts`
- Modify: `scripts/prove-job-distribution.mjs` (extend section 6's pins)

**Interfaces:**
- Consumes: `getPublicJobs()` (the board's cached read), `sitemapEntries`, `partitionByDate`, `appConfig.url`.
- Produces: `GET /sitemap.xml`.

- [ ] **Step 1: Write the failing pins**

Append above the final `if (failures.length > 0)`:

```js
sourceHas("the sitemap is built from the board's own read", "src/app/sitemap.ts", [
  'from "@/app/careers/actions"',
  "getPublicJobs()",
  "sitemapEntries",
  "appConfig.url",
  "await connection()",
  "${base}/careers",
]);
check(
  "the sitemap logs what it had to leave out",
  read("src/app/sitemap.ts").includes("role without a date is not published")
);
check(
  "the sitemap reaches no page a staff member works on",
  !read("src/app/sitemap.ts").includes("(admin)") &&
    !read("src/app/sitemap.ts").includes("/portal") &&
    !read("src/app/sitemap.ts").includes("/api/")
);
```

- [ ] **Step 2: Run and watch it fail**

Run: `node scripts/prove-job-distribution.mjs`
Expected: exit 1 — `no such file or directory, open '.../src/app/sitemap.ts'` from `sourceHas`'s `read`. That is the right failure; the file does not exist yet.

- [ ] **Step 3: Write it**

Create `src/app/sitemap.ts`:

```ts
import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getPublicJobs } from "@/app/careers/actions";
import { appConfig } from "@/lib/config";
import { partitionByDate, sitemapEntries } from "@/modules/careers/job-distribution";

/**
 * Every public URL the site has, and only those.
 *
 * The board's own cached read is the source, so `jobs_public_read` decides what
 * appears — a draft cannot be listed here any more than it can be shown on
 * `/careers`. Nothing from the staff console, the candidate portal or the apply
 * wizard is in this list: they are not public, and a crawler finding them buys
 * nothing but a wasted fetch.
 *
 * It reads the database, so it must not be prerendered: the Docker image builds
 * with no database and no secrets (`.dockerignore` excludes `.env*`), and a
 * `use cache` scope reachable from a prerendered route is executed during the
 * build's cache-warming phase. `await connection()` is the same mechanism, and
 * the same reason, as `src/app/careers/page.tsx`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const jobs = await getPublicJobs();
  const { publishable, undated } = partitionByDate(jobs);
  for (const id of undated) {
    console.warn(`[careers] role without a date is not published: ${id}`);
  }

  const base = appConfig.url.replace(/\/+$/, "");
  const landing = new Date();

  return [
    { url: `${base}/`, lastModified: landing, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/careers`, lastModified: landing, changeFrequency: "daily", priority: 0.9 },
    ...sitemapEntries(publishable, appConfig.url),
  ];
}
```

- [ ] **Step 4: Confirm the return shape against the bundled guide**

Do not trust memory for the Next 16 shape. Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/sitemap.md` and confirm three things before running anything: the default export returns `MetadataRoute.Sitemap`; `changeFrequency` accepts `"daily"` and `"weekly"`; and the route "is cached by default unless it uses a Request-time API". If the guide contradicts any line above, fix the file and say so in the report. Quote the guide's `Returns` block in the report as the evidence you checked.

- [ ] **Step 5: Run the proof and the gates**

Run: `node scripts/prove-job-distribution.mjs` → all sections pass
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0
Run: `npm run lint` → clean apart from the two tolerated warnings

- [ ] **Step 6: Prove the non-prerender pin bites**

Temporarily delete the `await connection();` line, run `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` **and** `node scripts/prove-job-distribution.mjs`, confirm the proof fails on `the sitemap is built from the board's own read`, then restore the line exactly. A sitemap that prerenders bakes a build-time database snapshot (or fails the build with no database); this is the pin that keeps it from silently regressing.

- [ ] **Step 7: Commit**

```bash
git add src/app/sitemap.ts scripts/prove-job-distribution.mjs
git commit -m "$(cat <<'EOF'
feat(careers): publish a sitemap of the open roles

Built from the board's own cached read, so the RLS policy that already keeps a
draft off the public page keeps it out of the sitemap too — not a filter this
file adds. It waits for a request because the image builds with no database, and
a prerendered sitemap would either fail the build or bake the wrong origin.
EOF
)"
```

---

### Task 8: Surface (c) — `src/app/robots.ts`

**Files:**
- Create: `src/app/robots.ts`
- Modify: `scripts/prove-job-distribution.mjs` (extend section 6)

**Interfaces:**
- Consumes: `appConfig.url` only. It reads no database — and that is exactly why it still needs `await connection()`.
- Produces: `GET /robots.txt`.

- [ ] **Step 1: Enumerate what the file must refuse**

The Disallow list must be the real route tree, not a remembered one. Run:

```bash
ls "src/app/(admin)" && ls "src/app/(candidate)" && ls src/app/login && ls src/app/careers/apply
```

Expected: sixteen admin segments (`activity analytics assessments assistant candidates dashboard files interviews jobs onboarding questions reports settings sourcing time whatsapp`), `portal test` under `(candidate)`, `login`, and `[id]` under `careers/apply`. The route group parentheses do not appear in a URL, so `/jobs`, `/candidates` … are the paths. If the listing differs from this list, the list below is wrong — use what the tree says and say so in the report.

- [ ] **Step 2: Write the failing pins**

Append above the final `if (failures.length > 0)`:

```js
sourceHas("the robots file points at the sitemap", "src/app/robots.ts", [
  "await connection()",
  "appConfig.url",
  "/sitemap.xml",
  'allow: "/"',
  'userAgent: "*"',
  '"/careers/apply"',
  '"/api/"',
  '"/login"',
]);
const robotText = read("src/app/robots.ts");
for (const staffPath of [
  "/jobs",
  "/candidates",
  "/settings",
  "/reports",
  "/assessments",
  "/interviews",
  "/activity",
  "/analytics",
  "/assistant",
  "/dashboard",
  "/files",
  "/onboarding",
  "/questions",
  "/sourcing",
  "/time",
  "/whatsapp",
]) {
  check(`the robots file refuses ${staffPath}`, robotText.includes(`"${staffPath}"`));
}
check("and refuses the candidate surfaces", robotText.includes('"/portal"') && robotText.includes('"/test"'));
check(
  "the careers tree is allowed, which is the point of the file",
  !robotText.includes('"/careers"')
);
```

- [ ] **Step 3: Run and watch it fail**

Run: `node scripts/prove-job-distribution.mjs`
Expected: exit 1, `no such file or directory, open '.../src/app/robots.ts'`.

- [ ] **Step 4: Write it**

Create `src/app/robots.ts`:

```ts
import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { appConfig } from "@/lib/config";

/**
 * The paths a crawler is asked to skip.
 *
 * These pages are already behind the staff route guard, so this is about crawler
 * budget, not access: the staff console is a wall of post-login redirects, the
 * candidate portal is the same for a stranger, and the apply wizard has nothing a
 * public index should hold. The careers tree is deliberately absent — it is the
 * reason the file exists.
 */
const DISALLOW = [
  "/jobs",
  "/candidates",
  "/settings",
  "/reports",
  "/assessments",
  "/interviews",
  "/activity",
  "/analytics",
  "/assistant",
  "/dashboard",
  "/files",
  "/onboarding",
  "/questions",
  "/sourcing",
  "/time",
  "/whatsapp",
  "/portal",
  "/test",
  "/login",
  "/api/",
  "/careers/apply",
];

/**
 * `Sitemap:` points at the deployment's own origin.
 *
 * The file reads no database, but it reads `APP_URL` — and the image is built
 * with no `.env*` (`.dockerignore`), so a prerendered robots.txt would bake the
 * *default* origin into its sitemap pointer and never see the deployment's own.
 * The file is a dozen lines; the cost of getting that pointer wrong is a crawler
 * that never finds the sitemap. So it waits for a request, like the sitemap does.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return {
    rules: { userAgent: "*", allow: "/", disallow: DISALLOW },
    sitemap: `${appConfig.url.replace(/\/+$/, "")}/sitemap.xml`,
  };
}
```

- [ ] **Step 5: Confirm the return shape against the bundled guide**

Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/robots.md` and confirm: `MetadataRoute.Robots` is `{ rules, sitemap?, host? }`; a rule's `allow`/`disallow` accept `string | string[]`; and the file "is cached by default unless it uses a Request-time API". Quote the `Robots object` type block in the report.

- [ ] **Step 6: Run the proof and the gates**

Run: `node scripts/prove-job-distribution.mjs` → all sections pass
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0
Run: `npm run lint` → clean apart from the two tolerated warnings

- [ ] **Step 7: Prove the careers tree is not refused**

The last check (`the careers tree is allowed`) asserts `"/careers"` is absent as a quoted string. Confirm by reading the file that `"/careers/apply"` is present and `/careers` is not, so the apply wizard is refused without refusing the board. State in the report that a prefix rule cannot distinguish them, and `/careers/apply` is the narrower prefix that does.

- [ ] **Step 8: Commit**

```bash
git add src/app/robots.ts scripts/prove-job-distribution.mjs
git commit -m "$(cat <<'EOF'
feat(careers): add a robots file that points crawlers at the sitemap

The staff console and both candidate surfaces are refused for crawler budget,
not access — they are already behind the route guard. The file waits for a
request because the image is built with no env file, and a prerendered robots
would bake the default origin into its Sitemap: line and never show a deployment
its own.
EOF
)"
```

---

### Task 9: Surfaces (d) and (e) — the feed and the export routes

Both are a read, one call into a reviewed module, and a content type. They ship together because a reviewer would accept one and reject the neighbour on nothing but a header.

**Files:**
- Create: `src/app/api/careers/feed.xml/route.ts`
- Create: `src/app/api/careers/jobs.csv/route.ts`
- Modify: `scripts/prove-job-distribution.mjs` (extend section 6)

**Interfaces:**
- Consumes: `getPublicJobs()`, `getPublicCompanies()`, `groupProfile()`, `rssFeed`, `jobsCsv`, `partitionByDate`, `appConfig.url`, `GROUP_NAME`.
- Produces: `GET /api/careers/feed.xml` (`application/rss+xml`), `GET /api/careers/jobs.csv` (`text/csv`).

- [ ] **Step 1: Write the failing pins**

Append above the final `if (failures.length > 0)`:

```js
sourceHas("the feed route serves RSS", "src/app/api/careers/feed.xml/route.ts", [
  'await connection()',
  "rssFeed(",
  'application/rss+xml',
  'Cache-Control": "no-store"',
  "groupProfile(companies)",
  "${base}/careers",
]);
sourceHas("the export route serves CSV", "src/app/api/careers/jobs.csv/route.ts", [
  'await connection()',
  "jobsCsv(",
  'text/csv',
  'attachment; filename="sharm-dreams-openings.csv"',
]);
for (const rel of ["src/app/api/careers/feed.xml/route.ts", "src/app/api/careers/jobs.csv/route.ts"]) {
  const text = read(rel);
  // The route may normalise a trailing slash; what it must never do is escape,
  // because re-escaping what the module already escaped double-encodes every
  // ampersand in a role description.
  check(`${rel} writes no escaping of its own`, !/&amp;|&lt;|&quot;|CDATA|JSON\.stringify/.test(text));
  check(`${rel} reads only the board's own published read`, text.includes("getPublicJobs()"));
  check(`${rel} logs an undated role`, text.includes("role without a date is not published"));
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `node scripts/prove-job-distribution.mjs`
Expected: exit 1 on both `sourceHas` calls (files absent).

- [ ] **Step 3: Write the RSS route**

Create `src/app/api/careers/feed.xml/route.ts`:

```ts
import { connection } from "next/server";
import { getPublicCompanies, getPublicJobs } from "@/app/careers/actions";
import { groupProfile } from "@/modules/careers/company-profile";
import { GROUP_NAME } from "@/modules/careers/job-posting";
import { partitionByDate, rssFeed } from "@/modules/careers/job-distribution";
import { appConfig } from "@/lib/config";

/**
 * The board as a feed, for anyone who aggregates rather than crawls.
 *
 * Under `/api/careers/` because that is where the careers API already lives, and
 * because a folder named `feed.xml` inside `src/app/careers/` would sit beside the
 * `[id]` dynamic segment and read like one.
 *
 * Not prerendered, for the sitemap's reason: the image builds with no database,
 * so `await connection()` is what keeps a feed of live roles from being baked at
 * build time. `no-store` because a recruiter who hands this URL to an aggregator
 * will re-fetch it, and a day-stale copy of a closed role is worse than a
 * re-read.
 */
export async function GET(): Promise<Response> {
  await connection();
  const [jobs, companies] = await Promise.all([getPublicJobs(), getPublicCompanies()]);
  const { publishable, undated } = partitionByDate(jobs);
  for (const id of undated) {
    console.warn(`[careers] role without a date is not published: ${id}`);
  }

  const title = groupProfile(companies)?.name ?? GROUP_NAME;
  const base = appConfig.url.replace(/\/+$/, "");
  const body = rssFeed(publishable, {
    baseUrl: appConfig.url,
    title,
    link: `${base}/careers`,
    description: `Open roles with ${title}.`,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 4: Write the CSV route**

Create `src/app/api/careers/jobs.csv/route.ts`:

```ts
import { connection } from "next/server";
import { getPublicJobs } from "@/app/careers/actions";
import { partitionByDate, jobsCsv } from "@/modules/careers/job-distribution";
import { appConfig } from "@/lib/config";

/**
 * The hand-off file a recruiter uploads to a named board.
 *
 * This is the only credential-free route onto a board the platform has no account
 * with, and it is a hand-off, not automation: someone downloads it, uploads it,
 * and answers the questions the record cannot — the salary period among them.
 *
 * Reads the same published rows as the board, so a draft cannot be exported; the
 * database, not this file, is what decides. `await connection()` for the
 * build-time reason the sitemap gives.
 */
export async function GET(): Promise<Response> {
  await connection();
  const jobs = await getPublicJobs();
  const { publishable, undated } = partitionByDate(jobs);
  for (const id of undated) {
    console.warn(`[careers] role without a date is not published: ${id}`);
  }

  return new Response(jobsCsv(publishable, appConfig.url), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sharm-dreams-openings.csv"',
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 5: Run the proof and the gates**

Run: `node scripts/prove-job-distribution.mjs` → all sections pass
Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0
Run: `npm run lint` → clean apart from the two tolerated warnings

- [ ] **Step 6: Prove the escaping pin bites**

The per-route check forbids any escape sequence in a route. Temporarily change the feed route's response line to `new Response(body.replace(/&/g, "&amp;"), {` — a plausible double-escape a well-meaning fix would introduce — run the proof, confirm `src/app/api/careers/feed.xml/route.ts writes no escaping of its own` fails, restore the exact original line, and re-run to green. Name the failing check in the report.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/careers/feed.xml/route.ts src/app/api/careers/jobs.csv/route.ts scripts/prove-job-distribution.mjs
git commit -m "$(cat <<'EOF'
feat(careers): serve the feed and the board-upload export

Both routes read, call one reviewed module and set a content type — they write
no escaping of their own, because a route that re-escapes a feed double-encodes
every ampersand in a role description. The CSV is the only credential-free way
onto a board this platform has no account with, and it says so in its own comment.
EOF
)"
```

---

### Task 10: Whole-slice gate — the live read, the status line, every proof green

Nothing is edited in this task except the proof script and the spec's `Status:` line. It exists so the slice's own claim — "these five surfaces answer, on the database the app actually runs against" — is demonstrated rather than inferred from unit tests.

**Files:**
- Modify: `scripts/prove-job-distribution.mjs` (append section 7, the read-only live check)
- Modify: `docs/superpowers/specs/2026-10-24-job-distribution-design.md` (its `Status:` line only)

**Interfaces:**
- Consumes: everything Tasks 1-9 produced.
- Produces: the slice's acceptance record.

- [ ] **Step 1: Append the read-only live check**

The live half runs only when the local stack answers, and it reads only. Copy the reachability probe and the anon-REST read from `scripts/prove-local-stack.mjs` — read that file for how it reaches PostgREST and what it does when the stack is down; do not invent a second way.

Append above the final `if (failures.length > 0)`:

```js
// ---------------------------------------------------------------------------
// 7. The live read: the same rows the board publishes, in all five formats.
//    Skipped, not failed, when the local stack is not answering.
// ---------------------------------------------------------------------------
const stack = await stackIsReachable(); // copied from prove-local-stack.mjs's probe
if (!stack.reachable) {
  console.log(`(skipping the live read: ${stack.reason})`);
} else {
  // An anonymous read through the same policy every surface uses. No writes.
  const rows = await readPublishedOpenings(stack); // copied shape: select id, posted_at, created_at
  check("the public read returns rows the board can publish", Array.isArray(rows));
  const dated = rows.filter((row) => row.posted_at || row.created_at);
  check(
    "every published row can be dated, so no role is silently missing from a surface",
    dated.length === rows.length,
    `${rows.length - dated.length} published row(s) have neither posted_at nor created_at — they will be absent from all five surfaces`
  );
  check(
    "the widened read still shapes a PublicJob the domain accepts",
    rows.length === 0 || jobPosting(rows[0], null, { baseUrl: "http://localhost:3000" }) !== null
  );
}
```

Two rules for this section, and both are the point of it:

- **Read-only.** No insert, no update, no delete, no `service_role` key. Local data is real data.
- **Skip, never fail, on unreachability.** A developer running the proof without the stack up must get `NNN checks passed`, not a red suite. A *failure* in this section means the widened column list is wrong, which is the one thing Task 1's green `tsc` could not prove.

- [ ] **Step 2: Run the proof**

Run: `node scripts/prove-job-distribution.mjs`
Expected: `NNN checks passed`, with either the live checks run or a single `(skipping the live read: …)` line. Report which of the two happened, in those words — do not describe a skipped check as a passed one.

- [ ] **Step 3: Run every other proof that this slice could have broken**

The read change is the only edit with reach beyond the careers tree. Run all of them and report each count:

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && npm run lint
for s in prove-coding-question prove-situational prove-guide-figures prove-scoring-rubric prove-job-distribution; do
  node "scripts/$s.mjs" || echo "FAILED: $s"
done
node scripts/prove-local-stack.mjs
node scripts/audit-secrets.mjs
```

Expected: every one green (or, for the live ones, skipped with a stated reason). `audit-secrets.mjs` runs because this slice adds new public surfaces. A script in that list that does not exist by that exact name is a plan error, not a test failure — find its real name with `ls scripts/` and report the substitution rather than dropping the check.

- [ ] **Step 4: Confirm no surface leaks a private row**

The claim is "nothing new is public". Prove it against the policy, not the code:

Run: `grep -n "jobs_public_read" db/schema.sql` and read the policy text. Then confirm in the report, quoting the policy's own predicate, that it exposes `status = 'PUBLISHED'` only — which is what makes the sitemap, the feed, the CSV and the JSON-LD card private-by-construction, since all four read through the anon client.

- [ ] **Step 5: Update the spec's status line**

In `docs/superpowers/specs/2026-10-24-job-distribution-design.md`, replace the `Status:` line with one that names this plan and says the slice is built. Nothing else in the spec changes — it is a historical record of an approved design, and its content stays exactly as approved.

- [ ] **Step 6: Commit**

```bash
git add scripts/prove-job-distribution.mjs docs/superpowers/specs/2026-10-24-job-distribution-design.md
git commit -m "$(cat <<'EOF'
test(careers): prove the five distribution surfaces read the real board

The widened column list is the one part of this slice that a green typecheck
cannot vouch for, so the proof's last section reads published openings through
the same anonymous policy every surface uses — and skips, rather than failing,
when the stack is not answering.
EOF
)"
```

---

## Self-review record

**Spec coverage.** §1 two pure modules → Tasks 2-5 (both files, exact signatures). §2 mapping rules → Task 2 (dates, employer chain, identifier, url, directApply, validThrough) and Task 3 (employment vocabulary, remote/TELECOMMUTE, applicantLocationRequirements, `baseSalary` omitted, Egypt as a constant). §3 five surfaces → Tasks 6 (a), 7 (b), 8 (c), 9 (d, e). §4 the one read change → Task 1. §5 safety → Task 3 Step 7 (escape bites), Task 9 Step 6 (no double-escape), Task 10 Step 4 (RLS is the guarantee). §6 failure behaviour → the `null` posting in Task 2, the log line in Tasks 6-9, and the `dated.length === rows.length` check in Task 10. The proof (§ "Proof") → the whole script, grown one section per task, with a two-sided bite check in Tasks 3, 4, 5, 6, 7, 8 and 9. Two spec lines are met by a recorded deviation rather than by code: the employer chain gains `job.company_name` (item 1) and §3(d)'s attribute-escaping clause has no attribute to apply to (item 4).

**Placeholder scan.** No TBD/"similar to Task N"/"add appropriate error handling". Every code step carries the code. Two steps instruct reading a sibling file for an existing pattern rather than restating it (`prove-coding-question.mjs:1-53` for the harness, `prove-local-stack.mjs` for the reachability probe) — those name the exact lines to copy, which is a citation, not a placeholder.

**Type consistency.** `dateOf(job): string | null`, `jobPosting(job, company, options): JobPosting | null`, `jobPostingJsonLd(posting): string`, `partitionByDate(jobs): { publishable, undated }`, `sitemapEntries(jobs, baseUrl): SitemapEntry[]`, `jobsCsv(jobs, baseUrl): string`, `rssFeed(jobs, options): string`, `GROUP_NAME: string` — each is declared in the task that creates it and used with the same name and shape in every later task. `SitemapEntry.changeFrequency` is `"daily" | "weekly"` throughout, and both literals appear only as those two. `PublicJob.posted_at` is `string | null`, `created_at` is `string`, `closing_at` is `string | null` in Task 1's interface, Task 1's `toJob`, and Task 2's fixtures alike. `Place` and `Country` are declared once, in Task 2, and are the types Task 3's `placeValue` returns and the `JobPosting` fields carry.

**The Tasks 2-5 code was executed, not just read.** The plan's two modules and every fixture check in Tasks 2-5 were run as a standalone prototype (`node`, strict `tsc` clean): 86 checks, 0 failures. That is what found the four defects corrected here — the `&quot;` expectation that XML text escaping rightly does not meet, the attribute escaper with no caller, `.filter(Boolean)` where the narrowed predicate is the honest one, and a "nine columns" label on a ten-column header. Tasks 1 and 6-10 are pinned against files read in place (the `JOB_COLUMNS` literal, `[id]/page.tsx`, `sitemap.ts`/`robots.ts` absent, the existing proof scripts present) but not executed end-to-end, because they need the app and the stack.

**Open risk a reviewer should judge, not fix silently.** `placeOf` returns the recruiter's whole `location` string as `addressLocality`, including the word "Remote" when the text also names a place ("Cairo / Remote"). That is deliberate — the column is free text and re-spelling it invents an address — but it does mean a locality can read oddly. If the owner prefers the place words only, the fix is inside `placeOf`, and the `a remote role that also names a real place keeps the hiring office` check is the one that changes.
