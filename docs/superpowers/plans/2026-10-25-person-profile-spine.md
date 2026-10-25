# Person profile spine implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship migration `043_person_profile_spine.sql` and every consumer it enables — a field registry, one writer that owns the precedence ladder, one reader that gates Tier 3 by grant and logs every open, an extractor, an indicator module, the person half of erasure, and a hand-record door that finally accepts a CV file and a photo. No new staff page.

**Architecture:** Hybrid store — thirteen tables divided along the field's tier so the boundary is a grant and not a column list, one registry (`PERSON_FIELDS`) as the single source for tier / group / consent purpose / event stamp / input widget, one writer (`applyPersonField`) that every door calls, and one reader that composes a person from tables a recruiter is granted to see. Migration is idempotent end to end (`create table if not exists`, `create or replace`, `drop policy if exists`) and contains a backfill that is idempotent by construction.

**Tech Stack:** Next.js 16 App Router (Cache Components), React 19, strict TS, self-hosted Postgres 17 + PostgREST, plain-Node proof scripts (no jest), `pg`/`pgcrypto`, `@/` alias.

**Spec:** [docs/superpowers/specs/2026-10-25-person-profile-spine-design.md](../specs/2026-10-25-person-profile-spine-design.md) — every decision, every DDL block and every ceiling below is quoted from that file.

## Global Constraints

Every task inherits these. They are the spec's rules, not conventions I added.

- **Migration `043` is authored in this plan and not applied.** Applying it needs the owner's per-file approval; do not run `db:apply-local` or `docker:psql` on it without that approval.
- **Candidate portal is off-limits.** `src/app/(candidate)/**`, `NoticeInbox`, `communication_logs` — read-only references allowed, edits forbidden.
- **No new staff route.** The 18-path staff-route contract, `STAFF_ROUTES`, `NAV`, `PAGE_GUIDE`, `LIVE_WATCH.paths`, `check-staff-routes.mjs`, and `prove-job-distribution.mjs:541`'s count pin all stay at 18. This slice ships without touching any of them.
- **Surfaces this slice must not touch** — spec §"Surfaces this slice must not touch": `submitApplication`'s CV handling and its `cv_text` overwrite at `src/app/careers/actions.ts:507`; `application_attachments`' bucket CHECK; `planRetention`, `nextRetentionAction`, `privacy.retention_enabled`; `normalizeProspectProfile` and `sourced_prospects`; `scoreVisibility.ts`; `robots.ts`.
- **Proof style.** Plain Node, no jest: `node --env-file=docker/.env --experimental-strip-types scripts/prove-person-spine.mjs`. Style follows `scripts/prove-offers.mjs` (`registerHooks`, `check/equal/has/lacks`, banner `/* N. Title */` sections, tail counts and `process.exitCode = 1`). SQL pins are text needles against the migration file; source pins strip comments before matching.
- **Gates.** `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`; `npm run lint` (the two tolerated warnings, no third); `node scripts/prove-person-spine.mjs`; `node scripts/check-staff-routes.mjs` passes untouched.
- **Ceilings live once.** `src/modules/candidates/domain/person-limits.ts` is the only source for every numeric cap in spec §11; the writer, the reader, the drawer and the proof all import it.
- **`en` + `ar` for every label the surface renders.** Keys sit under `candidates.person.*`, `candidates.health.*`, `candidates.family.*`, `candidates.indicators.*`.
- **File path anchors** verified against the tree (do not drift these — a rename here means a rewrite there):
  - `src/app/(admin)/files/file-browser-types.ts:13` (`BucketKey`), `:24` (`BUCKETS`)
  - `src/app/(admin)/files/actions.ts:295` (`ownersFor`), `:512` (`unlinkReference`)
  - `src/modules/privacy/application/erasure.ts:31` (`CV_BUCKET`), `:80` (`collectPaths`), `:142` (`eraseApplication`)
  - `src/modules/candidates/domain/personIdentity.ts:38` (`personKey`)
  - `src/modules/settings/domain/types.ts:20` (`PermissionKey`)
  - `src/modules/settings/infrastructure/permissions.ts:18` (`hasPermissionForUser`)
  - `src/modules/activity/domain/trail.ts:47` (`ACTIVITY_AREAS`), `:70` (`ACTIVITY_ENTITIES`)
  - `src/modules/activity/application/record.ts:78` (`recordActivity`)
  - `src/modules/screening/infrastructure/aiGateway.ts:495` (`complete`), `:875` (`parseJsonResponse`)
  - `src/modules/sourcing/infrastructure/profile-extract.ts:87` (extractor precedent)
  - `src/modules/interviews/domain/interviewScorecard` (`isMissingSchemaError`)
  - `src/app/(admin)/candidates/candidate-actions.ts:864` (`createCandidate`)
  - `src/app/(admin)/candidates/[id]/profile.ts:348` (`getCandidateProfile`), `:386` (the `.in("email", emailSpellings(email))` read)
  - `src/modules/careers/cv-rules.ts:10` (`CV_MAX_MB`), `cvContentError`
  - `src/lib/config.ts:48` (`AiCapability`), `:69` (`modelChains`)
  - `db/migrations/041_privacy.sql:359` (`erase_candidate_data`), `:405` (the `'erased+…@erased.invalid'` email), `:499` (the revoke)

---

## File structure

**New files** (created by this slice):

- `db/migrations/043_person_profile_spine.sql`
- `src/modules/candidates/domain/person-fields.ts`
- `src/modules/candidates/domain/person-limits.ts`
- `src/modules/candidates/domain/person-notice.ts`
- `src/modules/candidates/domain/careerIndicators.ts`
- `src/modules/candidates/application/personWriter.ts`
- `src/modules/candidates/application/personReader.ts`
- `src/modules/candidates/infrastructure/cvProfileExtract.ts`
- `src/app/(admin)/candidates/[id]/PersonTabs.tsx`
- `scripts/prove-person-spine.mjs`

**Modified files**:

- `src/app/(admin)/files/file-browser-types.ts` — `BucketKey` gains `candidate-photos`, `BUCKETS` gains one descriptor.
- `src/app/(admin)/files/actions.ts` — `ownersFor` and `unlinkReference` gain branches.
- `src/modules/privacy/application/erasure.ts` — `collectPaths` gains the `person_profiles.photo_path` read; `eraseApplication` gains the `erasePersonIfLast` step.
- `src/modules/privacy/application/accessCopy.ts` — widened to render person tables.
- `src/modules/settings/domain/types.ts` — three new `PermissionKey` members.
- `src/modules/activity/domain/trail.ts` — one new `ACTIVITY_ENTITIES` entry (`person health data`).
- `src/app/(admin)/candidates/candidate-actions.ts` — `createCandidate` becomes the hand-record door.
- `src/app/(admin)/candidates/NewCandidateDrawer.tsx` — gains CV, photo, person fields.
- `src/app/(admin)/candidates/[id]/profile.ts` — resolves the person through `person_emails` and reads through `personReader`.
- `src/app/(admin)/candidates/[id]/page.tsx` — "Who they are" fed by `personReader`, six new tabs.
- `src/app/(admin)/settings/PermissionMatrixCard.tsx` — nothing (the matrix reads the seeded table); verify only.
- `src/lib/i18n/*.ts` (or the equivalent locale dictionaries in `src/modules/shell` — check the actual path) — new keys.
- `docs/AUTHENTICATION.md` — three new permission rows and three tick columns.

**Not touched.** Everything in *Surfaces this slice must not touch*.

---

## Task 1: Author migration `043_person_profile_spine.sql`

