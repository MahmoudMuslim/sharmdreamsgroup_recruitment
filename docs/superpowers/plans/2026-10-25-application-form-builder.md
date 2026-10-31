# Application form builder implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship migration `044_application_forms.sql` and every consumer it enables — a staff console at `/forms` for authoring drag-and-drop application layouts, a public read that resolves what an opening asks, a public upload door for file/photo fields, a dynamic wizard that replaces the fixed four steps for any opening whose layout resolves, a submit path that snapshots answers onto the application and routes person facts through the spine's writer, and one bounded pass on the existing retention sweep.

**Architecture:** Fully dynamic (decision 1). One pure function (`resolveLayout`) composes globals + assignments into one ordered stack and is the single place that decides what an opening asks; the apply page, submit action, publish check, and assignment door all call it, so none can disagree. Fields are one flat ordered list with `section_heading` as the step divider (no separate sections table). Files never go into jsonb: `application_form_files` is a byte ledger `collectPaths` reads directly, so erasure cannot miss a photo. The spine's `PERSON_FIELDS` is the only source of truth for what a `person:` binding means.

**Tech Stack:** Next.js 16 App Router (Cache Components, route handlers consume `request.url` for request-time reads), React 19, strict TS, self-hosted Postgres 17 + PostgREST, plain-Node proof scripts, native HTML5 drag-and-drop (no library) — the same pattern `CandidateBoard.tsx` and `BankColumns.tsx` use.

**Spec:** [docs/superpowers/specs/2026-10-25-application-form-builder-design.md](../specs/2026-10-25-application-form-builder-design.md) — every decision, DDL block, ceiling and proof assertion quoted from that file.

## Global Constraints

Every task inherits these.

- **Migration `044` is authored here and not applied.** Applying it needs the owner's per-file approval; **do not schedule a live proof of the erasure half before 041, 043 and 044 are all applied** (spec §8 "Ordering is a real constraint").
- **Ordering:** 044 requires 041 (replaces a function 041 defines) and 043 (adds a policy to a bucket 043 registers and reads tables only 043 creates). This plan assumes every spine task in [docs/superpowers/plans/2026-10-25-person-profile-spine.md](2026-10-25-person-profile-spine.md) is complete.
- **Candidate portal is off-limits.** `src/app/(candidate)/**`, `NoticeInbox`, `communication_logs` — read-only references only.
- **Staff route count moves 18 → 19.** `/forms` is a new page. `STAFF_ROUTES`, `NAV`, `PAGE_GUIDE`, `LIVE_WATCH`, and the count pin at `scripts/prove-job-distribution.mjs:541` all update together, and `scripts/check-staff-routes.mjs` fails the build if any of them disagree. The pin is derived from the directory listing, not a literal — the same correction `prove-job-distribution.mjs` section 8 already made.
- **Surfaces this slice must not touch** (spec §"Surfaces this slice must not touch"): `src/app/(candidate)/portal/**`; the four fixed steps' behaviour for openings with no published layout — `ApplyWizard.tsx` stays as-is and becomes the fallback; `applications` columns other than the new `form_answers`; the stage machine; gate-question tables, scoring, and the polite-rejection path; `erase_candidate_data`'s existing blanks (044 replaces the function to add exactly two — the `form_answers` null and the `application_form_files` delete — and every 041 blank stays as 041 wrote it); existing buckets' rules in `attachment-rules.ts`; `next-env.d.ts`, `.next`, the user's dev server on 3001.
- **`actions.ts:507`'s legacy `cv_text` overwrite stays untouched.** The dynamic path builds `cv_text` from **both** the About answer and the extracted CV; the check pins both. Spec §4: "The legacy path keeps `actions.ts:507` exactly as it is: changing it would silently re-file how every existing application reads, and that is an owner decision, not a side effect of this slice."
- **Proof style.** `node --env-file=docker/.env --experimental-strip-types scripts/prove-form-builder.mjs`; banner `/* N. Title */` sections; **every source-grep needle strips comments first** — the vacuous-needle failure the JD proof already hit is the reason spec §"Proof — Wiring" #10 pins it.
- **Gates.** `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`; `npm run lint` (two tolerated warnings, no third); `node scripts/prove-form-builder.mjs`; `node scripts/prove-job-distribution.mjs` (132 checks, the staff-route count pin moves 18 → 19 and must stay green); `node scripts/check-staff-routes.mjs`.
- **Ceilings live once.** `src/modules/form-builder/domain/limits.ts` is the only source for every §11 numeric cap; the writer, the console, the wizard, the retention pass, and the proof all import from there.

