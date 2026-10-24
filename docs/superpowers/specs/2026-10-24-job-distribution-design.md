# Job distribution to external boards

**Date:** 2026-10-24
**Status:** Approved design — implementation plan not yet written
**Scope:** one slice — publish the platform's open roles in the formats external boards and crawlers can read, without credentials, without a new table, and without touching the candidate portal

---

## Why

The platform already runs a public careers board: anonymous visitors read the
published openings, filter them, open a role, and apply. What that board cannot
do is be *found* by anyone outside it. There is no structured data on a role
page, no sitemap, no robots file, and no feed — a search engine or an aggregator
sees a link and a wall of text, and a recruiter who wants a role on a named
board has nothing to hand over but a browser tab.

The competitor research that started this feature asked one question: what does
a recruitment platform do with its openings once they exist? The honest answer
here is that the platform holds every field a posting needs and emits none of
them. The gap is not the data; it is the emission.

This slice closes the emission gap. It does not invent a channel the platform
has no right to use — see *The constraint that decides the slice*.

---

## What the platform already has

| Fact | Where |
| --- | --- |
| `job_openings` carries title, department, sector, location, employment type, description, requirements, salary bounds, currency, `posted_at`, `closing_at`, `created_at`, `status` | `db/schema.sql:412` |
| `job_status` is DRAFT / PUBLISHED / PAUSED / CLOSED | `db/schema.sql:84` |
| The public board reads exactly the PUBLISHED rows, anonymously, under RLS | `db/schema.sql:1629` (`jobs_public_read`) |
| The public read is already cached (`use cache` + `cacheLife("minutes")`) and a draft 404s by direct URL | `src/app/careers/actions.ts:153`, `src/app/careers/actions.ts:209` |
| One role page per opening, public, with its own metadata | `src/app/careers/[id]/page.tsx:37` |
| `posted_at` is stamped on the first publication and never removed | `src/app/(admin)/jobs/job-actions.ts:466`, `src/app/(admin)/jobs/job-actions.ts:525` |
| A company profile per hiring company, with name, legal name, website | `src/modules/careers/company-profile.ts:38` (`PublicCompany`) |
| `tenants_and_companies.country` defaults to `Egypt` | `db/schema.sql:648` |
| One public base URL for the whole app | `src/lib/config.ts:39` (`appConfig.url`, from `APP_URL`) |
| Next's own JSON-LD recipe: `JSON.stringify(...).replace(/</g, '\\u003c')` inside `<script type="application/ld+json">` | `node_modules/next/dist/docs/01-app/02-guides/json-ld.md:31` |

## What the platform does not have

- No `robots.txt`, no `sitemap.xml`, no JSON-LD, no `application/ld+json`
  anywhere in `src/` — a search over the tree finds none of them.
- No outbound connector. `ats_integrations` (`db/schema.sql:284`) holds
  GREENHOUSE / LEVER / FRAPPE_HR / LINKEDIN_APPLY, and every one of them is
  **inbound**: they describe where a record came from, and there is no importer
  in `src/` either. Nothing in the platform can push a role anywhere.
- No board account, no API key, no feed URL for any named board.

## The constraint that decides the slice

Google's `JobPosting` structured data is not deprecated and is still the route
into Google Jobs — but **there is no Google Jobs API**. Google has to crawl the
page. The Indexing API can ping a URL, but it needs a Search Console key, and
Google's own documentation points at the Indexing API or a third party, not at
a posting endpoint.

So the only distribution the platform can honestly build today is the one that
needs no credential: **structured output a crawler can read, plus a pull feed a
recruiter can hand over, plus a file a recruiter can upload.** Anything that
pushes needs an account the platform does not have, and building a push
connector against a credential that does not exist would be a feature that
cannot be run, tested, or proven.

---

## Approaches considered

### A — Structured output (chosen)

`JobPosting` JSON-LD on each role page, a sitemap, a robots file, an RSS feed
of published openings, and a CSV of the same openings.

- One module, no migration, no new state, no credentials, no new dependency.
- Google's required properties map onto columns that already exist.
- Everything is provable offline against fixtures.
- The limit: Google crawls rather than being pushed, so a role appears when
  Google next visits the page. That is how Google Jobs works for everyone
  without an API.