**Files:**
- Create: `db/migrations/043_person_profile_spine.sql`

**Interfaces:**
- Consumes: `db/migrations/041_privacy.sql` (already in the tree) for the `candidate_consents` shape, the `erase_candidate_data` hardening at `:499`, and the `'erased+…@erased.invalid'` email filter at `:405`.
- Produces: thirteen tables, one column, three permission rows, three `role_permissions` grants, one function, one backfill, and one `files` policy block, all with the exact names the later tasks import.

- [ ] **Step 1: Write the migration header banner.**

Follow the 041/042 style (`042_offers.sql:1-47`): a leading `-- ====` prose block that states the scope, the dependency on 041, the migration number and the "authored, not applied" fact. The last line of the file is `-- Next file: 044.` — that number tells the builder plan it is safe to claim 044.

```sql
-- ============================================================================
-- 043_person_profile_spine.sql
--
-- One migration for the person behind an application. Thirteen tables
-- (person_profiles, person_emails, person_languages, person_skills,
--  person_certifications, person_education, person_employment,
--  person_dependants, person_emergency_contacts, person_health,
--  person_family_details, person_consents, person_events),
-- one new column (applications.person_id), one new bucket (candidate-photos),
-- three new permissions, one erasure function, one idempotent backfill.
--
-- Requires 041_privacy.sql applied first (this file reads the
--   candidate_consents shape, calls erase_candidate_data, and its backfill
--   excludes the 'erased+...@erased.invalid' address that 041:405 mints).
--
-- STATUS: authored here, NOT applied. Applying this file needs the owner's
--   explicit per-file approval. It will be rehearsed on a throwaway database
--   before it lands on the local stack.
--
-- See docs/superpowers/specs/2026-10-25-person-profile-spine-design.md §1.
-- ============================================================================
```

- [ ] **Step 2: Write the thirteen `create table` blocks, in spec order.**

Copy verbatim from spec §1.1 through §1.10. Do not paraphrase the CHECK clauses — every one is a proof assertion in Task 16. The order is `person_profiles`, `person_health`, `person_family_details`, `person_dependants`, `person_emergency_contacts`, `person_emails`, `person_languages`, `person_education`, `person_employment`, `person_skills`, `person_certifications`, `person_consents`, `person_events`. Each table is followed by its `comment on table` / `comment on column` block; §1.1's `gender`/`pronouns` comments and §1.3's "other people's data" comment are mandatory — a reader of the live schema should learn the tier from the DB, not the spec.

Each table closes with its own index block:
- `person_skills_person_skill_idx` uses `lower(skill)`.
- `person_certifications_person_title_idx` uses `lower(title), lower(coalesce(issuer, ''))`.
- `person_emails_one_primary_idx` is a partial unique index on `(person_id) where is_primary`.

- [ ] **Step 3: Add the `applications.person_id` column with its comment.**

```sql
alter table public.applications
  add column if not exists person_id uuid;
comment on column public.applications.person_id is
  'The human this application belongs to, resolved from their address at the door that '
  'wrote the row. Nullable: applications predating 043 are backfilled here, and an '
  'erased application keeps its link to an anonymised person.';
```

**No FK constraint** on this column — spec §1.12 says so explicitly ("Adding `references person_profiles(id)` … converts a data problem into a migration that cannot complete"). Task 16's proof asserts orphans are counted, not that the FK refuses them.

- [ ] **Step 4: `enable row level security` on every table, then policies.**

Follow the 042 style exactly: `alter table if exists public.<t> enable row level security;` then one `drop policy if exists` + `create policy` block per command.

The SELECT policies are the table in spec §1.11:
- Tier 1 (`person_profiles`, `person_emails`, `person_languages`, `person_education`, `person_employment`, `person_skills`, `person_certifications`) → `is_staff()`.
- `person_events` → `is_staff() and (field_group <> 'health' or has_permission('candidates.view_health_data')) and (field_group not in ('family_details','dependants') or has_permission('candidates.view_family_data')) and (field_group <> 'emergency_contacts' or has_permission('candidates.view_emergency_contacts'))`.
- `person_health` → `is_staff() and has_permission('candidates.view_health_data')`.
- `person_family_details`, `person_dependants` → `is_staff() and has_permission('candidates.view_family_data')`.
- `person_emergency_contacts` → `is_staff() and has_permission('candidates.view_emergency_contacts')`.
- `person_consents` → `is_staff()` (the *absence* of consent is a fact the recruiter must see).

Write policies (`insert`/`update`/`delete`) on all thirteen → `is_staff() and has_permission('candidates.write')`. Every table also has `grant select, insert, update to authenticated; grant all to service_role; revoke all from anon;`.

**No anon policy anywhere** — the public apply form writes through the spine's own service-role door in the 044 slice, not here.

- [ ] **Step 5: The `files` policy block for `candidate-photos`.**

Add the staff-side policies the File Manager needs. This slice registers the bucket for the recruiter's hand-record door; the anon policy is the form-builder's addition in `044`. Use the 041 style, on `public.files`:

```sql
drop policy if exists "staff upload candidate photos" on public.files;
create policy "staff upload candidate photos" on public.files
  for insert to authenticated
  with check (
    bucket = 'candidate-photos'
    and is_staff()
    and has_permission('candidates.write')
    and split_part(path, '/', 1) = 'persons'
  );

drop policy if exists "staff read candidate photos" on public.files;
create policy "staff read candidate photos" on public.files
  for select to authenticated
  using (bucket = 'candidate-photos' and is_staff());

drop policy if exists "staff delete candidate photos" on public.files;
create policy "staff delete candidate photos" on public.files
  for delete to authenticated
  using (bucket = 'candidate-photos' and is_staff() and has_permission('candidates.delete'));
```

The `persons/<personId>/<uuid>.<ext>` prefix the staff write policy enforces is what spec §4 step 7 uploads into.

- [ ] **Step 6: The three permission rows and their SUPER_ADMIN grants.**

```sql
insert into public.permissions (key, label, group_name, description) values
  ('candidates.view_health_data', 'View health and disability data', 'Candidates',
   'Read the health and accommodation answers a candidate consented to. Every read is recorded.'),
  ('candidates.view_family_data', 'View family details', 'Candidates',
   'Read partner, child and household details. Counts and marital status do not need this.'),
  ('candidates.view_emergency_contacts', 'View emergency contacts', 'Candidates',
   'Read the contacts held for safety. Grants nothing used for screening.')
on conflict (key) do nothing;

insert into public.role_permissions (role_key, permission_key, granted) values
  ('SUPER_ADMIN', 'candidates.view_health_data', true),
  ('SUPER_ADMIN', 'candidates.view_family_data', true),
  ('SUPER_ADMIN', 'candidates.view_emergency_contacts', true)
on conflict (role_key, permission_key) do nothing;
```

- [ ] **Step 7: `erase_person_data(uuid)` and its hardening.**

Copy verbatim from spec §8.1 — the twelve-table delete list, the `person_profiles` anonymise, and the `revoke all on function public.erase_person_data(uuid) from public, anon, authenticated; grant execute on function public.erase_person_data(uuid) to service_role;` at the end. Byte-for-byte 041's hardening at `:499`.

The function is `language plpgsql security definer set search_path = public as $$ … $$;` with `comment on function` naming the ordering ("the last live application's erasure calls this, at the end of `eraseApplication`").

- [ ] **Step 8: The idempotent backfill (spec §1.12, verbatim).**

Copy the four numbered steps: the `create temp table backfill_people`, the three inserts and the drop. The `having char_length(...)` in step 0, the `a.email not like '%@erased.invalid'` filter and the shape regex on `lower(a.email)` are all mandatory — spec §1.12 explains why each one is where it is, and Task 16's proof 16 fails if any is removed.