- **File path anchors** verified against the tree (do not drift):
  - `src/app/careers/apply/[id]/ApplyWizard.tsx:61` (the four fixed steps — fallback)
  - `src/app/careers/actions.ts:260` (`ApplyInput`), `:377` (`submitApplication`), `:480` (CV download for text), `:507` (the legacy overwrite), `:518` (the insert), `:528` (LinkedIn into cv_text), `:532` (`cvFilePath` trusted from client), `:296` (`activeGateQuestions` service-role read pattern)
  - `src/app/api/careers/questions/route.ts` (public read as route handler, no cache)
  - `src/app/api/careers/upload/route.ts` (oversize-before-buffer, magic-byte sniff, uuid-prefixed keys)
  - `src/modules/careers/gate-questions.ts` (one pure module, three callers, public projection strips gameable fields)
  - `src/modules/careers/attachment-rules.ts` (`AttachmentBucket`, `ATTACHMENT_RULES`, `attachmentPath()`)
  - `src/modules/assessment/domain/aiAuthoring.ts` (extract, bound, validate, refuse-with-name, never write)
  - `src/modules/privacy/application/erasure.ts:26` (`isMissingSchemaError`), `:80` (`collectPaths`), `:142` (`eraseApplication`)
  - `src/app/api/cron/retention/route.ts:118` (the two existing passes, `privacy.retention_enabled` gate)
  - `db/migrations/018_application_gate_questions.sql` (global-or-job authoring, `is_active` retirement, jsonb options with `jsonb_typeof` check, `is_staff() or <visibility>` read policy)
  - `db/schema.sql:1401` (`applications_one_live_per_job`), `:1237` (`has_permission(text)`), `:773` (the `application_attachments.bucket` CHECK that stops at `('resumes','candidate-audio')`)
  - `src/app/(admin)/candidates/CandidateBoard.tsx`, `src/app/(admin)/questions/BankColumns.tsx:29` (HTML5 drag + keyboard alternative)
  - `src/app/(admin)/files/file-browser-types.ts:13` (`BucketKey`, gains `candidate-photos` in 043)
  - `src/app/(admin)/files/actions.ts:295` (`ownersFor`), `:512` (`unlinkReference`)
  - `src/lib/config.ts:48` (`AiCapability`), `:69` (`modelChains`)
  - `src/modules/analytics/presentation/nav.ts:55` (`NAV`), `src/lib/auth/staffRoutes.ts:28` (`STAFF_ROUTES`), `src/modules/shell/domain/pageGuide.ts:39` (`PAGE_GUIDE`), `src/modules/live/domain/watch.ts` (`LIVE_WATCH`)
  - `src/modules/candidates/domain/person-fields.ts` (the spine's registry, Task 2 of the spine plan)
  - `src/modules/candidates/application/personWriter.ts` (`applyPersonField`, Task 5 of the spine plan)
  - `src/modules/candidates/domain/person-notice.ts` (`noticeFor`, `NOTICE_VERSION`, Task 4 of the spine plan)

---

## File structure

**New files** (created by this slice):

- `db/migrations/044_application_forms.sql`
- `src/modules/form-builder/domain/limits.ts`
- `src/modules/form-builder/domain/field-types.ts` (the `FIELD_TYPES` list, `kinds` closed vocabulary, `normaliseAnswer`)
- `src/modules/form-builder/domain/resolveLayout.ts`
- `src/modules/form-builder/domain/identityIssues.ts`
- `src/modules/form-builder/domain/snapshot.ts`
- `src/modules/form-builder/application/formActions.ts` (save/publish/assign/retire/draft)
- `src/modules/form-builder/application/publicForm.ts` (the public read + upload resolver)
- `src/modules/form-builder/infrastructure/formAuthoring.ts` (AI draft)
- `src/app/(admin)/forms/page.tsx`
- `src/app/(admin)/forms/FormsConsole.tsx`
- `src/app/(admin)/forms/FieldPalette.tsx`
- `src/app/(admin)/forms/Canvas.tsx`
- `src/app/(admin)/forms/Inspector.tsx`
- `src/app/(admin)/forms/BindingPicker.tsx`
- `src/app/careers/apply/[id]/DynamicApplyWizard.tsx`
- `src/app/careers/apply/[id]/fields/*` (one renderer per type, shared by the console preview and the wizard)
- `src/app/api/careers/form/route.ts`
- `src/app/api/careers/form-upload/route.ts`
- `scripts/prove-form-builder.mjs`

**Modified files**:

- `src/app/careers/actions.ts` — `submitApplication` gains `formUploads` and `customAnswers`; `ApplyInput` widened; the legacy path at `:507` is untouched.
- `src/app/careers/apply/[id]/page.tsx` — resolves the layout; renders `<DynamicApplyWizard>` when it resolves clean, `<ApplyWizard>` otherwise.
- `src/app/(admin)/jobs/[id]/page.tsx` — per-opening "Forms assigned" door.
- `src/app/(admin)/files/actions.ts` — `ownersFor` gains the `application_form_files` read; `unlinkReference` gains the `candidate-photos` form-file branch.
- `src/modules/privacy/application/erasure.ts` — `collectPaths` gains the fifth read (`application_form_files` by `application_id`, grouped by its own `bucket` column).
- `src/modules/privacy/application/accessCopy.ts` — "what you told us" section from `form_answers` + `application_form_files`.
- `src/app/api/cron/retention/route.ts` — third pass (orphans), **not** behind `privacy.retention_enabled`.
- `src/lib/config.ts:48` — `AiCapability` gains `"form_authoring"`; `:69` `modelChains` gains the same key.
- `src/modules/settings/domain/providers.ts:358` — `AI_CAPABILITIES` catalogue gains the row.
- `src/app/(admin)/settings/ModelRoutingConsole.tsx` — routing console surfaces `form_authoring` (this is the same INVARIANT the file's neighbours already assert: every id must match `AiCapability`).
- `src/modules/analytics/presentation/nav.ts:55` — `NAV` gains `/forms`.
- `src/lib/auth/staffRoutes.ts:28` — `STAFF_ROUTES` gains `"/forms"`.
- `src/modules/shell/domain/pageGuide.ts:39` — `PAGE_GUIDE` gains the `/forms` entry with `shows`/`use`/`edges` sections.
- `src/modules/live/domain/watch.ts` — `LIVE_WATCH` gains `application_forms` under the `/forms` area.
- `scripts/prove-job-distribution.mjs` — section 8's staff-tree count pin is directory-derived; the moment `/forms/page.tsx` exists the check moves from 18 to 19 automatically. Nothing to edit in that file — only verify it reads the new page correctly.

**Not touched.** Everything in *Surfaces this slice must not touch*.

---

## Task 1: Author migration `044_application_forms.sql`

**Files:**
- Create: `db/migrations/044_application_forms.sql`

**Interfaces:**
- Consumes: 041 (`erase_candidate_data` exists), 043 (`candidate-photos` bucket + `files` policies + `person_profiles.photo_path` exist).
- Produces: five tables + one column + one anon `files` policy + one `CREATE OR REPLACE` function + one seed row + one `notify pgrst`.

- [ ] **Step 1: Header banner.**

Same 041/042/043 style. States: five tables + one column, requires 041 and 043, authored and not applied, spec path. Last two lines: `notify pgrst, 'reload schema';` and `-- Next file: 045.` (reserving 045 for anything after this).

- [ ] **Step 2: `application_forms` (spec §1.1).**

```sql
create table if not exists public.application_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  is_global boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  version integer not null default 1 check (version > 0),
  global_position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 3: `application_form_fields` (spec §1.2, all 21 types in §3's order).**

```sql
create table if not exists public.application_form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.application_forms (id) on delete cascade,
  key text not null check (char_length(key) between 3 and 60),
  -- The 21 names are §3's table, in §3's order. One list, two places, proof 4.
  type text not null check (type in (
    'short_text','long_text','email','phone','url','number','percentage','currency',
    'date','time','datetime','duration','select','radio','multi_select','checkbox',
    'file','photo','address','geolocation','section_heading')),
  label text not null check (char_length(btrim(label)) between 1 and 200),
  help_text text,
  placeholder text,
  required boolean not null default false,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  system_key text check (
    system_key in ('name','email','phone','about','cv','photo','linkedin')
    or system_key ~ '^person:[a-z][a-z0-9_]{2,59}$'),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, key)
);
create index if not exists idx_form_fields_form on public.application_form_fields (form_id, position);
create index if not exists idx_form_fields_system on public.application_form_fields (system_key)
  where system_key is not null;
```

- [ ] **Step 4: `job_application_forms` (spec §1.3).**

```sql
create table if not exists public.job_application_forms (
  job_id uuid not null references public.job_openings (id) on delete cascade,
  form_id uuid not null references public.application_forms (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (job_id, form_id)
);
```

- [ ] **Step 5: `application_form_files` (spec §1.4).**

```sql
create table if not exists public.application_form_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications (id) on delete cascade,
  job_id uuid not null references public.job_openings (id) on delete cascade,
  field_key text not null,
  bucket text not null,
  storage_path text not null,
  mime text,
  bytes integer check (bytes is null or bytes >= 0),
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_form_files_application on public.application_form_files (application_id);
create index if not exists idx_form_files_orphans on public.application_form_files (uploaded_at)
  where application_id is null;
```

- [ ] **Step 6: `applications.form_answers` column with its comment (spec §1.5).**

```sql
alter table public.applications
  add column if not exists form_answers jsonb;

comment on column public.applications.form_answers is
  'What the candidate actually answered, as the form asked it: {fields:[{key,label,
  type,value,systemKey}], forms:[{id,name,version}], resolvedAt}. Written once at
  submit and never rewritten, so an application renders the questions it was filed
  against even after the form is edited, retired, or deleted.';
```

- [ ] **Step 7: RLS on the five tables (spec §1.6, verbatim).**

Each is `alter table if exists public.<t> enable row level security; drop policy if exists "<name>" on public.<t>; create policy "<name>" on public.<t> ...` — same shape as 018.

Read policies (all four tables that a candidate can trigger a read against):
- `application_forms` → `select using (is_staff() or (status = 'PUBLISHED' and archived_at is null))`
- `application_form_fields` → `select using (is_staff() or exists (select 1 from public.application_forms f where f.id = form_id and f.status = 'PUBLISHED' and f.archived_at is null))`
- `job_application_forms` → same shape as fields
- `application_form_files` → `select using (is_staff())` — never anon-readable

Write policies on all four staff tables → `insert/update/delete using is_staff() and has_permission('jobs.manage')`. `application_form_files` has **no** insert or update policy for `authenticated`; only `service_role` writes it (the upload route does so via the service client, and the anon upload path is through `files`, not this table).

- [ ] **Step 8: The anon `files` insert policy for `candidate-photos`.**

**This is one of the three things 044 adds to the spine's bucket** (spec §4, §"Proof" #17). The other two live in the TypeScript layer at Task 13.

```sql
drop policy if exists "candidates upload photos" on public.files;
create policy "candidates upload photos" on public.files
  for insert to anon
  with check (
    bucket = 'candidate-photos'
    and split_part(path, '/', 1) = 'applications'
  );
```

The prefix is `applications/` per spec §4's rule ("The path stays `applications/<jobId>/<uuid>-<leaf>`"), which is what the public form writes and what §8's orphan pass can find. The 043 staff write policy enforces the `persons/` prefix — this one enforces `applications/`, one bucket, two prefixes, two honest policy clauses.

- [ ] **Step 9: Replace `erase_candidate_data` (spec §8).**

`CREATE OR REPLACE FUNCTION public.erase_candidate_data(p_application_id uuid)` — copy the 041 body exactly and add two lines to the delete/blank block:

```sql
-- inside the update block that already blanks cv_text, cv_file_path, etc.:
  form_answers = null,

-- after the existing delete from application_attachments block:
  delete from public.application_form_files where application_id = p_application_id;
```

Spec §8: "It does **not** null `applications.person_id` and touches no `person_*` table: erasing an application is not erasing a human." Prove this at Task 16's #10 by asserting the replacement does **not** contain `person_id = null`.

Preserving 041's `revoke` (`041_privacy.sql:499`) — `CREATE OR REPLACE FUNCTION` preserves the function's owner and ACLs, so the 041 revoke still holds. Do not add a new `revoke` in 044; it would be redundant and mislead the reader.

- [ ] **Step 10: The seed form "Personal details" (spec §1.7).**

```sql
insert into public.application_forms (name, description, is_global, status, version, global_position)
  values ('Personal details',
          'The identity fields every application must collect.',
          true, 'PUBLISHED', 1, 0)
  on conflict do nothing;  -- idempotent: no unique constraint on name; use a fixed uuid via gen_random_uuid is fine to be re-run, but this seed should only fire once, so wrap in `where not exists (select 1 from application_forms where name = 'Personal details' and is_global)`.