### B — A distribution console (deferred)

A per-role channel picker and a publish log, so a recruiter chooses boards and
sees what went where.

- Needs a table for the publish log — an authored-but-unapplied migration, the
  same pattern the platform already uses for other unapplied work.
- Needs a board account per channel before it has anything to show; until then
  the console is a picker with no destination.
- The right second slice, once a board account exists. This slice is the
  substrate it would sit on.

### C — CSV only (deferred)

A recruiter uploads a file to Indeed or LinkedIn by hand.

- Cheapest of the three, and it is included in A as one of the five surfaces —
  but on its own it has to be re-exported and re-uploaded by hand every time a
  role changes, which is the work A's crawl-based surfaces do not need.

### The decision

**A now; B and C deferred.** A is the slice that can be built, shipped and
proved without a credential, a new table, or a dependency. B becomes worth
building the moment a board account exists, and A is what it would push.

---

## The design

### 1. Two pure domain modules

Both live under `src/modules/careers/`, neither imports React or `next`, and
neither performs I/O. Every one of them is a function of its arguments, which
is what lets the proof script exercise them against fixtures with no database.

**`src/modules/careers/job-posting.ts`** — the schema.org mapping.

```ts
import type { PublicJob } from "@/modules/careers/job-board";
import type { PublicCompany } from "@/modules/careers/company-profile";

export interface JobPosting {
  "@context": "https://schema.org";
  "@type": "JobPosting";
  title: string;
  description: string;
  datePosted: string;
  hiringOrganization: { "@type": "Organization"; name: string; legalName?: string; sameAs?: string };
  url: string;
  identifier: { "@type": "PropertyValue"; name: string; value: string };
  directApply: boolean;
  employmentType?: string;
  jobLocation?: unknown[];
  jobLocationType?: string;
  applicantLocationRequirements?: unknown[];
  validThrough?: string;
}

/** The one date rule: the day it went public, else the day the row was made. */
export function dateOf(job: PublicJob): string | null;

export function jobPosting(
  job: PublicJob,
  company: PublicCompany | null,
  options: { baseUrl: string; groupName?: string }
): JobPosting | null;

export function jobPostingJsonLd(posting: JobPosting): string;
```

Both imports are **type-only**, so the module has no runtime dependency on
`job-board.ts` or `company-profile.ts` — and the proof script can import it
without pulling the board's vocabularies and dictionaries in behind it.

`jobPosting` returns `null` when the record cannot make a valid posting — the
one case is a role with no derivable date, because `datePosted` is required.
Returning `null` rather than a half-built object means every caller has to
decide what to do with it, and the decision is stated once: a role with no date
is not published to the world. `dateOf` is the single place the date rule
lives; the feed, the sitemap and the CSV all ask it rather than each deciding
for itself.

`jobPostingJsonLd` returns the exact string that goes inside the `<script>`
tag. It is `JSON.stringify(posting).replace(/</g, "\\u003c")` — Next's own
recipe, and the reason a description containing `</script>` cannot break out of
the tag.

**`src/modules/careers/job-distribution.ts`** — the pull surfaces.

```ts
export interface SitemapEntry {
  url: string;
  lastModified: string;
  changeFrequency: "daily" | "weekly";
  priority: number;
}

export function sitemapEntries(jobs: PublicJob[], baseUrl: string): SitemapEntry[];
export function rssFeed(jobs: PublicJob[], baseUrl: string): string;
export function jobsCsv(jobs: PublicJob[], baseUrl: string): string;
```

Each takes the published roles and the base URL, and returns the whole
artifact. The routes are thin: read, call, respond. `SitemapEntry` is
structurally what `MetadataRoute.Sitemap` asks for, so `src/app/sitemap.ts`
returns it without an import from `next` into the domain module.


### 2. The mapping rules

`baseUrl` comes from `appConfig.url` and is the only public base-URL source in
the app. A trailing slash is normalised away so `{baseUrl}/careers/{id}` never
becomes `//careers/{id}`.