- [ ] **Step 9: `notify pgrst, 'reload schema';` and the trailer.**

Last two lines:

```sql
notify pgrst, 'reload schema';
-- Next file: 044.
```

- [ ] **Step 10: Sanity the SQL against the local Postgres.**

**Do not apply against the running stack** — the owner's per-file approval has not been given. Rehearse on a throwaway database.

Run:
```
docker compose -f docker/docker-compose.yml exec -T postgres psql -U postgres -d postgres -c "create database spine_rehearsal;"
docker compose -f docker/docker-compose.yml exec -T postgres psql -U postgres -d spine_rehearsal -f /docker-entrypoint-initdb.d/001-initial.sql --single-transaction --quiet
```
(If the local stack's init scripts are not mounted at those paths, copy the migration in first via `docker compose cp`, then run it against `spine_rehearsal` the same way.)

Then:
```
docker compose -f docker/docker-compose.yml exec -T postgres psql -U postgres -d spine_rehearsal --single-transaction -v ON_ERROR_STOP=1 < db/migrations/043_person_profile_spine.sql
```
Expected: no error. Then run the same command again — expected: no error (idempotent). Then:
```
docker compose -f docker/docker-compose.yml exec -T postgres psql -U postgres -d spine_rehearsal -c "\dt person_*" -c "\d applications" -c "select count(*) from permissions where key like 'candidates.view_%'"
```
Expected: 13 tables listed, `person_id uuid` column present, three permission rows counted.

Drop the rehearsal database before moving on:
```
docker compose -f docker/docker-compose.yml exec -T postgres psql -U postgres -d postgres -c "drop database spine_rehearsal;"
```

- [ ] **Step 11: Commit.**

```
git add db/migrations/043_person_profile_spine.sql
git commit -m "feat(spine): author migration 043 for the person profile (unapplied)"
```

---

## Task 2: Field registry `person-fields.ts`

**Files:**
- Create: `src/modules/candidates/domain/person-fields.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `PersonFieldGroup`, `PersonFieldTier`, `PersonField`, `PERSON_FIELDS`, `personField(key)`, `extractableFieldKeys()`, `fieldsForTier(tier)`, `consentPurposeFor(key)`, `visibleFields(granted)`, `listCollectionFor(key)`. Task 5 (writer), Task 6 (reader), Task 8 (extractor), Task 11 (record door), Task 13 (profile tabs) and Task 16 (proof) all import from here. The form-builder spec §4.1 also imports from here in the 044 slice.

- [ ] **Step 1: Declare the types verbatim from spec §2.**

```ts
export type PersonFieldGroup =
  | "identity" | "contact" | "work_history" | "education" | "languages" | "skills" | "photo"
  | "marital_status" | "family_details" | "dependants" | "emergency_contacts"
  | "health" | "housing" | "extraction";

export type PersonFieldTier = 1 | 2 | 3;

export type PersonCollection =
  | "education" | "employment" | "languages" | "skills" | "certifications"
  | "dependants" | "emergency_contacts";

export interface PersonField {
  key: string;
  label: string;
  group: PersonFieldGroup;
  tier: PersonFieldTier;
  table: "person_profiles" | "person_health" | "person_family_details";
  column?: string;
  collection?: PersonCollection;
  input: "text" | "date" | "number" | "select" | "textarea" | "photo" | "list";
  options?: readonly string[];
  maxChars?: number;
  permission?: "candidates.view_health_data"
             | "candidates.view_family_data"
             | "candidates.view_emergency_contacts";
}
```

The `PersonCollection` type is the seven collections; the `input: "list"` variant pairs with a `collection` value. Task 16's proof 3 asserts the fourteen `PersonFieldGroup` members are exactly the fourteen `person_consents_purpose_check` values; proof 1 asserts the seven `PersonCollection` members are exactly the seven tables whose `input: "list"` rows point at them.

- [ ] **Step 2: Write `PERSON_FIELDS` — one entry per field the store holds.**

At minimum every column of `person_profiles` (legal_name, preferred_name, pronouns, gender, date_of_birth, birthplace, national_id, nationality, photo_path, photo_mime, mailing_address, current_city, phone, marital_status, children_count, household_size, housing_tenure, commute_mode, commute_minutes, relocation_willingness, travel_restrictions) and every column of `person_health` and `person_family_details` that the UI can edit. Plus collection entries for the seven `PersonCollection` values (education, employment, languages, skills, certifications, dependants, emergency_contacts) with `input: "list"` and `collection` set.

Each entry mirrors the SQL CHECK exactly. The `marital_status` options are `['single','married','divorced','widowed','civil_partnership','cohabiting','prefer_not_to_say']` — same order as spec §1.1's CHECK; Task 16's proof asserts by name match that neither list is wider than the other.

Assign tiers: `date_of_birth`, `nationality`, `current_city`, `phone`, `preferred_name`, `photo_path`, `languages`, `skills`, `certifications`, `education`, `employment` are tier 1 or tier 2 per spec §"The decision"; `blood_type`, `chronic_conditions`, `disability_status`, `accommodations`, `allergies`, `dietary_restrictions`, `health_insurance`, `partner_name`, `partner_occupation`, `partner_contact`, `anniversary_date`, `household_composition`, `family_planning`, dependants, and emergency_contacts are tier 3. The exact list is spec §"Approaches / The decision" and §1.2/§1.3.

- [ ] **Step 3: Write the five helper functions.**

```ts
export function personField(key: string): PersonField | null;
export function extractableFieldKeys(): string[];              // tier 1 only
export function fieldsForTier(tier: PersonFieldTier): PersonField[];
export function consentPurposeFor(key: string): PersonFieldGroup;
export function visibleFields(granted: ReadonlySet<string>): PersonField[];
export function listCollectionFor(key: string): PersonCollection | null;
```

`visibleFields` filters by granted permission names — a field with no `permission` is always visible; a field with `permission: "candidates.view_health_data"` is only in `visibleFields` when that string is in the set. `listCollectionFor(key)` returns the collection name for a `list`-input key and `null` for every other input.

- [ ] **Step 4: Verify by typecheck.**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`. Expected: 0 errors on this file.

- [ ] **Step 5: Commit.**

```
git add src/modules/candidates/domain/person-fields.ts
git commit -m "feat(spine): add the person field registry (the only tier declaration)"
```

---

## Task 3: `person-limits.ts` — every ceiling exported once

**Files:**
- Create: `src/modules/candidates/domain/person-limits.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PERSON_LIMITS` — the numeric caps from spec §11, plus the two byte ceilings every consumer must agree on.

- [ ] **Step 1: Export the object.**

```ts
export const PERSON_LIMITS = {
  education_rows: 60,
  employment_rows: 80,
  languages_rows: 20,
  skills_rows: 100,
  certifications_rows: 40,
  dependants_rows: 20,
  emergency_contacts_rows: 2,
  events_read_rows: 500,
  text_name_employer_institution: 160,
  text_long: 2000,
  text_as_written: 500,
  events_value_column: 500,
  photo_bytes: 5 * 1024 * 1024,
  photo_mime: ["image/jpeg", "image/png", "image/webp"] as const,
  cv_bytes: 5 * 1024 * 1024,
  extraction_input_chars: 28000,
  extraction_output_tokens: 3000,
  access_copy_applications: 20,
  access_copy_answers: 300,
  access_copy_answer_chars: 4000,
} as const;

export type PersonLimitKey = keyof typeof PERSON_LIMITS;
```

- [ ] **Step 2: Commit.**

```
git add src/modules/candidates/domain/person-limits.ts
git commit -m "feat(spine): one limits module so every ceiling is a name, not a number"
```

---

## Task 4: `person-notice.ts` — one paragraph per group

**Files:**
- Create: `src/modules/candidates/domain/person-notice.ts`

**Interfaces:**
- Consumes: `PersonFieldGroup` from Task 2.
- Produces: `NOTICE_VERSION: string`, `noticeFor(group: PersonFieldGroup): { title: string; body: string; withdraw: string }`. Task 5 (writer's consent checker) reads `NOTICE_VERSION`; the public apply page in the 044 slice reads `noticeFor`.

- [ ] **Step 1: Write the file.**

Structure:

```ts
// Not legal advice. This file is the owner's draft for their own review — the
// spec §3.2 rule is that the notice ships beside the store, so the writer can
// name the wording a consent row was given against.
import type { PersonFieldGroup } from "./person-fields";

export const NOTICE_VERSION = "2026-10-25";

const NOTICE: Record<PersonFieldGroup, { title: string; body: string; withdraw: string }> = {
  identity: { /* ... */ },
  contact: { /* ... */ },
  // …one entry per each of the fourteen PersonFieldGroup members
  extraction: { /* ... */ },
};

export function noticeFor(group: PersonFieldGroup) { return NOTICE[group]; }
```

Every entry has: why the group is asked, who reads it, that it is not used to score, and how to withdraw — the four things spec §3.2 names. The `extraction` entry says specifically that a CV is being handed to a model to be structured, and that the model's reading may be checked by a human before it becomes a profile fact.

- [ ] **Step 2: Commit.**

```
git add src/modules/candidates/domain/person-notice.ts
git commit -m "feat(spine): one notice paragraph per consent group"
```

---

## Task 5: Writer `personWriter.ts` — the ladder and the consent gate

**Files:**
- Create: `src/modules/candidates/application/personWriter.ts`

**Interfaces:**
- Consumes: `PERSON_FIELDS`, `consentPurposeFor`, `listCollectionFor` (Task 2); `PERSON_LIMITS` (Task 3); `NOTICE_VERSION` (Task 4); `personKey()` (`src/modules/candidates/domain/personIdentity.ts:38`); `restClient` (`src/lib/rest/client.ts`).
- Produces: `PersonFieldChange`, `PersonWriteResult`, `ConsentChecker`, `applyPersonField`, `mergePersons`, `PRECEDENCE`, `Door`, `ActorKind`. Every later task that writes the spine imports from here. The 044 builder imports `applyPersonField` and `PersonFieldChange` verbatim.

- [ ] **Step 1: Declare the interfaces and `PRECEDENCE` (spec §3.1, §3.3).**

```ts
export type Door =
  | "hand_record" | "profile_edit" | "cv_extraction" | "candidate_form"
  | "privacy_page" | "system";
export type ActorKind = "staff" | "candidate" | "extractor" | "system";

export interface PersonFieldChange {
  key: string;
  value: unknown;
  door: Door;
  actorId: string | null;
  actorKind: ActorKind;
}

export interface PersonWriteResult {
  applied: string[];
  refused: { key: string; reason: string }[];
  conflicts: { key: string; held: string; incoming: string; winner: string }[];
  personId: string;
}

export interface ConsentChecker {
  consentAlive(personId: string, group: PersonFieldGroup): Promise<boolean>;
}

const PRECEDENCE: Record<Door, number> = {
  privacy_page: 40,
  hand_record: 30,
  profile_edit: 30,
  candidate_form: 20,
  cv_extraction: 10,
  system: 5,
};
```

Spec §3.3's rule for `date_of_birth`: "immutable after any human set it: only `privacy_page` may change it, and only with the reason recorded." Encode that as a per-key exception inside `applyOneField` rather than a separate function — the door is what makes it legal, and the exception lives with the ladder it bends.

- [ ] **Step 2: Implement `applyPersonField(personId, changes, consent)`.**

The body is one loop over `changes`. For each change:
1. `personField(change.key)` — a `null` result → refuse `key: "unknown"`, reason naming the key. Do not proceed.
2. `await consent.consentAlive(personId, consentPurposeFor(field.key))` — false → refuse naming the group and pointing at `noticeFor(group).withdraw`. Do not write.
3. Read the current value (`SELECT <column>` for scalar fields; `SELECT count(*)` and a bounded row list for `collection` fields).
4. Compare `PRECEDENCE[change.door]` against the door recorded in the current row's latest `person_events` entry. `held > incoming` → push a `conflicts` entry with `winner: "held"`. `held < incoming` → write. `held === incoming` → write and record both sides in the event.
5. `cv_extraction` may fill a field whose current value is null and nothing else.
6. For `input: "list"` fields, `listCollectionFor(key)` gives the table name; append one row per offered item, applying the writer's trim+case-fold duplicate check the spec §3.4 requires. A second `React` refuses with the reason naming both, before the index refuses.

Every write in a single change is one service-role transaction (`restClient.rpc(...)`, or one raw `pg` pool call). The event rows are written inside the same transaction as the value, never after.

- [ ] **Step 3: Implement the consent checker.**

```ts
export async function defaultConsentChecker(): Promise<ConsentChecker> {
  return {
    async consentAlive(personId, group) {
      const { data } = await restClient
        .from("person_consents")
        .select("granted, notice_version")
        .eq("person_id", personId)
        .eq("purpose", group)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .single();
      return !!data && data.granted === true && data.notice_version === NOTICE_VERSION;
    },
  };
}
```

This is exactly the newest-row-wins rule 041's `candidate_consents` uses at `041_privacy.sql:154`.

- [ ] **Step 4: Implement `mergePersons(fromPersonId, toPersonId)`.**

Spec §3.4 — read every registry key on both profiles, refuse if any non-null value differs and return the list, otherwise move `person_emails` rows, repoint `applications.person_id`, write a `field_group: "merge"` event on both sides. Never a silent merge.

- [ ] **Step 5: Typecheck + a fixture proof for the writer's rules.**

For now, add a `describe` block in Task 16's proof script (Task 16 will pull it in); locally, run:
```
node --env-file=docker/.env --experimental-strip-types -e '
  const w = await import("./src/modules/candidates/application/personWriter.ts");
  if (w.PRECEDENCE.privacy_page !== 40) throw new Error("ladder drift");
  if (w.PRECEDENCE.candidate_form !== 20) throw new Error("candidate_form rung");
  console.log("writer signature ok");
'
```
Expected: `writer signature ok`.

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`. Expected: 0 errors.

- [ ] **Step 6: Commit.**

```
git add src/modules/candidates/application/personWriter.ts
git commit -m "feat(spine): one writer owns the precedence ladder and the consent gate"
```

---

## Task 6: Reader `personReader.ts` — tiered read, Tier-3 access logged

**Files:**
- Create: `src/modules/candidates/application/personReader.ts`

**Interfaces:**
- Consumes: `PERSON_FIELDS`, `visibleFields`, `fieldsForTier` (Task 2); `hasPermissionForUser` (`src/modules/settings/infrastructure/permissions.ts:18`); `recordActivity` (`src/modules/activity/application/record.ts:78`); the new `ACTIVITY_ENTITIES` entry (`"person health data"`) added in Task 11; `isMissingSchemaError` (`src/modules/interviews/domain/interviewScorecard`).
- Produces: `readPersonBundle(personId, actor): Promise<{ profile, emails, languages, education, employment, skills, certifications, consents, events, hidden: PersonFieldGroup[], available: boolean, note?: string }>`.

- [ ] **Step 1: Compose the read.**

```ts
export async function readPersonBundle(personId: string, actor: SessionUser) {
  const permissions = await permissionsFor(actor);
  const granted = new Set<string>(permissions);

  const base = await readTier1(personId, granted);   // profiles, emails, languages, education, employment, skills, certifications, consents, events (tier-filtered)
  const hidden: PersonFieldGroup[] = [];

  if (granted.has("candidates.view_health_data")) {
    base.health = await readHealth(personId);
    await recordActivity({
      actorId: actor.id, action: "viewed", entity: "person health data",
      entityId: personId, area: "candidates",
    });
  } else hidden.push("health");

  if (granted.has("candidates.view_family_data")) {
    base.family = await readFamily(personId);
    base.dependants = await readDependants(personId);
  } else { hidden.push("family_details"); hidden.push("dependants"); }

  if (granted.has("candidates.view_emergency_contacts")) {
    base.emergencyContacts = await readEmergencyContacts(personId);
  } else hidden.push("emergency_contacts");

  return { ...base, hidden };
}
```

Wrap every read in `isMissingSchemaError` handling. On a missing spine table, return `{ available: false, note: "Person details need migration 043." }` and hide nothing — spec §9's rule is "degrade the page, never the record".

- [ ] **Step 2: Refuse `[]` as a fact.**

A denied grant renders `{ hidden: [...] }` and the surface reads it as "Not shown to you" — never as an empty array printed as "no children". Encode this in the return shape (a denied table's field is `undefined`, not `[]`), and let Task 13's tabs assert it visually.

- [ ] **Step 3: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/modules/candidates/application/personReader.ts
git commit -m "feat(spine): tiered reader that logs every Tier-3 open"
```

---

## Task 7: `careerIndicators.ts` — pure, month-aware, discloses its own coverage

**Files:**
- Create: `src/modules/candidates/domain/careerIndicators.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `EmploymentRow`, `CareerIndicators`, `computeCareerIndicators(roles, now)`. Task 13 renders it as one strip above History.

- [ ] **Step 1: Declare the shape (spec §6, verbatim).**

```ts
export interface EmploymentRow {
  employer: string;
  startYear: number;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  ongoing: boolean;
}

export interface CareerIndicators {
  totalMonths: number;
  roles: number;
  longestRoleMonths: number | null;
  shortestRoleMonths: number | null;
  gapMonthsTotal: number;
  longestGapMonths: number | null;
  changesPerFiveYears: number | null;
  coverage: { rows: number; withMonths: number; withEnd: number };
  caveats: string[];
}

export function computeCareerIndicators(roles: readonly EmploymentRow[], now: Date): CareerIndicators;
```

- [ ] **Step 2: Implement the rules spec §6 states.**

An ongoing role counts to `now`. A year-only period counts as 12 months, or the remainder to `now` if it is the last role, and increments `coverage.withMonths` only when a `startMonth` was given. A role with no `endYear` and not ongoing is counted to `now` with a caveat pushed onto `caveats`. Gaps: sort by `(startYear, startMonth ?? 1)`, and each inter-role gap is the days between them ÷ ~30.44. Never a stability score — the return type does not include one.

- [ ] **Step 3: Verify against a fixture in the proof file.**

Write one inline fixture block that asserts a five-role sequence sums correctly and that the caveats array is populated exactly when the inputs require it. The Task 16 proof script pulls this same fixture out into a `check` block.

- [ ] **Step 4: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/modules/candidates/domain/careerIndicators.ts
git commit -m "feat(spine): career indicators disclose their own month coverage"
```

---

## Task 8: Extractor `cvProfileExtract.ts` + validator

**Files:**
- Create: `src/modules/candidates/infrastructure/cvProfileExtract.ts`

**Interfaces:**
- Consumes: `complete`, `parseJsonResponse`, `AiGatewayError`, `TruncatedJsonResponseError` (`src/modules/screening/infrastructure/aiGateway.ts`); `extractableFieldKeys` (Task 2); `PERSON_LIMITS.extraction_input_chars` / `extraction_output_tokens` (Task 3); the `resume_screening` capability.
- Produces: `ExtractedPersonProfile`, `extractPersonProfile(cvText, hints?)`, `validateExtractedPersonProfile(raw)`. Task 11 calls it from the record door's "Structure it" button.

- [ ] **Step 1: Declare the schema type (spec §5).**

```ts
export interface ExtractedPersonProfile {
  experience: { employer: string; title?: string; location?: string;
                startYear: number; startMonth?: number | null;
                endYear?: number | null; endMonth?: number | null;
                ongoing: boolean; duties?: string; asWritten: string }[];
  education: { institution: string; level: string; degree?: string;
               field?: string; graduationYear?: number | null;
               gpa?: number | null; honors?: string; asWritten: string }[];
  languages: { language: string; proficiency: string }[];
  skills: { skill: string; proficiency?: number | null; asWritten: string }[];
  certifications: { title: string; issuer?: string | null; year?: number | null; asWritten: string }[];
  location?: string;
}
```

- [ ] **Step 2: Reuse the `profile-extract.ts` discipline.**

Copy the shape of `extractProfile` (`src/modules/sourcing/infrastructure/profile-extract.ts:87`): `capability: "resume_screening"`, `jsonMode: true`, `temperature: 0.1`, `maxTokens: PERSON_LIMITS.extraction_output_tokens`, the 28 000-char input slice, and `describeExtractionFailure`'s truncation-vs-refusal split.

- [ ] **Step 3: Write the system prompt — spec §5's three explicit rules.**

"The prompt inherits every rule the prospect prompt already states — never invent, keep spellings, omit an empty section — and adds two of its own: *'Convert a date only when the text states a month by name or number. Never guess a month from a season, a school year or a holiday.'* and *'Report nothing about marriage, children, health, disability, religion, nationality, blood type, housing or an address. If the text states them, ignore them.'*"

Plus a third: *"Report a skill level only when the text states one; otherwise `proficiency` is null. Never infer a level from seniority, from a job title, or from how many skills are listed."*

- [ ] **Step 4: Write `validateExtractedPersonProfile(raw)`.**

Returns `{ value: ExtractedPersonProfile; dropped: string[] }`. For each top-level key not in `extractableFieldKeys()`, drop and push into `dropped`. For each skill with `proficiency` outside 1–5, keep the skill and null the proficiency, push `"skills[].proficiency"` into `dropped`. For each certification whose `year` fails 1950–2200, keep with `year = null`. Never drop a whole record because one field was invented.

- [ ] **Step 5: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/modules/candidates/infrastructure/cvProfileExtract.ts
git commit -m "feat(spine): the CV extractor writes to the spine, at one rung below a hand"
```

---

## Task 9: `personIdentity.ts` — one change: `personKey` is the writer's precondition

**Files:**
- Modify: `src/modules/candidates/domain/personIdentity.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: same `personKey`, same `emailSpellings`, plus `normalizePersonEmail(email): string | null` that returns the lowercased email or null on shape failure. Task 11 calls `normalizePersonEmail` before every write into `person_emails`.

- [ ] **Step 1: Add `normalizePersonEmail`.**

```ts
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
export function normalizePersonEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return EMAIL_SHAPE.test(trimmed) ? trimmed : null;
}
```

- [ ] **Step 2: Leave `personKey()` and `emailSpellings()` untouched.**

`getCandidateProfile`'s `.in("email", emailSpellings(email))` read stays exactly where it is; the spine does not replace the application-row read.

- [ ] **Step 3: Commit.**

```
git add src/modules/candidates/domain/personIdentity.ts
git commit -m "feat(spine): normalizePersonEmail is the writer's precondition"
```

---

## Task 10: Bucket registration — `candidate-photos` in the four places

**Files:**
- Modify: `src/app/(admin)/files/file-browser-types.ts:13` (`BucketKey`), `:24` (`BUCKETS`)
- Modify: `src/app/(admin)/files/actions.ts:295` (`ownersFor`), `:512` (`unlinkReference`)

**Interfaces:**
- Consumes: `person_profiles.photo_path` from the live DB (043 applied, or `isMissingSchemaError` guard).
- Produces: `BucketKey` widened to `"candidate-cvs" | "candidate-videos" | "candidate-audio" | "resumes" | "candidate-photos"`. The 044 slice depends on this union existing before it adds the anon policy.

- [ ] **Step 1: Widen `BucketKey`.**

```ts
export type BucketKey =
  | "candidate-cvs" | "candidate-videos" | "candidate-audio"
  | "resumes" | "candidate-photos";
```

- [ ] **Step 2: Add one `BUCKETS` descriptor.**

```ts
{
  key: "candidate-photos",
  label: "Candidate photos",
  writtenBy: "Staff from the record door (043) and, in a later slice, applicants from the public form (044)",
  deletable: true,
},
```

`writtenBy` names both doors honestly: only the staff door exists today, and the file will be truthful the day 044 lands.

- [ ] **Step 3: Extend `ownersFor` (files/actions.ts:295).**

```ts
if (bucket === "candidate-photos") {
  const { data, error } = await restClient
    .from("person_profiles")
    .select("photo_path, legal_name")
    .not("photo_path", "is", "null")
    .limit(1000);
  if (error) {
    if (isMissingSchemaError(error)) return { map, loaded: false };
    console.error("[files] photo lookup failed:", error.message);
    return { map, loaded: false };
  }
  for (const entry of data ?? []) {
    const row = asRecord(entry);
    const path = stringOrNull(row.photo_path);
    if (!path) continue;
    map.set(path, {
      label: stringOrNull(row.legal_name) ?? "Unnamed person",
      detail: "Profile photo",
    });
  }
  return { map, loaded: true };
}
```

- [ ] **Step 4: Extend `unlinkReference` (files/actions.ts:512).**

Add a branch: on `bucket === "candidate-photos"`, run
```ts
await restClient.from("person_profiles")
  .update({ photo_path: null, photo_mime: null })
  .eq("photo_path", storagePath);
```
Spec §7's line: "a deleted photo must clear the column that names it, or the profile offers an image that 404s."

- [ ] **Step 5: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/app/\(admin\)/files/file-browser-types.ts src/app/\(admin\)/files/actions.ts
git commit -m "feat(spine): candidate-photos is the File Manager's fifth bucket"
```

---

## Task 11: The record door — `createCandidate` becomes the door the owner asked for

**Files:**
- Modify: `src/app/(admin)/candidates/candidate-actions.ts:864` (`createCandidate`)
- Modify: `src/app/(admin)/candidates/NewCandidateDrawer.tsx`
- Modify: `src/modules/activity/domain/trail.ts:70` (`ACTIVITY_ENTITIES`)

**Interfaces:**
- Consumes: `applyPersonField` and `defaultConsentChecker` (Task 5); `normalizePersonEmail` (Task 9); `CV_MAX_MB` and `cvContentError` (`src/modules/careers/cv-rules.ts`); `getFileStore()` (`src/lib/files/store.ts`); `extractCvText` (`src/modules/screening/infrastructure/cvParser.ts`); `hasPermissionForUser` (`src/modules/settings/infrastructure/permissions.ts:18`); `PERSON_FIELDS` (Task 2); `PERSON_LIMITS` (Task 3).
- Produces: `CreateCandidateInput` widened to include `cvFilePath?`, `cvFileBytes?`, `photoPath?`, `person?: PersonFieldChange[]`, plus an action `structurePersonFromCv(applicationId)`.

- [ ] **Step 1: Add `"person health data"` to `ACTIVITY_ENTITIES` (`trail.ts:70`).**

One entry, area `"candidates"`, entity `"person health data"`. Task 6's reader logs against it.

- [ ] **Step 2: Rewrite `createCandidate` for spec §4's nine-step order.**

Signature:
```ts
export async function createCandidate(input: CreateCandidateInput): Promise<ActionResult<{ id: string }>>;
```

Body steps 1–9 are spec §4's numbered list, exactly:
1. `hasPermissionForUser("candidates.write")` gate.
2. Validate `input.person` against `PERSON_FIELDS` and the consent checker. Any refusal at this step means **no byte is stored**.
3. Resolve the person: `person_emails` by `personKey(email)`, else create `person_profiles` + `person_emails` in one service-role transaction. The profile's `legal_name` is `input.fullName` — never the CV's claim.
4. Store the CV in `candidate-cvs` at `applications/<jobId>/<uuid>-<leaf>` — the path `collectPaths` already reads. **Not** `resumes`.
5. `extractCvText(buffer, mime)`, using the same extension→mime mapping and the same silent-failure tolerance `actions.ts:480` uses. This slice does **not** touch `actions.ts:507`'s legacy overwrite.
6. Insert `applications` with `person_id` set.
7. Photo in `candidate-photos` at `persons/<personId>/<uuid>.<ext>`, then `person_profiles.photo_path` and `photo_mime`.
8. `applyPersonField(personId, input.person, consent)` at `door: "hand_record"`.
9. `recordActivity` — the application and the person are two entities.

Failure rule: steps 4–8 are one unit; if the `applications` insert fails after the byte landed, the byte is removed before the action returns.

- [ ] **Step 3: Add the "Structure it from the CV" action.**

```ts
export async function structurePersonFromCv(applicationId: string): Promise<ActionResult<PreviewSummary>>;
```

Reads the application's `cv_text`, calls `extractPersonProfile`, then `validateExtractedPersonProfile`, returns the preview to the client. Nothing writes yet. A second action, `commitExtractionPreview`, takes the preview back and calls `applyPersonField` at `door: "cv_extraction"`. Spec §5: "**It is a click.**"

- [ ] **Step 4: Rewrite the drawer.**

`NewCandidateDrawer.tsx` gains: a CV file input (reuses `attachmentRule("resumes")`'s type list and `CV_MAX_MB`), a photo control, and collapsible person groups generated from `PERSON_FIELDS.filter(f => visibleFields(granted).includes(f))`. The Tier-3 groups render only for a holder of the matching grant. The subtitle at `:146` is rewritten: it currently tells the recruiter to attach a CV *after* creating the record — that stops being true the moment this lands.

- [ ] **Step 5: Manual smoke against the local stack (no migration applied).**

Since 043 is authored but not applied, this task's live smoke runs only the failure branches: the drawer loads, `createCandidate` refuses a person write with a "Person details need migration 043" note, and the CV upload still lands (the application row is created, `person_id` is null). Do not run a happy path without owner approval to apply 043.

- [ ] **Step 6: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/app/\(admin\)/candidates/candidate-actions.ts src/app/\(admin\)/candidates/NewCandidateDrawer.tsx src/modules/activity/domain/trail.ts
git commit -m "feat(spine): the hand-record door finally accepts a CV file"
```

---

## Task 12: Erasure + access copy

**Files:**
- Modify: `src/modules/privacy/application/erasure.ts:31` (bucket constants), `:80` (`collectPaths`), `:142` (`eraseApplication`)
- Modify: `src/modules/privacy/application/accessCopy.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: `collectPaths` reads four sources; `eraseApplication` calls `erasePersonIfLast` after its per-application erase; `readApplications` renders person tables.

- [ ] **Step 1: Add the fourth read to `collectPaths`.**

Spec §8.1: `person_profiles.photo_path` → `candidate-photos`, resolved through the application's `person_id`. Add after the `application_attachments` branch:

```ts
const PHOTO_BUCKET = "candidate-photos";

// inside collectPaths, after the three existing reads:
if (personId) {
  const { data, error } = await restClient
    .from("person_profiles")
    .select("photo_path")
    .eq("id", personId)
    .not("photo_path", "is", "null")
    .limit(1)
    .maybeSingle();
  if (!error && data?.photo_path) paths.push({ bucket: PHOTO_BUCKET, path: data.photo_path });
}
```

Task 16's proof 19 asserts `collectPaths` counts four reads and the fourth names `candidate-photos`.

- [ ] **Step 2: `eraseApplication` calls `erasePersonIfLast` after success.**

```ts
async function erasePersonIfLast(personId: string) {
  const { count } = await restClient
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId)
    .is("erased_at", null);
  if ((count ?? 0) > 0) return;
  await restClient.rpc("erase_person_data", { p_person_id: personId });
}
```

Spec §8.1: "**After** a successful per-application erasure". Order is what makes erasure honest.

- [ ] **Step 3: Widen `accessCopy.ts` to render the person tables.**

`readApplications` gains: Tier-1 and Tier-2 fields, `person_education`, `person_employment`, `person_languages`, `person_skills`, `person_certifications`, the photo (a URL to a signed read, not a base64 blob in the email), `person_events`. Tier-3 tables read on `service_role`, rendered only in the document the token-holder opens. Third-party rows are included with the note spec §8.2 names.

The existing caps `MAX_ANSWERS = 300`, `MAX_ANSWER_CHARS = 4_000`, `MAX_APPLICATIONS = 20` move into `PERSON_LIMITS` (Task 3) and this file imports them.

- [ ] **Step 4: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/modules/privacy/application/erasure.ts src/modules/privacy/application/accessCopy.ts
git commit -m "feat(spine): erasure reaches the person, the access copy renders what we hold"
```

---

## Task 13: Profile surfaces — "Who they are" and six new tabs

**Files:**
- Modify: `src/app/(admin)/candidates/[id]/profile.ts:348` (`getCandidateProfile`)
- Modify: `src/app/(admin)/candidates/[id]/page.tsx` (`:135` card, `:212` read-only stance)
- Create: `src/app/(admin)/candidates/[id]/PersonTabs.tsx`

**Interfaces:**
- Consumes: `readPersonBundle` (Task 6), `computeCareerIndicators` (Task 7), `PERSON_FIELDS` (Task 2).

- [ ] **Step 1: Rewrite the "Who they are" card.**

`page.tsx:135` becomes a component fed by `readPersonBundle`: legal name, preferred name, age with the DOB beside it (spec decision 8: "34 (b. 12 Mar 1991)"), nationality, languages, city, photo. Age derived against `organisation.timezone` the way the portal's other clock-dependent readings already are.

- [ ] **Step 2: Add six tabs beside the existing ones.**

History (education and employment, each with `as_written` and the source door), Skills (the two claim lists), Background (Tier 2), Health (Tier 3 or "Not shown to you"), Family (Tier 3), Changes (`person_events`, tier-filtered). The read-only stance at `:212` becomes read-and-edit for the fields the actor holds — the drawer pattern is the one the candidate record already uses for contact details (task #50).

- [ ] **Step 3: Indicators strip above History.**

One line, the coverage caveat in the same text, not in a tooltip: **"Total 9.4 years — 3 of 5 roles state a month, the rest are counted as whole years."**

- [ ] **Step 4: `getCandidateProfile` composes `person_emails` + application rows.**

`profile.ts:348` first resolves the person through `person_emails` by `personKey(email)` when 043 is applied, then keeps the `.in("email", emailSpellings(email))` read at `:386`. Application rows remain the spine's evidence, not replaced.

- [ ] **Step 5: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/app/\(admin\)/candidates/\[id\]/profile.ts src/app/\(admin\)/candidates/\[id\]/page.tsx src/app/\(admin\)/candidates/\[id\]/PersonTabs.tsx
git commit -m "feat(spine): the person's profile reads through the spine, tier-gated"
```

---

## Task 14: `PermissionKey` union and `AUTHENTICATION.md`

**Files:**
- Modify: `src/modules/settings/domain/types.ts:20`
- Modify: `docs/AUTHENTICATION.md:92` (permissions table) and `:119` (role matrix)

**Interfaces:**
- Consumes: nothing.
- Produces: three new union members; the docs table matches the seeded rows so the migration and the docs cannot drift.

- [ ] **Step 1: Widen the union.**

```ts
export type PermissionKey =
  | ... existing members ...
  | "candidates.view_health_data"
  | "candidates.view_family_data"
  | "candidates.view_emergency_contacts";
```

The role matrix at `PermissionMatrixCard.tsx:39` reads `permissions` from the database, so the three rows appear there without a UI change — this task is only about the TS union and the docs.

- [ ] **Step 2: Update `docs/AUTHENTICATION.md`.**

Add three rows in the permissions table (§ around `:92`) with the same labels and descriptions the migration seeds. Add three tick columns in the role table (§ around `:119`), with only `SUPER_ADMIN` ticked — the same shape spec §"The decisions" #4 states.

- [ ] **Step 3: Commit.**

```
git add src/modules/settings/domain/types.ts docs/AUTHENTICATION.md
git commit -m "feat(spine): three tier-3 permissions in the union and the RBAC doc"
```

---

## Task 15: i18n — every new label in `en` and `ar`

**Files:**
- Modify: the locale dictionaries under `src/lib/i18n/` (verify actual paths — `Glob` for `i18n/*.ts` under `src/lib/` first).

**Interfaces:**
- Consumes: labels from `PERSON_FIELDS` (Task 2), `PERSON_LIMITS` (Task 3), `noticeFor` (Task 4), every drawer / tab label from Tasks 11 and 13.
- Produces: one `en`/`ar` pair for every string rendered.

- [ ] **Step 1: Enumerate the strings.**

Grep Tasks 11–13's source for every user-visible string the drawer, tabs, indicator strip, refusal sentence, and consent box render. Put each under `candidates.person.*`, `candidates.health.*`, `candidates.family.*`, `candidates.indicators.*`.

- [ ] **Step 2: Write the `en` values, then the `ar` values.**

Arabic wording for a medical or family field is reviewed by a human, not drafted by the `translation` capability — spec §12 says so, and the file comment must say so too:

```ts
// Arabic wording for a medical or family field is reviewed by a human, not
// drafted by the `translation` capability. A machine guess beside a diagnosis
// is a worse failure than a untranslated key.
```

- [ ] **Step 3: Commit.**

```
git add src/lib/i18n/
git commit -m "feat(spine): every person-field label ships en and ar"
```

---

## Task 16: `prove-person-spine.mjs` — every spec §Proof check, house style

**Files:**
- Create: `scripts/prove-person-spine.mjs`

**Interfaces:**
- Consumes: every module from Tasks 1–15. The migration file text (Tasks 1–4 assertions pin needle strings against it).
- Produces: 22 numbered checks plus 9 mutation proofs, printing `N checks passed` and exiting non-zero on any fail.

- [ ] **Step 1: Copy the shape of `scripts/prove-offers.mjs`.**

`registerHooks` for the `@/` alias, `check/equal/has/lacks` helpers, banner `/* N. Title */` sections each in a `{ }` block, tail that counts `passed / results.length` and sets `process.exitCode = 1` on any failure.

- [ ] **Step 2: Write the eight domain checks (spec §Proof 1–8).**

Fixture-driven, no DB. Sections:
1. `PERSON_FIELDS` is the only key source — a random key refuses, every registry key maps to one of the thirteen tables, every `collection` value is one of the seven.
2. Ladder — the six `PRECEDENCE` keys match the `person_events_door_check` values minus `merge`; `cv_extraction` fills empty only; equal rungs overwrite; `hand_record` beats `candidate_form`.
3. Group correspondence — fourteen `PersonFieldGroup` members = fourteen `person_consents_purpose_check` values, and those + `merge` = fifteen `person_events_field_group_check` values.
4. `date_of_birth` accepts `privacy_page` after any human write and refuses the other three doors.
5. Consent — absent / refused / withdrawn / older-notice all refuse, naming the group.
6. No Tier-3 key in `extractableFieldKeys()`.
7. Indicators — month-precise sums, ongoing to `now`, year-only disclosed in `coverage`.
8. `validateExtractedPersonProfile` drops and names `marital_status`, `nationality`; a `proficiency: 9` on a skill keeps the skill and nulls the level.

- [ ] **Step 3: Write the eight SQL pins (spec §Proof 9–16).**

Each pins a needle inside the migration file text (`read("db/migrations/043_person_profile_spine.sql")` + `has(...)`), not against the live DB (the file is authored, not applied). Comments stripped before matching. Nine sections:
9. `person_emails_email_is_lower_check`.
10. `person_emails_one_primary_idx` (partial unique).
11. `person_employment_ongoing_has_no_end_check` and `person_employment_no_end_before_start_check`.
12. `person_skills_person_skill_idx` on `lower(skill)`; `person_certifications_person_title_idx` on `lower(coalesce(issuer, ''))`.
13. `person_certifications_year_check`; title length 160.
14. The three tier-3 policies, each on its own grant.
15. `erase_person_data` deletes each of the twelve tables and updates `person_profiles`.
16. Backfill filters on `a.email not like '%@erased.invalid'`.

- [ ] **Step 4: Write the six boundary pins (spec §Proof 17–22).**

17. Source scan for Tier-3 registry keys under `src/modules/screening/**`, `src/modules/reports/**`, and `src/app/(admin)/assessments`.
18. `photo_path` read by no component under `src/app/(candidate)` or `src/app/(admin)/assessments`.
19. `collectPaths` counts four reads, and the fourth names `candidate-photos`.
20. `candidate-photos` appears in `BucketKey`, `BUCKETS`, `ownersFor`, `unlinkReference`, and 043's `files` policies.
21. `PermissionKey` has the three new members, and the migration seeds three `permissions` rows — counts match.
22. Staff route count is **still 18**. This check imports the directory listing that `check-staff-routes.mjs` walks, not a hard-coded literal.

- [ ] **Step 5: Write the nine mutation proofs (spec §Proof "Mutation proofs").**

Each is a documented mutation the file must apply-and-revert in a `finally` block, or a red check the file proves by running a broken variant. Style: a `mutate(file, needle, replacement, () => expectFails(...))` helper that restores the file in a `finally`. The nine, with the check each one turns red:

1. Add a Tier-3 key to `extractableFieldKeys()` → checks 8 and 6 fail.
2. Drop `field_group` from the `person_events` RLS policy → check 14 fails.
3. Delete the `@erased.invalid` filter from the backfill → check 16 fails.
4. Change `cv_extraction` precedence above `hand_record` → check 2 fails.
5. Put `candidate_form` on the top rung → check 2 fails — the only proof here that catches an anonymous door being promoted into an impersonation door.
6. Remove the `person_profiles.photo_path` read from `collectPaths` → check 19 fails.
7. Drop `skills` from `PersonFieldGroup` while leaving it in the two SQL CHECK lists → check 3 fails, proving a group added to the store and not to the registry is caught rather than quietly unreadable.
8. Make the `person_skills` unique index plain `(person_id, skill)` → check 12 fails, the only proof that catches a case-sensitive claim list refilling on every re-extraction.
9. Delete the `person_certifications` line from `erase_person_data` → check 15 fails — a certificate that survives its own erasure is a medical-adjacent claim left on disk after the paperwork says the person is gone.

- [ ] **Step 6: Run the proof.**

```
node --env-file=docker/.env --experimental-strip-types scripts/prove-person-spine.mjs
```

Expected: `22 checks passed` and exit code 0 (with mutation proofs applied and reverted).

- [ ] **Step 7: Commit.**

```
git add scripts/prove-person-spine.mjs
git commit -m "test(spine): prove-person-spine — 22 checks and nine mutation proofs"
```

---

## Task 17: Whole-slice gate + live proof

**Files:** none new.

- [ ] **Step 1: Run every gate.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
npm run lint
node --env-file=docker/.env --experimental-strip-types scripts/prove-person-spine.mjs
node scripts/check-staff-routes.mjs
node --experimental-strip-types scripts/prove-job-distribution.mjs
```

Expected: tsc reports no new errors (the pre-existing two warnings are tolerated); lint reports exactly the two tolerated warnings; the proof script prints `22 checks passed`; `check-staff-routes.mjs` prints `18 pages, 18 guarded, 8 on the rail` (the rail count is the current figure — the point is it did not move); `prove-job-distribution.mjs`'s staff-tree section 8 stays green.

- [ ] **Step 2: Report at the migration-approval gate.**

Migration 043 is authored but not applied. The live proof in spec §"Proof — Live proof" needs 041 and 043 applied; 041 is already in the tree per the Explore report but has not been confirmed as applied on the local stack (verify with `docker compose -f docker/docker-compose.yml exec -T postgres psql -U postgres -d <db> -c "\d applications" | grep erased_at`).

Do **not** run `db:apply-local` or `docker:psql` against the local stack without the owner's explicit per-file approval. The report at this step is: "Plan complete, all offline gates green; migrations 043 authored and rehearsed on a throwaway database; awaiting per-file owner approval before applying and running the live proof."

- [ ] **Step 3: Commit the plan itself.**

```
git add docs/superpowers/plans/2026-10-25-person-profile-spine.md
git commit -m "docs(plan): person-profile spine implementation plan"
```

- [ ] **Step 4: Once the owner approves, execute the live proof in this exact order.**

1. Apply 041 (`db:apply-local` on 041_privacy.sql), verify with `\dt candidate_consents`.
2. Apply 043, verify with `\dt person_profiles`.
3. Record a candidate by hand with a real CV, using the drawer.
4. Click "Structure it from the CV", read the indicators, skills and certifications lists off the profile, with a level absent where the CV states none.
5. Click "Structure it" a second time; confirm the claims did not duplicate.
6. Sign in as a role without `candidates.view_health_data`; confirm the Health tab renders "Not shown to you".
7. Delete the photo from `/files`; watch `photo_path` clear.
8. Erase the person through the privacy desk; confirm the byte, the profile, every dependant row, and both claim lists are gone.

Report each step with the exact output. Any failure returns here.

---

## Not in this plan

Spec's *Not in this slice* — the form builder itself, the public apply page's person writes, the candidate portal, level-weighted scoring, analytics over Tier 2/3, skill-catalogue matching, encryption of `national_id`.

Spec's *Known limits* — one identity, one address; no FK on `applications.person_id`; Tier-3 on an unencrypted disk; `person_events` holds old Tier-3 values until erasure; extraction quality is the model's; age needs a timezone; group-level consent; the four no-screening-purpose groups the owner asked for.