-- then insert its seven fields (section_heading, name, email, phone, cv, about, linkedin)
-- with the system_key bindings and types spec §4's table pins.
```

Do the seed inside one `do $$ ... $$;` block so it runs exactly once. Idempotent: check by name + `is_global` first.

- [ ] **Step 11: Rehearse on a throwaway DB with 041 and 043 pre-applied.**

Same pattern as the spine plan's rehearsal. Expected: no error, re-run also clean. Assert:
```
psql ... -c "select count(*) from application_forms"        -- 1 (Personal details)
psql ... -c "select count(*) from application_form_fields"  -- 7
psql ... -c "\d applications"                                -- form_answers jsonb present
psql ... -c "select polname from pg_policies where tablename='files' and polcmd='I' and polroles @> array['anon']"
```
Expected: `candidates upload photos` listed. Drop the rehearsal DB before moving on.

- [ ] **Step 12: Commit.**

```
git add db/migrations/044_application_forms.sql
git commit -m "feat(forms): author migration 044 for the application form builder (unapplied)"
```

---

## Task 2: `limits.ts` — every §11 ceiling as a name

**Files:**
- Create: `src/modules/form-builder/domain/limits.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LIMITS` object with 15 fields (spec §11's table plus the four new ceilings added by decision 4's amendment).

- [ ] **Step 1: Export the object.**

```ts
export const LIMITS = {
  fields_per_form: 40,
  section_headings_per_form: 12,
  options_per_choice_field: 30,
  files_per_field: 1,
  global_forms: 12,
  forms_assigned_per_opening: 8,
  resolved_fields_per_application: 80,
  file_bytes: 10 * 1024 * 1024,
  photo_bytes: 5 * 1024 * 1024,
  long_text_chars: 5000,
  percentage_min: 0,
  percentage_max: 100,
  percentage_decimals: 2,
  duration_value_min: 1,
  duration_value_max: 9999,
  geolocation_lat_range: [-90, 90] as const,
  geolocation_lng_range: [-180, 180] as const,
  geolocation_dp: 6,
  time_pattern: /^([01]\d|2[0-3]):[0-5]\d$/,
  form_answers_entries: 80,
  orphan_upload_window_hours: 24,
} as const;
```

Task 8's retention pass imports `orphan_upload_window_hours` — spec §8 explicitly says the window is "a constant in `limits.ts`, not a setting, so it cannot be widened by accident".

- [ ] **Step 2: Commit.**

```
git add src/modules/form-builder/domain/limits.ts
git commit -m "feat(forms): one limits module so every ceiling is a name, not a number"
```

---

## Task 3: `field-types.ts` — 21 types, `kinds`, `normaliseAnswer`

**Files:**
- Create: `src/modules/form-builder/domain/field-types.ts`

**Interfaces:**
- Consumes: `LIMITS` (Task 2).
- Produces: `FIELD_TYPES` (the 21 names in §3's order), `KINDS` (the eight `kinds[]` values: `pdf | doc | sheet | slides | image | audio | video | text`), `kindRules(kind)` returning `{ acceptedMimes, magicBytes, maxBytes }`, `normaliseAnswer(type, config, value)` returning `{ ok: true, value: NormalisedValue } | { ok: false, reason: string }`.

- [ ] **Step 1: `FIELD_TYPES` in the exact order of the `type` CHECK.**

```ts
export const FIELD_TYPES = [
  "short_text","long_text","email","phone","url","number","percentage","currency",
  "date","time","datetime","duration","select","radio","multi_select","checkbox",
  "file","photo","address","geolocation","section_heading",
] as const;
export type FieldType = typeof FIELD_TYPES[number];
```

The proof (Task 16 §4) asserts `FIELD_TYPES` names are exactly the 21 in 044's `type` CHECK, and every one has a `normaliseAnswer` branch.

- [ ] **Step 2: `KINDS` as a closed vocabulary.**

```ts
export const KINDS = ["pdf","doc","sheet","slides","image","audio","video","text"] as const;
export type Kind = typeof KINDS[number];

export function kindRules(kind: Kind): {
  acceptedMimes: readonly string[];
  magicBytes: readonly (readonly number[])[];
  maxBytes: number;
} { /* one branch per kind, mirroring src/modules/careers/attachment-rules.ts */ }
```

Unknown kind refuses (`kindRules` returns `null` and the caller treats it as a save-time refusal).

- [ ] **Step 3: `normaliseAnswer(type, config, value)` — 21 branches.**

One branch per `FIELD_TYPES` name. Spec §3's table gives the normalised value for each; the four new types specifically:

```ts
case "percentage": {
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, reason: "not a number" };
  if (n < 0 || n > 100) return { ok: false, reason: "outside 0-100" };
  const dp = (String(value).split(".")[1]?.length ?? 0);
  if (dp > LIMITS.percentage_decimals) return { ok: false, reason: "more than two decimals" };
  return { ok: true, value: n.toFixed(dp) };
}
case "time": {
  const s = String(value);
  if (!LIMITS.time_pattern.test(s)) return { ok: false, reason: "must be HH:MM, 24-hour, no seconds, no AM/PM" };
  return { ok: true, value: s };
}
case "duration": {
  const pair = value as { value?: unknown; unit?: unknown };
  const n = Number(pair.value);
  if (!Number.isFinite(n) || n < LIMITS.duration_value_min || n > LIMITS.duration_value_max)
    return { ok: false, reason: "value out of range" };
  if (!["minutes","hours","days","weeks","months","years"].includes(String(pair.unit)))
    return { ok: false, reason: "unit not in closed list" };
  return { ok: true, value: { value: n, unit: String(pair.unit) } };
}
case "geolocation": {
  const p = value as { lat?: unknown; lng?: unknown };
  const lat = Number(p.lat), lng = Number(p.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, reason: "lat out of range" };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, reason: "lng out of range" };
  return { ok: true, value: { lat: +lat.toFixed(LIMITS.geolocation_dp), lng: +lng.toFixed(LIMITS.geolocation_dp) } };
}
```

`section_heading` refuses any value. `checkbox` returns `"true" | "false"`. `address` joins components in order. `multi_select` validates `minSelections`/`maxSelections`.

- [ ] **Step 4: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/modules/form-builder/domain/field-types.ts
git commit -m "feat(forms): 21 field types, closed kinds, one normaliser each"
```

---

## Task 4: `resolveLayout` — the only place the stack is composed

**Files:**
- Create: `src/modules/form-builder/domain/resolveLayout.ts`

**Interfaces:**
- Consumes: types from Tasks 1–3.
- Produces: `FormRow`, `FieldRow`, `AssignmentRow`, `ResolvedLayout`, `ResolvedStep`, `ResolvedField`, `LayoutViolation`, `resolveLayout(input)`. The apply page (Task 9), the submit action (Task 11), the publish action (Task 6), the assignment action (Task 6), and the proof (Task 16) all call this same function.

- [ ] **Step 1: Declare the types (spec §2, verbatim).**

```ts
export interface FormRow { id: string; name: string; isGlobal: boolean; globalPosition: number; status: "DRAFT" | "PUBLISHED"; archivedAt: string | null; version: number; }
export interface FieldRow { id: string; formId: string; key: string; type: FieldType; label: string; helpText: string | null; placeholder: string | null; required: boolean; config: Record<string, unknown>; systemKey: string | null; position: number; }
export interface AssignmentRow { jobId: string; formId: string; position: number; }

export interface ResolvedLayout { steps: ResolvedStep[]; fields: ResolvedField[]; violations: LayoutViolation[]; }

export interface ResolvedStep { heading: ResolvedField | null; fields: ResolvedField[]; }
export interface ResolvedField { field: FieldRow; form: FormRow; }

export type LayoutViolation =
  | { kind: "duplicate_key"; key: string; firstForm: string; secondForm: string }
  | { kind: "duplicate_system"; systemKey: string; firstForm: string; secondForm: string }
  | { kind: "identity_issue"; issue: string }
  | { kind: "ceiling"; ceiling: keyof typeof LIMITS; actual: number };
```

- [ ] **Step 2: Implement the order.**