| schema.org property | Required | Source | Rule |
| --- | --- | --- | --- |
| `title` | yes | `job.title` | The role title as filed. The company is not appended — Google's guidance is that the title names the role, not the employer. |
| `description` | yes | `job.description` | The description column verbatim, as plain text. |
| `datePosted` | yes | `job.posted_at` → `job.created_at` | `posted_at` is the day the role went public; `created_at` is the `not null` fallback for a role that was published without one. No date at all ⇒ no posting (`null`). |
| `hiringOrganization.name` | yes | `company.name` → the group profile's name → `"Sharm Dreams Group"` | The three steps are: the role's own company, then the group profile (`groupProfile(companies)` — the row with `is_group_profile`), then the literal group name. A role whose company row is missing still names an employer rather than dropping out of the index. |
| `hiringOrganization.legalName` | no | `company.legal_name` | Only when the company filed one that differs from its name. |
| `hiringOrganization.sameAs` | no | `company.website` | Only when the company filed a website. |
| `jobLocation` | yes, unless the role is fully remote and names no place | `job.location` | `{ "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": <location>, "addressCountry": { "@type": "Country", "name": "Egypt" } } }`. |
| `jobLocationType` | required when fully remote | `job.employment_type`, `job.location` | `TELECOMMUTE` for a remote role, `HYBRID` for a hybrid one, absent otherwise. |
| `applicantLocationRequirements` | required when fully remote | — | `[{ "@type": "Country", "name": "Egypt" }]`. Google requires at least one country for a remote posting. |
| `employmentType` | no | `job.employment_type` | See the table below. |
| `identifier` | no | `job.id` | `{ "@type": "PropertyValue", "name": "Job ID", "value": <id> }`. |
| `url` | no | `baseUrl` + `/careers/{id}` | The canonical page for the role. |
| `directApply` | no | — | `true`: the platform's own apply form is one click away. |
| `validThrough` | no | `job.closing_at` | Only when the role has a closing date. |

**`employmentType` — Google's vocabulary against the platform's.** Google names
a *contract*; the platform's `employment_type` column is a closed list of six
codes that mixes contracts with workplace arrangements.

| Stored | Emitted | Why |
| --- | --- | --- |
| `FULL_TIME` | `FULL_TIME` | Same meaning. |
| `PART_TIME` | `PART_TIME` | Same meaning. |
| `CONTRACT` | `CONTRACTOR` | Same meaning, Google's word. |
| `INTERNSHIP` | `INTERN` | Same meaning, Google's word. |
| `REMOTE` | *absent* | It names an arrangement, not a contract. The contract was never recorded. |
| `HYBRID` | *absent* | Same. |
| anything else | `OTHER` | A recruiter can type into a CHECK-constrained text column; an unrecognised code is "other", not a guess. |

`REMOTE` and `HYBRID` deliberately lose `employmentType` rather than borrow
`FULL_TIME`. The platform's own column default is `FULL_TIME`, but a recruiter
who filed "Remote" replaced that default rather than added to it, so the
contract is genuinely unrecorded, and stating `FULL_TIME` would be a claim the
record does not make. The arrangement is not lost — it is carried by
`jobLocationType`, which is where Google looks for it.

**Remote detection.** A role is remote when the location text contains
"remote" (case-insensitively) **or** the job type is `REMOTE`. A remote role
carries `jobLocationType: "TELECOMMUTE"` and
`applicantLocationRequirements`, and **no** `jobLocation` — unless its location
text names a real place other than "remote", in which case that place is kept
as the hiring office and `TELECOMMUTE` still stands. That is Google's own model
for a remote role: an employer address, a telecommute flag, and the countries
the applicant may live in.

**`baseSalary` is deliberately not emitted.** Google wants a `MonetaryAmount`
whose value carries a `unitText` — `YEAR`, `MONTH`, `HOUR`. The platform
records an amount and a currency (`min_salary_usd`, `max_salary_usd`,
`salary_currency`) and **no period**; the public board prints `$40,000 –
$60,000` with no period either (`src/lib/currency.ts`). Emitting `YEAR` would
assert something the record does not say. A `salary_period` column would make
this emittable honestly, and that column is not in this slice.

**`addressCountry` is `Egypt`, and the reason is recorded.** `job_openings` has
no country column and its `location` is free text. `tenants_and_companies.country`
exists and defaults to `Egypt`, but the public company read
(`src/app/careers/actions.ts:59`) deliberately lists only the columns the public
page prints, and widening that list for one field is a separate decision. So
the country in a posting is the group's own country, as a named constant in the
domain module, not a per-role fact.