Spec §2's order: "global forms in `global_position` then id order, then the opening's assigned forms in `position` then form-name order. Within a form, `position` then key. A tie is broken by id so two runs of the same read cannot disagree."

```ts
export function resolveLayout(input: {
  forms: readonly FormRow[];
  fieldsByForm: Readonly<Record<string, readonly FieldRow[]>>;
  assignments: readonly AssignmentRow[];
  jobId: string;
}): ResolvedLayout {
  const published = input.forms.filter(f => f.status === "PUBLISHED" && !f.archivedAt);
  const globals = published.filter(f => f.isGlobal)
    .sort((a, b) => a.globalPosition - b.globalPosition || a.id.localeCompare(b.id));
  const assigned = input.assignments
    .filter(a => a.jobId === input.jobId)
    .filter(a => published.find(f => f.id === a.formId && !f.isGlobal))
    .map(a => published.find(f => f.id === a.formId)!)
    .filter(Boolean)
    .sort((a, b) => (a.id === b.id ? 0 : /* assignment position, then form name */ ...));
  const ordered = [...globals, ...assigned];
  // flatten fields by (position, key); assemble steps by walking headings; collect violations.
}
```

Fill in the sort comparator inline (assignment position comes from `input.assignments` — carry it on the `assigned` mapping).

- [ ] **Step 3: Detect violations.**

Walk the flattened fields. A `key` seen twice → `duplicate_key`. A non-null `system_key` seen twice → `duplicate_system`. Check every ceiling in §11 that applies to a resolved layout (`resolved_fields_per_application`, `forms_assigned_per_opening`, `global_forms`) → `ceiling`. Do not run `identityIssues` here — Task 5 imports `resolveLayout`'s output; the two checks are separate functions called in the same order.

- [ ] **Step 4: Commit.**

```
git add src/modules/form-builder/domain/resolveLayout.ts
git commit -m "feat(forms): resolveLayout is the one place globals+assignments compose"
```

---

## Task 5: `identityIssues` + the `person:` binding rule

**Files:**
- Create: `src/modules/form-builder/domain/identityIssues.ts`

**Interfaces:**
- Consumes: `resolveLayout` output (Task 4); `PERSON_FIELDS`, `personField`, `consentPurposeFor`, `listCollectionFor` (spine plan Task 2).
- Produces: `identityIssues(fields: ResolvedField[]): IdentityIssue[]` and `IdentityIssue = { fieldKey: string; kind: string; message: string }`.

- [ ] **Step 1: Implement spec §4's bullets, one per check.**

```ts
export function identityIssues(fields: readonly ResolvedField[]): IdentityIssue[] {
  const issues: IdentityIssue[] = [];
  const bySystem = new Map<string, ResolvedField[]>();
  for (const f of fields) {
    if (!f.field.systemKey) continue;
    const arr = bySystem.get(f.field.systemKey) ?? [];
    arr.push(f); bySystem.set(f.field.systemKey, arr);
  }
  // exactly one `name`, required
  const names = bySystem.get("name") ?? [];
  if (names.length !== 1) issues.push({ fieldKey: "*", kind: "name-count", message: `expected 1 'name', found ${names.length}` });
  else if (!names[0].field.required) issues.push({ fieldKey: names[0].field.key, kind: "name-required", message: "'name' must be required" });

  // same for `email`
  // at least one of cv/about, and whichever is present is required

  // type-match per §4's table
  const PINNED_TYPE: Record<string, FieldType> = {
    name: "short_text", email: "email", phone: "phone", about: "long_text",
    cv: "file", linkedin: "url", photo: "photo",
  };
  for (const [k, arr] of bySystem) {
    if (k.startsWith("person:")) continue;      // handled below
    for (const f of arr) if (f.field.type !== PINNED_TYPE[k])
      issues.push({ fieldKey: f.field.key, kind: "type-mismatch", message: `'${k}' must be type ${PINNED_TYPE[k]}` });
  }

  // person: binding — registry check, type match per spec §4.1's seven-input mapping,
  // consent-gated group forbids required, list-collection forbids non-multi_select,
  // duration/geolocation forbid any binding (spec §4.1).
  const INPUT_TO_TYPE: Record<string, FieldType> = {
    text: "short_text", textarea: "long_text", date: "date", number: "number",
    select: "select", photo: "photo", list: "multi_select",
  };
  for (const f of fields) {
    const sk = f.field.systemKey;
    if (!sk || !sk.startsWith("person:")) continue;
    const key = sk.slice("person:".length);
    const reg = personField(key);
    if (!reg) { issues.push({ fieldKey: f.field.key, kind: "unknown-person-key", message: `registry has no '${key}'` }); continue; }
    const expected = INPUT_TO_TYPE[reg.input];
    if (f.field.type !== expected) issues.push({ fieldKey: f.field.key, kind: "person-type-mismatch", message: `'${key}' expects ${expected}` });
    if (reg.input === "list" && f.field.type !== "multi_select") issues.push({ fieldKey: f.field.key, kind: "list-not-multi", message: `list binding on non-multi_select` });
    if ((f.field.type === "duration" || f.field.type === "geolocation")) issues.push({ fieldKey: f.field.key, kind: "unboundable-type", message: `${f.field.type} cannot carry a person: binding` });
    if (f.field.required && reg.tier === 3) issues.push({ fieldKey: f.field.key, kind: "consent-required", message: `consent-gated group '${reg.group}' cannot be marked required` });
  }

  // no heading carries system_key; answerable field cannot precede the first heading.
  let seenHeading = false; let hasAnyHeading = false;
  for (const f of fields) {
    if (f.field.type === "section_heading") { hasAnyHeading = true; if (f.field.systemKey) issues.push({ fieldKey: f.field.key, kind: "heading-bound", message: "section_heading cannot bind" }); seenHeading = true; continue; }
    if (!hasAnyHeading) continue;   // a heading-less layout is legal (one step named after the form)
    if (!seenHeading) issues.push({ fieldKey: f.field.key, kind: "orphan-before-heading", message: "answerable field precedes the first heading" });
  }
  return issues;
}
```

- [ ] **Step 2: Commit.**

```
git add src/modules/form-builder/domain/identityIssues.ts
git commit -m "feat(forms): identity contract + person: binding rules, one module"
```

---

## Task 6: `snapshot.ts` — encode + parse `form_answers`

**Files:**
- Create: `src/modules/form-builder/domain/snapshot.ts`

**Interfaces:**
- Consumes: `ResolvedField` from Task 4; `LIMITS.form_answers_entries` from Task 2.
- Produces: `Snapshot`, `encodeSnapshot(fields, answers, forms): Snapshot`, `parseSnapshot(json: unknown): { fields: SnapshotField[]; forms: SnapshotForm[] } | null`.

- [ ] **Step 1: Define the shape (spec §1.5, verbatim).**

```ts
export interface SnapshotField { key: string; label: string; type: FieldType; value: unknown; systemKey: string | null; }
export interface SnapshotForm { id: string; name: string; version: number; }
export interface Snapshot { fields: SnapshotField[]; forms: SnapshotForm[]; resolvedAt: string; }
```

- [ ] **Step 2: `encodeSnapshot` builds from resolved fields + normalised answers.**

Every field contributes `{ key, label, type, value, systemKey }`. A `file`/`photo` field contributes `{ value: '<sanitised filename>' }`, not the storage path — the bytes are in `application_form_files`. Cap to `LIMITS.form_answers_entries`.

- [ ] **Step 3: `parseSnapshot` drops malformed entries.**

Follow `parseGateAnswers` precedent (`src/modules/careers/gate-questions.ts`) — the reader returns `null` for any entry whose `key`, `label`, `type` is missing or wrong-typed. A duration pair truncated to one key parses as a dropped entry, not a half answer (spec §"Proof" 6).

- [ ] **Step 4: Commit.**

```
git add src/modules/form-builder/domain/snapshot.ts
git commit -m "feat(forms): form_answers snapshot round-trips and drops malformed pairs"
```

---

## Task 7: `/forms` staff console — the nineteenth staff route

**Files:**
- Create: `src/app/(admin)/forms/page.tsx`
- Create: `src/app/(admin)/forms/FormsConsole.tsx`
- Create: `src/app/(admin)/forms/FieldPalette.tsx`
- Create: `src/app/(admin)/forms/Canvas.tsx`
- Create: `src/app/(admin)/forms/Inspector.tsx`
- Create: `src/app/(admin)/forms/BindingPicker.tsx`
- Modify: `src/lib/auth/staffRoutes.ts:28` — `"/forms"` added to `STAFF_ROUTES`
- Modify: `src/modules/analytics/presentation/nav.ts:55` — `NAV` gains `{ href: "/forms", label: "Application Forms", icon: FormInput, hint: "Build what an application asks", section: "Hiring" }` placed after `/jobs`
- Modify: `src/modules/shell/domain/pageGuide.ts:39` — `PAGE_GUIDE["/forms"] = { shows: ..., use: ..., edges: ... }`
- Modify: `src/modules/live/domain/watch.ts` — the `/forms` area watches `application_forms`