### 3. The five surfaces

#### (a) `JobPosting` JSON-LD on the role page — `src/app/careers/[id]/page.tsx`

The page already reads the role, the board, and the companies
(`src/app/careers/[id]/page.tsx:222`). It renders one `<script>`:

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: jobPostingJsonLd(posting) }}
/>
```

where `posting` is:

```ts
jobPosting(job, companyOfJob(job, companies), {
  baseUrl: appConfig.url,
  groupName: groupProfile(companies)?.name ?? "Sharm Dreams Group",
})
```

When `jobPosting` returns `null` — a role with no derivable date — no script is
rendered at all. The page still renders; the role simply carries no structured
data, which is better than a structured claim that cannot be dated.

#### (b) `src/app/sitemap.ts`

`MetadataRoute.Sitemap`, built from `getPublicJobs()` and `sitemapEntries`.
Public URLs only: `/`, `/careers`, and one entry per published role. Nothing
from the admin tree, the portal, or the apply wizard.

This route reads the database, so it must not be prerendered: the Docker image
builds with no database and no secrets (`.dockerignore` excludes `.env*`), and
a `use cache` scope reachable from a prerendered route is executed during the
build's cache-warming phase. `await connection()` stops the prerender, which is
the same mechanism and the same reason as `src/app/careers/page.tsx:171` and the
eighteen admin call sites that already use it.

#### (c) `src/app/robots.ts`

`MetadataRoute.Robots`.

- `Allow: /` — the careers tree is the point of the file.
- `Disallow:` the staff console paths (`/jobs`, `/candidates`, `/settings`,
  `/reports`, `/assessments`, `/interviews`, `/activity`, `/analytics`,
  `/assistant`, `/dashboard`, `/files`, `/onboarding`, `/questions`,
  `/sourcing`, `/time`, `/whatsapp`), the candidate surfaces (`/portal`,
  `/test`), `/login`, `/api/`, and `/careers/apply`.
- `Sitemap: {baseUrl}/sitemap.xml`.

These pages are already behind the staff route guard; robots.txt is about
crawler budget, not access.

This file reads no database, but it does read `APP_URL` — and the image is
built with no `.env*` (`.dockerignore`), so a prerendered robots.txt would bake
the *default* origin into its `Sitemap:` line and never see the deployment's
own. It therefore waits for a request too: `await connection()`, then
`appConfig.url`. The file itself is a dozen lines; the cost of getting the
sitemap pointer wrong is a crawler that never finds the sitemap.

#### (d) RSS 2.0 feed — `src/app/api/careers/feed.xml/route.ts`

A `GET` handler returning `application/rss+xml`. One `<item>` per published
role, with the title, the canonical link, the description, the `pubDate` in
RFC 822 form, and the canonical URL as a permalink `guid`. The channel carries
the group's name, the board URL and a `lastBuildDate`.

The route is under `/api/careers/` because that is where the careers API
already lives, and because a folder segment named `feed.xml` inside
`src/app/careers/` would sit next to the `[id]` dynamic segment.

Text is XML-escaped (`&`, `<`, `>` in text; `&`, `<`, `>`, `"` in attributes).
CDATA is not used: a description containing `]]>` would end the section early,
and escaping is not hard.

#### (e) CSV export — `src/app/api/careers/jobs.csv/route.ts`

A `GET` handler returning `text/csv`. One row per published role:

```
title,company,location,job_type,department,sector,description,requirements,date_posted,url
```

Every field is quoted and every internal quote is doubled, so a description
with a comma or a newline cannot split a row. `requirements` are joined with
`; `. **There is no salary column**, for the same reason there is no
`baseSalary`: the period is unrecorded, and a board's upload form will ask for
it — the recruiter answers that, explicitly, on the board.

This is the only credential-free route onto a named board. It is a hand-off,
and the spec says so rather than dressing it up as automation.

### 4. The one read change