**Interfaces:**
- Consumes: `resolveLayout` (Task 4), `identityIssues` (Task 5), `PERSON_FIELDS` (spine Task 2), `noticeFor` (spine Task 4), `LIMITS` (Task 2).
- Produces: the four-place staff route registration moves 18 → 19; `check-staff-routes.mjs` and `prove-job-distribution.mjs`'s directory-derived pin both pick the new page up automatically. Nothing to edit in those two scripts.

- [ ] **Step 1: Add `"/forms"` to `STAFF_ROUTES` (`staffRoutes.ts:28`).**

```ts
export const STAFF_ROUTES = [
  "/dashboard", "/candidates", "/jobs", "/forms", "/assessments", "/questions",
  /* ... the existing 17, keep them in place ... */
] as const;
```

- [ ] **Step 2: Add the `NAV` entry (`nav.ts:55`).**

```ts
{ href: "/forms", label: "Application Forms", icon: FormInput, hint: "Build what an application asks", section: "Hiring" },
```

- [ ] **Step 3: Add the `PAGE_GUIDE` entry (`pageGuide.ts:39`).**

Three sections — `shows`, `use`, `edges`. The `edges` section names what a form is not (not a scoring surface; gate questions live at `/questions`; the consent step is fixed).

- [ ] **Step 4: Add the live-watch entry (`src/modules/live/domain/watch.ts`).**

Map `/forms` → `application_forms`. A save bumps `version`, so the fingerprint change is what triggers the reload.

- [ ] **Step 5: `FormsConsole.tsx` — three-pane editor.**