`datePosted` has no source today: `JOB_COLUMNS`
(`src/app/careers/actions.ts:48`) selects neither `posted_at` nor `created_at`,
and `toJob` (`src/app/careers/actions.ts:72`) maps neither. The read therefore
gains `posted_at, created_at, closing_at`, and `PublicJob`
(`src/modules/careers/job-board.ts:17`) gains the three fields.

`toJob` is the only place a `PublicJob` is constructed in the tree, so this is
one mapping change and one interface change, and nothing else has to be
updated. The board, the chatbot's role card, the apply wizard and the company
helpers all consume the type and ignore the new fields.

`closing_at` is read for `validThrough`; the CSV carries the posted date, not
the closing date. `posted_at` is already used as the board's sort key
(`src/app/careers/actions.ts:162`), and it is stamped on the first publication
and never removed (`src/app/(admin)/jobs/job-actions.ts:466`), so a published
role has a real day to publish on — the `created_at` fallback is there for a
row that reached PUBLISHED without one.

### 5. Safety

- The JSON-LD string is `JSON.stringify(...).replace(/</g, "\\u003c")`, so a
  description containing `</script>` is inert: the `<` becomes the JSON escape
  `\u003c`, which parses back to `<` and cannot close the tag. The same string
  is what the proof script parses, so the escaping is tested, not asserted.
- The XML and CSV writers escape their own output. No role text reaches a
  response unescaped.
- Nothing new is public. Every surface reads through the same anonymous
  client and the same RLS policy that the careers board already uses, so a
  draft role cannot appear in the sitemap, the feed or the CSV — not by a
  filter the code applies, but by the database refusing the row.
- The canonical URL and the `APP_URL` default are the one thing that is not a
  secret and must not be treated as one: `appConfig.url` is already public in
  the app.

### 6. Failure behaviour

| Case | What happens |
| --- | --- |
| A role has no derivable date | `dateOf` returns `null`; `jobPosting` returns `null`, so the role page renders without structured data; the role is left out of the feed, the sitemap and the CSV, and the route logs the omitted role id — `[careers] role without a date is not published: <id>` — so the omission is visible rather than silent. |
| A role has no company row | `hiringOrganization.name` falls back to the group profile's name, then to `"Sharm Dreams Group"`. |
| A role's location is blank | `addressLocality` is omitted rather than empty-stringed; a blank locality is not a place. |
| A role's employment type is not in the vocabulary | `employmentType: "OTHER"`. |
| The database read fails | The route returns a 5xx with a plain body. The sitemap, feed and CSV are rebuilt from scratch on the next request; a partial file is never emitted. |
| `APP_URL` is unset | The URLs point at `http://localhost:3000` — see *Known limits*. |

---

## Not in this slice

- **Pushing to a named board.** No account, no API, nothing to push to. This
  is the deferred approach B.
- **A distribution console and publish log.** They need a table, and they need
  a destination.
- **Google Indexing API pings.** They need a Search Console key, which the
  platform does not hold.
- **`baseSalary`.** It needs a `salary_period` column.
- **A per-opening country.** It needs a column on `job_openings`.
- **A `contract_type` column**, so that `employmentType` can be stated for
  remote and hybrid roles.
- **Anything in the candidate portal.** No edit to `/portal`, `NoticeInbox` or
  `communication_logs`.
- **A migration of any kind.** This slice adds no table and no column. The
  read change widens a select list; it changes no schema.

---

## Proof

**`scripts/prove-job-distribution.mjs`** — plain `node`, no database, no
provider. It imports the two domain modules through the same `@/` alias
resolver the other fixture proofs use (`scripts/prove-coding-question.mjs:15`).

Fixtures: a normal Cairo full-time role; a remote role; a hybrid role; a role
with no company; a role with no date; a role whose description contains
`</script>`; a contract role; an internship role; a role with an unrecognised
job type; a role with a closing date; and a role whose location is blank.

**The published-only rule is the database's, not the module's.** A draft never
becomes a `PublicJob`: `getPublicJobs` reads through the anonymous client,
`jobs_public_read` (`db/schema.sql:1629`) exposes only `status = 'PUBLISHED'`
to an anonymous caller, and `is_staff()` is false for that key. So the module
is never handed a draft to leak. The proof pins that boundary with a source
pin on the read — that `getPublicJobs` filters on `PUBLISHED` — rather than
pretending the module filters it, which it could not.

The proof pins:

1. Every emitted posting carries `title`, `description`, `datePosted`,
   `hiringOrganization.name` and either `jobLocation` or
   `jobLocationType: "TELECOMMUTE"` with `applicantLocationRequirements`.
2. `datePosted` is `posted_at` when there is one and `created_at` otherwise.
3. A role with no date at all produces no posting, and is absent from the
   feed, the sitemap and the CSV.
4. A remote role carries `TELECOMMUTE`, no `jobLocation`, and an
   `applicantLocationRequirements` country; a hybrid role carries `HYBRID` and
   a `jobLocation`; a plain role carries a `jobLocation` with the location
   text as its locality and no `jobLocationType`.
5. The `employmentType` table above, value by value — including that `REMOTE`
   and `HYBRID` produce **no** `employmentType`, and that an unknown code
   produces `OTHER`.
6. No posting carries `baseSalary`.
7. `identifier.value` is the role id and `url` is `{baseUrl}/careers/{id}`,
   including when `baseUrl` ends in a slash.
8. The JSON-LD string contains no raw `<`; parsing it yields the same object
   the mapper produced — including for the description holding `</script>`.
9. The sitemap lists `/`, `/careers` and one entry per role it was given, and
   nothing else — no `/portal`, no admin path, no apply URL.
10. The feed carries one item per role it was given, its `pubDate` matches the
    role's date, and a description holding `&` and `<` comes back escaped.
11. The CSV has the header above, one row per role it was given, and a row
    count equal to that number — including for a description that contains a
    comma, a quote and a newline.
12. A role with no company still carries a `hiringOrganization.name` — the
    group name it was given — and a role with a blank location carries a
    `jobLocation` with no `addressLocality` rather than an empty one.

**Two-sided bite checks**, because a proof that cannot fail proves nothing:
each of the escaping pins is re-run against a doctored input (a `<` put back
into the JSON-LD string, an unescaped `&` put into the feed, a comma put into
a CSV field) and must then fail.

**Live check, read-only.** On a running container, open a published role's
page and read the rendered `<script type="application/ld+json">` out of the
DOM, and fetch `/sitemap.xml`, `/robots.txt`, `/api/careers/feed.xml` and
`/api/careers/jobs.csv`. Nothing is written, so no live data is touched.

**Gates.** `tsc --noEmit` and `npm run lint` stay green, with the two
accepted warnings and no new ones.

---

## Known limits

**The URLs follow `APP_URL`, and `APP_URL` has a default.**
`appConfig.url` is `optional(process.env.APP_URL, "http://localhost:3000")`
(`src/lib/config.ts:39`). On the local Docker stack that default is right —
nginx publishes 3000. On a deployment with a public hostname, `APP_URL` must
be set to that hostname or every canonical URL, every sitemap entry and every
feed link will point at `localhost`. This is the platform's existing contract,
not something this slice introduces: assessment links already depend on the
same variable (task #313 was the fix for a link pointing at the dev server).
The slice adds no second base-URL source, and the spec states the requirement
rather than papering over it.

**Google will not list the roles the moment they are published.** There is no
posting API; Google crawls. A new role appears when Google next visits the
page, and the Indexing API — which would need a Search Console key — is
deferred.

**This slice cannot be measured.** Nothing here reports impressions or
applications from a board. Whether Google shows the roles, and whether a
recruiter's upload succeeded, are both outside the platform until someone
looks at a board's dashboard.

---

## Surfaces this slice must not touch

- The candidate portal: `/portal`, `NoticeInbox`, `communication_logs`.
- The staff consoles: no change to any admin page, the guide, or the assistant.
- The assessment slice now in flight (`docs/superpowers/plans/2026-10-24-coding-question-type.md`):
  no shared file, no shared proof script.
- The admin assessment read: `readAttemptAnswers` and the comparison drawer.
- Migrations 032–039: authored, not applied, and untouched by this slice.

---

## Sources

- [Job posting (JobPosting) structured data — Google](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
- [How to implement JSON-LD in your Next.js application](node_modules/next/dist/docs/01-app/02-guides/json-ld.md)
- [`sitemap.ts` file convention — Next.js](node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/sitemap.md)
- [`connection()` — Next.js](node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md)