Left: `FieldPalette` listing all 21 type chips (spec §6 "palette of the 21 types"). Middle: `Canvas` — native HTML5 drag-and-drop with an up/down button on every row for the keyboard alternative (spec §6's `BankColumns.tsx:29` precedent). Right: `Inspector` — for the selected field, edits label, help, placeholder, required, and its type-specific config. Contains the `BindingPicker`.

- [ ] **Step 6: `BindingPicker.tsx` reads `PERSON_FIELDS` directly.**

Spec §6: "the console reads the spine's registry keys — read from `PERSON_FIELDS`, never a second list the console could drift away from." Each key shown tier-labelled, and a Tier-2 or Tier-3 key carries its group's `noticeFor(group).body` sentence beside it. A `list` key labelled "saves each choice as its own row", greyed out on a field that is not a `multi_select`.

- [ ] **Step 7: Commit.**

```
git add src/app/\(admin\)/forms/ src/lib/auth/staffRoutes.ts src/modules/analytics/presentation/nav.ts src/modules/shell/domain/pageGuide.ts src/modules/live/domain/watch.ts
git commit -m "feat(forms): /forms is the nineteenth staff route, three-pane editor wired"
```

---

## Task 8: Console actions — save, publish, assign, retire, and the retention orphan pass

**Files:**
- Create: `src/modules/form-builder/application/formActions.ts`
- Modify: `src/app/api/cron/retention/route.ts`

**Interfaces:**
- Consumes: `hasPermissionForUser`; `resolveLayout` (Task 4); `identityIssues` (Task 5); `LIMITS` (Task 2); `getFileStore()` (`src/lib/files/store.ts`).
- Produces: `saveFormLayout`, `publishForm`, `assignFormToJob`, `unassignFormFromJob`, `retireForm`, `listForms` — every page-level action `/forms` calls.

- [ ] **Step 1: `saveFormLayout(formId, fields, expectedVersion)` — one write, optimistic version check.**

```ts
export async function saveFormLayout(formId: string, fields: readonly FieldDraft[], expectedVersion: number) {
  if (!(await hasPermissionForUser("jobs.manage"))) return { error: "Not allowed" };
  // refuse before writing:
  //   unanswerable config (a select with fewer than two usable options, min > max, empty kinds)
  //   duplicate keys inside the form
  //   a ceiling breach (fields_per_form, section_headings_per_form, options_per_choice_field)
  //   a heading carrying a system_key
  //   a `person:` binding the registry does not know, or whose type is not the registry's
  //   a consent-gated binding marked `required`
  // then: replace fields in one transaction, bump version, return { ok: true, version }
}
```

- [ ] **Step 2: `publishForm(formId)`.**

`resolveLayout({ forms, fieldsByForm, assignments, jobId })` for **every opening this form is assigned to** (and one pass with no assignment for the form itself). Runs `identityIssues` on each and prints every violation with the field named. Refuses to publish while any stands. On success, sets status = `PUBLISHED`, bumps `version`.

Spec §6: "Publish is a **separate** action that runs `identityIssues` over the resolved layout and prints every violation with the field named — so an author can save an incomplete draft and cannot ship one."

- [ ] **Step 3: `assignFormToJob(jobId, formId, position)` and `unassignFormFromJob`.**

Runs the would-be `resolveLayout` on the target job and refuses on a duplicate key by naming the field *and* the other form that holds it, and on a ceiling breach by printing both counts. Refuses while the form is `DRAFT` or `archived`.

- [ ] **Step 4: `retireForm(formId)` sets `archived_at`; delete is not offered.**

Spec §6: "deletion is not offered while any application carries the form's answers."

- [ ] **Step 5: `listForms()` returns the console's row model.**

Name, status, scope (global or N roles), `version`, field count, `updated_at`. Bounded by `LIMITS.global_forms` for globals and a `select ... .limit(200)` for the list.

- [ ] **Step 6: Retention route gains the orphan pass.**

`src/app/api/cron/retention/route.ts` today has two passes (warn, then erase via `eraseApplication`) gated behind `privacy.retention_enabled`. Add a third pass, **outside the gate**, at the top of the handler:

```ts
// Bounded orphan-upload pass. Runs regardless of privacy.retention_enabled —
// an upload that never became a record has no record to protect, and "off"
// cannot mean "keep a stranger's photo forever".
const cutoff = new Date(Date.now() - LIMITS.orphan_upload_window_hours * 60 * 60 * 1000);
const { data: orphans } = await serviceClient
  .from("application_form_files")
  .select("id, bucket, storage_path")
  .is("application_id", null)
  .lt("uploaded_at", cutoff.toISOString())
  .limit(500);
for (const row of orphans ?? []) {
  await getFileStore().remove(row.bucket, row.storage_path);     // bytes first
  await serviceClient.from("application_form_files").delete().eq("id", row.id);   // row after
}
```

Update the route's doc comment to name this exception so it lives on the page that grants it, not only in the spec.

- [ ] **Step 7: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/modules/form-builder/application/formActions.ts src/app/api/cron/retention/route.ts
git commit -m "feat(forms): save/publish/assign/retire actions + the orphan upload pass"
```

---

## Task 9: AI drafting — `form_authoring` capability

**Files:**
- Modify: `src/lib/config.ts:48` (`AiCapability`)
- Modify: `src/lib/config.ts:69` (`modelChains`)
- Modify: `src/modules/settings/domain/providers.ts:358` (`AI_CAPABILITIES`)
- Modify: `src/app/(admin)/settings/ModelRoutingConsole.tsx` (the routing console's capability list)
- Create: `src/modules/form-builder/infrastructure/formAuthoring.ts`

**Interfaces:**
- Consumes: `complete`, `parseJsonResponse` (`src/modules/screening/infrastructure/aiGateway.ts`); `FIELD_TYPES` (Task 3); `PERSON_FIELDS` (spine Task 2).
- Produces: `draftFormFields(prompt: string): Promise<FieldDraft[]>` — returns a `DRAFT`-state field list, no writes ever.

- [ ] **Step 1: Widen `AiCapability`.**

```ts
export type AiCapability =
  | "resume_screening" | "soft_skills" | "case_reasoning" | "feedback"
  | "interview_questions" | "transcription" | "assistant" | "chatbot"
  | "translation" | "form_authoring";
```

- [ ] **Step 2: Add `form_authoring` to `modelChains`.**

Give it a chain of the same length as `interview_questions` — a routing entry in the default config the operator can override in the console.

- [ ] **Step 3: Add `AI_CAPABILITIES` row + routing console row.**

Same INVARIANT the file's neighbours already assert (providers.ts:353). If the routing console reads `AI_CAPABILITIES` directly, only that file needs the row — verify with `Grep`.

- [ ] **Step 4: Write `formAuthoring.ts`.**

Mirror `src/modules/assessment/domain/aiAuthoring.ts`: `complete({capability: "form_authoring", jsonMode: true})`, `parseJsonResponse`, validate through the same domain rules as a human save — a refused entry is dropped and **named** in the result, and nothing writes. Output lands as a `DRAFT` with the system fields pre-placed. Never assigned automatically. Spec §7: "a model volunteering that it wants a candidate's blood type is exactly the case the human-only publish step exists to catch."

- [ ] **Step 5: Wire the console's "Draft with AI" button.**

`/forms` editor gains a draft button that calls `formActions.draftWithAI(prompt)` → which calls `formAuthoring.draftFormFields` → returns a `DRAFT` form for the recruiter to review.

- [ ] **Step 6: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/lib/config.ts src/modules/settings/domain/providers.ts src/modules/form-builder/infrastructure/formAuthoring.ts
git commit -m "feat(forms): form_authoring capability and its AI draft path"
```

---

## Task 10: The public read — `GET /api/careers/form?jobId=…`

**Files:**
- Create: `src/modules/form-builder/application/publicForm.ts`
- Create: `src/app/api/careers/form/route.ts`

**Interfaces:**
- Consumes: `resolveLayout` (Task 4); `LIMITS` (Task 2).
- Produces: `resolveFormForJob(jobId): Promise<ResolvedLayout | { fallback: "wizard"; reason: string }>` — one read, service-role, request-time.

- [ ] **Step 1: `publicForm.ts` — the projection.**

```ts
export interface PublicField {
  key: string; label: string; help: string | null; placeholder: string | null;
  type: FieldType; required: boolean; options?: readonly string[];
  accept?: string;                       // derived from `kinds[]`, never from config.maxBytes or systemKey
  maxBytes?: number;                     // the byte ceiling for file/photo, resolved server-side from the layout
}
export interface PublicStep { heading: string | null; fields: PublicField[] }
export interface PublicForm { steps: PublicStep[]; consentGroups: PersonFieldGroup[] }

export function project(layout: ResolvedLayout): PublicForm;
```

The projection **strips** `system_key`, `config`, and every registry key. Spec §5: "the browser is told *this step needs a box*, never *this field writes your diagnosis*." `consentGroups` is computed in the page's server render by walking bindings through `consentPurposeFor` — the browser is told which step first asks a group, not which field causes it.

- [ ] **Step 2: `route.ts` — request-time, service-role, no cache.**

```ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  const layout = await resolveFormForJob(jobId);
  if ("fallback" in layout) return Response.json(layout, { status: 200 });
  return Response.json(project(layout), { headers: { "cache-control": "no-store" } });
}
```

Following `/api/careers/questions/route.ts`: a handler that consumes `request.url` is already request-time. Spec §5's rationale: "a recruiter's edit reaches the next page load instead of sitting in a cache window."

- [ ] **Step 3: Commit.**

```
git add src/modules/form-builder/application/publicForm.ts src/app/api/careers/form/route.ts
git commit -m "feat(forms): public form layout read, projected to hide system keys"
```

---

## Task 11: The public upload — `POST /api/careers/form-upload`

**Files:**
- Create: `src/app/api/careers/form-upload/route.ts`

**Interfaces:**
- Consumes: `resolveLayout` (Task 4); `FIELD_TYPES`, `KINDS`, `kindRules` (Task 3); `LIMITS` (Task 2); `getFileStore()` (`src/lib/files/store.ts`).
- Produces: an `uploadId` (the `application_form_files.id` row) the submit path attaches.

- [ ] **Step 1: One route, all field kinds.**

Body: `multipart/form-data` with `jobId`, `fieldKey`, and one `file` part.

Steps:
1. Read the resolved layout for this `jobId` (service role, no cache).
2. Find the field by `fieldKey` and its `type`. Refuse if the type is not `file` or `photo`.
3. Resolve `kinds[]`, `maxBytes`, bucket (photo → `candidate-photos`, file → per `kind` — most file kinds land in `candidate-cvs` or `resumes` — but only the closed vocabulary in `field-types.ts` decides).
4. **Oversize guard before buffering** (content-length header + a stream check, matching `careers/upload`'s approach).
5. Magic-byte sniff on the head bytes.
6. Write via `getFileStore().upload(bucket, \`applications/<jobId>/<uuid>-<sanitised-leaf>\`, stream)`.
7. Insert into `application_form_files` with `application_id = null`, `bucket`, `storage_path`, `field_key`, `mime`, `bytes`, `job_id`.
8. Return `{ uploadId }`.

Spec §5: "The response is an opaque `uploadId`; the browser shows a local object-URL preview and nothing else."

**Never trust the browser's `Content-Type` or `accept`.** Spec §10: "an applicant cannot widen a 5 MB photo field by posting `maxBytes: 1e9`."

- [ ] **Step 2: Refuse on any layout violation.**

If `resolveFormForJob(jobId)` returns `{ fallback: "wizard" }`, the upload route returns `409 Conflict`. Uploading into an unresolved layout would create orphans with no path to a submit.

- [ ] **Step 3: Commit.**

```
git add src/app/api/careers/form-upload/route.ts
git commit -m "feat(forms): public form upload, layout-resolved constraints, opaque uploadId"
```

---

## Task 12: Dynamic apply wizard + per-group consent boxes

**Files:**
- Create: `src/app/careers/apply/[id]/DynamicApplyWizard.tsx`
- Create: `src/app/careers/apply/[id]/fields/<Type>.tsx` — one renderer per type
- Modify: `src/app/careers/apply/[id]/page.tsx`

**Interfaces:**
- Consumes: `PublicForm` from Task 10's projection; `FIELD_TYPES` from Task 3.
- Produces: `<DynamicApplyWizard form={PublicForm} jobId={string} />` and the fallback rule (spec §9).

- [ ] **Step 1: One renderer per field type, shared with the console preview.**

Under `src/app/careers/apply/[id]/fields/`, one component per name in `FIELD_TYPES`, and a single `FieldRenderer.tsx` that dispatches on the type. Spec §"Approaches considered" C: "The renderer is ~6 input components and one switch."

`Geolocation.tsx` implements spec §3's click-only pin button: two boxes always, "Use my location" fills them from the browser **only when clicked**, and the boxes stay overtypable after.

`Duration.tsx` is one number box and one closed unit selector.

Every renderer takes `label`, `help`, `placeholder`, `required`, `options`, and `value`/`onChange` — none take a `systemKey` or `config`.

- [ ] **Step 2: `<DynamicApplyWizard>` — the step rail.**

Walks `form.steps` in order; renders one step per heading; after the builder's own steps, the existing gate-questions step (only if the opening has active gates — the `/api/careers/questions` fetch and `ApplyQuestionsStep.tsx` are untouched); then the fixed Review step with the two hard-coded consents. A layout with no headings is one step under the form's own name (spec §5).

- [ ] **Step 3: Consent boxes derived from the resolved layout's `person:` bindings.**

The page's server render (spec §5) maps bindings through `consentPurposeFor` (spine Task 2) and computes, per group, *which step first asks it*. Each such step opens with a box: group name, why it is asked, that it is not used to score, how to withdraw (all from `noticeFor(group)` — spine Task 4). Two controls: agree, or **"I'd rather not say"**. Neither blocks the submit — refusing hides that group's fields.

- [ ] **Step 4: `page.tsx` selects the wizard.**

```ts
const resolved = await resolveFormForJob(jobId);
if ("fallback" in resolved) return <ApplyWizard ... />;   // today's wizard, unchanged
return <DynamicApplyWizard form={project(resolved)} jobId={jobId} />;
```

Spec §9's table verbatim. Do not delete `ApplyWizard.tsx` — it is the fallback for every opening with no published layout, and for every failure state on the dynamic side.

- [ ] **Step 5: Commit.**

```
git add src/app/careers/apply/\[id\]/
git commit -m "feat(forms): DynamicApplyWizard + per-group consent boxes"
```

---

## Task 13: `submitApplication` extension — order, snapshot, uploadId, person write

**Files:**
- Modify: `src/app/careers/actions.ts`

**Interfaces:**
- Consumes: `resolveLayout` (Task 4), `identityIssues` (Task 5), `normaliseAnswer` (Task 3), `encodeSnapshot` (Task 6), `applyPersonField` and `defaultConsentChecker` (spine Task 5), `personKey`/`normalizePersonEmail` (spine Task 9), `getFileStore()`.
- Produces: `submitApplication` accepts `formUploads: {uploadId: string}[]` and `customAnswers: Record<string, unknown>`; the legacy path at `:507` is untouched.

- [ ] **Step 1: Order in the new submit branch — spec §5's rule.**

```
1. Re-resolve the layout for this jobId → refuse on violations.
2. Validate the system fields with today's rules (unchanged name/email/phone/cv-or-about logic).
3. normaliseAnswer per field, required included.
4. Map bound fields onto applications columns (name/email/phone/about/cv/linkedin/photo).
5. encodeSnapshot for form_answers.
6. Attach the named uploadIds (each must be unattached, this job, this field_key).
7. Build cv_text:
   - if the form has BOTH an `about` and a `cv` field:
     finalCvText = [about answer, linkedInPrefix, extractedCvText].join("\n\n")
   - if only one is bound: that one.
   - if the field is bound but the answer is empty: fall back to today's shape.
8. Insert `applications` (with `form_answers` and the correct `person_id` — resolved from person_emails OR created as a new profile via `applyPersonField`'s resolve-and-create path).
9. **Now** the person write: `applyPersonField(personId, boundPersonAnswers, consent)` at `door: "candidate_form"`, `actorKind: "candidate"`. Refusals and failures here log and return nothing to the candidate. The application stands regardless.
10. Existing gate scoring, `planApplicationConsent` rows, tracking code, referral credit, auto-screening, polite-rejection — all unchanged.
```

Spec §5: "**The person write is last, and it cannot break the application.**"

- [ ] **Step 2: Do NOT change `actions.ts:507`.**

Read it and confirm the diff does not touch it. If the legacy path's `finalCvText = extracted.text;` overwrite moves or is renamed, the change is out of scope. Spec §4: "The legacy path keeps `actions.ts:507` exactly as it is."

- [ ] **Step 3: `uploadId` ownership — spec §10.**

Before step 6, for every `{uploadId}` the request references, read `application_form_files` and assert `application_id is null`, `job_id = <this jobId>`, `field_key = <one of the request's fields>`. Refuse if not.

- [ ] **Step 4: Typecheck + commit.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
git add src/app/careers/actions.ts
git commit -m "feat(forms): dynamic submit path — snapshot last, person write laster"
```

---

## Task 14: Bucket second door — `ownersFor` and `unlinkReference` for form files

**Files:**
- Modify: `src/app/(admin)/files/actions.ts:295` (`ownersFor`)
- Modify: `src/app/(admin)/files/actions.ts:512` (`unlinkReference`)

**Interfaces:**
- Consumes: `application_form_files` (044 applied).
- Produces: form bytes in `candidate-photos` and `candidate-cvs` render as **linked** in `/files`, and deleting a form byte cleans up its ledger row.

- [ ] **Step 1: `ownersFor` — a fourth branch, or a widening of the existing bucket branch.**

`ownersFor` today resolves bytes by matching a **specific column** per bucket (`applications.cv_file_path`, `candidate_responses.video_path`, `application_attachments.storage_path`). A form's file has none of those; it has `application_form_files.storage_path`.

Spec §4: without a dedicated read, a form byte in `candidate-photos` or `candidate-cvs` "would sit in `/files` reporting **unlinked while a row does name it**". Add inside `ownersFor`:

```ts
if (bucket === "candidate-photos" || bucket === "candidate-cvs") {
  // 044 second-door read: rows in application_form_files still on this bucket
  const { data, error } = await restClient
    .from("application_form_files")
    .select("storage_path, field_key, applications(full_name, stage)")
    .eq("bucket", bucket)
    .not("application_id", "is", null)
    .limit(1000);
  if (!error) {
    for (const entry of data ?? []) {
      const row = asRecord(entry);
      const path = stringOrNull(row.storage_path);
      if (!path || map.has(path)) continue;      // existing reads win first
      const app = asRecord(Array.isArray(row.applications) ? row.applications[0] : row.applications);
      map.set(path, {
        label: stringOrNull(app.full_name) ?? "Unnamed applicant",
        detail: `Form upload · ${stringOrNull(row.field_key) ?? "file"}`,
      });
    }
  }
}
```

Rows still carrying `application_id null` keep reading as unlinked, and that one is **true** — the orphan pass owns those.

- [ ] **Step 2: `unlinkReference` — one more target.**

Add inside the switch, alongside `candidate-cvs` and `candidate-photos`:

```ts
case "application_form_files":
  await restClient.from("application_form_files").delete().eq("storage_path", target.storagePath);
  break;
```

Spec §4: without this, "a form field's filename survives in the snapshot pointing at nothing, which is the 404 the spine's own `photo_path` target exists to prevent."

- [ ] **Step 3: Commit.**

```
git add src/app/\(admin\)/files/actions.ts
git commit -m "feat(forms): the public form is the second door into candidate-photos"
```

---

## Task 15: Erasure + access copy

**Files:**
- Modify: `src/modules/privacy/application/erasure.ts:80` (`collectPaths`)
- Modify: `src/modules/privacy/application/accessCopy.ts`

**Interfaces:**
- Consumes: `application_form_files` (044 applied).
- Produces: `collectPaths` counts five reads; the access copy prints `form_answers`.

- [ ] **Step 1: `collectPaths` — the fifth read.**

Spec §8: "`collectPaths` gains **one more** read: `application_form_files` by `application_id`, grouped by its own `bucket` column — the same treatment `application_attachments` already gets".

```ts
const { data: formData, error: formError } = await restClient
  .from("application_form_files")
  .select("bucket, storage_path")
  .eq("application_id", applicationId);
if (!formError) for (const row of formData ?? []) paths.push({ bucket: row.bucket, path: row.storage_path });
```

Task 16's proof 10 asserts five reads exist and each names its own table.

- [ ] **Step 2: Access copy — "what you told us" section.**

Spec §8: the section prints `form_answers` as label → value, filenames for files, and `duration`/`geolocation` printed as one readable line (`45 minutes`, `30.0444, 31.2357`) — "a person asking what we hold is owed a sentence, not their own jsonb". Bounded by the existing caps.

A `person:`-bound answer appears in **two** access copies (this slice's snapshot + the spine's §8.2 current read). Spec §8: "They disagree by design the moment the profile moves on, and a candidate reading both should see exactly that." Do not attempt to reconcile.

- [ ] **Step 3: Commit.**

```
git add src/modules/privacy/application/erasure.ts src/modules/privacy/application/accessCopy.ts
git commit -m "feat(forms): erasure finds form bytes, the access copy prints the answers"
```

---

## Task 16: `prove-form-builder.mjs` — every §Proof check, house style

**Files:**
- Create: `scripts/prove-form-builder.mjs`

**Interfaces:**
- Consumes: every module from Tasks 1–15; the two migration files' text.
- Produces: 19 numbered checks + 18 mutation proofs, printing `N checks passed` and exiting non-zero on any fail.

- [ ] **Step 1: Copy the shape of `scripts/prove-offers.mjs`.**

`registerHooks`, `check/equal/has/lacks`, banner `/* N. Title */` sections each in a `{ }` block, tail counts + `process.exitCode = 1`.

- [ ] **Step 2: Nine domain checks (spec §Proof 1–9).**

1. `resolveLayout` order deterministic across two runs; globals before assignments; `global_position` then id; `position` then name.
2. Duplicate `key` across two forms → violation naming both; duplicate `system_key` likewise; unique keys → clean.
3. `identityIssues` for each §4 bullet including: `cv`-or-`about`, type-mismatched binding, unknown `person:` key, consent-gated binding marked `required`, `list` key on non-`multi_select`, and a `duration` or `geolocation` field carrying any binding at all.
4. `normaliseAnswer` boundary values per type, driven by `FIELD_TYPES`. Asserts `FIELD_TYPES` names === 044's `type` CHECK names (source-grepped, comments stripped). Then the four newest: `time` accepts `00:00` and `23:59`, refuses `24:00`, `9:30`, `09:30:45` and `9:30 PM`; `percentage` refuses 101, −1, and 3 decimals; `duration` accepts `{45,minutes}` and `{1,hours}` as the same minute total and refuses a 7th unit, 0 and 10000; `geolocation` accepts `30.0444, 31.2357`, clips to 6 dp, refuses lat 91 and lng −181.
5. `kinds` → accepted types + byte ceilings; unknown kind refuses.
6. Snapshot round-trip; malformed entries dropped, including a truncated `{value}` or `{lat}` pair.
7. Every ceiling in §11 enforced by name, not by inline number.
8. Binding map: registry is the only tier/group source; consent groups derived from bindings; a layout with no bindings needs no box; the keys that append are exactly the `list` keys.
9. The rung: with a value already held by `hand_record`, `candidate_form` reports a conflict and the held value stands; empty field accepts; against a `cv_extraction` value it wins. In all three the application's snapshot keeps the incoming answer.

- [ ] **Step 3: Ten wiring checks (spec §Proof 10–19).**

Every source-grepped, **comments stripped before matching** (spec §Proof 10's "Pinned as code, not prose" rule).

10. `collectPaths` reads `application_form_files`; 044 replaces `erase_candidate_data` to blank `form_answers` and delete those rows; the same read proves it does **not** null `applications.person_id`.
11. The upload route resolves its constraints from the layout (a needle that the accept list is *not* taken from the request body).
12. The public projection omits `system_key`, `config`, and every registry key.
13. `/forms` appears in `NAV`, `STAFF_ROUTES`, the Guide and the live areas, **and the staff-route count pin is derived from the directory listing** — exactly as `prove-job-distribution.mjs` section 8 already does. Read the directory, count `page.tsx` files, assert 19.
14. `form_authoring` exists in `AiCapability`, `modelChains`, and the routing console.
15. The two fixed consent boxes and the Review step are not produced by any builder component; the per-group boxes come only from a layout containing a binding, and their copy is `noticeFor(group)` from the spine, not a string in this slice.
16. The dynamic submit builds `cv_text` from **both** the About answer and the extracted CV; `actions.ts:507`'s legacy overwrite is untouched.
17. `candidate-photos` sits in `BucketKey`, `BUCKETS`, `ownersFor`, `unlinkReference` and 043's `files` policies (the five are the spine's; this check asserts they are still present). 044's three: anon `files` insert policy for `candidate-photos` (`to anon`, an `insert`, constraining the `applications/` path prefix); an `ownersFor` read of `application_form_files` where `application_id is not null`; an `unlinkReference` target that deletes the ledger row.
18. Retention route has an orphan pass over `application_form_files` with `application_id is null`, its window comes from `limits.ts`, removes bytes through `getFileStore().remove` **before** deleting the row, and is **not** gated behind `privacy.retention_enabled` — while the two existing passes are.
19. `submitApplication` calls `applyPersonField` with `door: "candidate_form"` and the consent checker, and the call sits **after** the `applications` insert (a needle on the order).

- [ ] **Step 4: Eighteen mutation proofs (spec §Proof "Mutation proofs").**

Each: mutate → the specific check that owns the rule turns red → restore the file. Same `mutate(file, needle, replacement, () => expectFails(...))` helper as the spine proof, with a `finally` that restores the file before the gates run. The full list, with the check each one turns red:

1. Swap the two assignment orders in `resolveLayout` (assignments before globals) → check 1 fails.
2. Rename a key so two fields collide → check 2 fails.
3. Drop the `cv`-or-`about` clause from `identityIssues` → check 3 fails.
4. Set a ceiling one higher than the check reads → check 7 fails.
5. Delete the `application_form_files` read from `collectPaths` → check 10 fails.
6. Feed the upload route a client-sent `accept` (make it read the request body instead of the layout) → check 11 fails.
7. Remove `/forms` from `STAFF_ROUTES` → check 13 fails.
8. Drop the About answer from the merged `cv_text` (revert the dynamic path to `extracted.text` only) → check 16 fails.
9. Take `candidate-photos` out of `BucketKey` while leaving its descriptor → check 17 fails. This place is 043's, and this slice's check still catches it.
10. Make the orphan pass delete the row **before** removing the bytes → check 18 fails — **interesting**: a sweep that unlinks the metadata and leaves the photo on the disk.
11. Put the orphan pass back behind `privacy.retention_enabled` → check 18 fails — **interesting**: an orphan pass quietly gated behind a switch that ships off.
12. Move the `applyPersonField` call **above** the `applications` insert → check 19 fails — **interesting**: a person write that can veto an application by running first.
13. Let the 044 rewrite of `erase_candidate_data` null `applications.person_id` too → check 10 fails.
14. Promote `candidate_form` to the top rung → check 9 fails — **interesting**: an anonymous door promoted into the authority to rewrite a stranger's profile.
15. Mark a health-group binding `required` and let it publish → check 3 fails.
16. Drop the anon `files` insert policy while leaving the bucket registered → check 17 fails.
17. Add an eighth name to 044's `type` CHECK without writing its normaliser → check 4 fails.
18. Let a `duration` field carry a `person:` binding, so it reaches the writer with an object where a scalar column waits → check 3 fails.

Of these, five are called out by the spec as the interesting ones because nothing else in a build notices: mutations 9 (a bucket that exists but is unlisted), 10 (the sweep that leaves the photo), 11 (the orphan pass behind a switch that ships off), 12 (the person write that vetoes an application by running first), and 14 (the anonymous door promoted to rewrite a stranger's profile).

- [ ] **Step 5: Run the proof.**

```
node --env-file=docker/.env --experimental-strip-types scripts/prove-form-builder.mjs
```

Expected: `19 checks passed` and exit 0 (mutations applied and reverted).

- [ ] **Step 6: Commit.**

```
git add scripts/prove-form-builder.mjs
git commit -m "test(forms): prove-form-builder — 19 checks and 18 mutation proofs"
```

---

## Task 17: Whole-slice gate + live proof

- [ ] **Step 1: Run every gate.**

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
npm run lint
node --experimental-strip-types scripts/prove-form-builder.mjs
node --experimental-strip-types scripts/prove-job-distribution.mjs
node scripts/check-staff-routes.mjs
```

Expected: tsc reports no new errors; lint's two tolerated warnings only; `prove-form-builder.mjs` prints `19 checks passed`; `prove-job-distribution.mjs`'s 132 checks stay green with the staff-route pin reading 19 from the directory listing; `check-staff-routes.mjs` prints `19 pages, 19 guarded, 8 on the rail`.

- [ ] **Step 2: Report at the migration-approval gate.**

Migration 044 is authored but not applied. The spec's live proof needs 041, 043 and 044 all applied. Do **not** apply any of them without the owner's per-file approval.

Report: "044 authored, all offline gates green, awaiting owner approval for 041/043/044 before the live proof runs."

- [ ] **Step 3: Commit the plan itself.**

```
git add docs/superpowers/plans/2026-10-25-application-form-builder.md
git commit -m "docs(plan): application form builder implementation plan"
```

- [ ] **Step 4: Once the owner approves, run the live proof in this exact order (spec §"Live proof").**

1. Apply 041 (already applied? verify — if not, apply).
2. Apply 043 (person-profile spine).
3. Apply 044 (form builder).
4. Draft a form in `/forms`; fail publish on the identity contract; fix it; publish.
5. Bind a field to a registry key and try marking a health-group question `required`; publish refuses.
6. Assign it to an opening; confirm the duplicate-key refusal when the layout collides with the "Personal details" seed form's `name` binding.
7. Apply as a candidate with a photo and a file; decline one consent group; submit anyway.
8. Confirm the application filed; that group's fields never rendered; `person_consents` holds no agreeing row for it.
9. Read the row back in `/candidates`; the snapshot renders the questions as asked.
10. Erase that application. Confirm the `candidate-photos` byte is gone from `$UPLOADS_ROOT` while `applications.person_id` still points at a profile that is **not** erased.

Spec §"Live proof": "**that last pair of facts is the slice's actual point**, that the byte went and the person did not."

---

## Not in this plan

Spec's *Not in this slice*: conditional fields, branching beyond linear steps, per-field translations, scoring or gating inside a form, immutable published versions, assistant tools for `/forms`, form answers as report or analytics columns or CSV export, reference/FK / password / rich-text / JSON types, rewriting existing applications, hardening the pre-existing `cvFilePath` door, any candidate-portal surface.

Spec's *Known limits*: platform-global authoring with no company scoping; editing a published layout while candidates are mid-form can invalidate a key; `form_answers` is a snapshot of labels so a renamed label renders the old wording on old applications; the `candidate-photos` bucket is a closed union this slice does not register (Task 14's `ownersFor`/`unlinkReference` and Task 1's anon policy are this slice's three additions and only those); erasing an application whose form was deleted still works; the legacy `actions.ts:507` overwrite still discards the pasted About text — the dynamic path fixes it for forms and the fallback keeps today's behaviour; one cron pass ignores a setting.
