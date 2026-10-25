# Application form builder

**Date:** 2026-10-25
**Status:** Approved design — amended the same day after the person-profile spine; implementation plan not yet written
**Amended:** 2026-10-25, per [the person-profile spine spec §13](2026-10-25-person-profile-spine-design.md). That slice is designed first and owns migration `043`, so this one becomes `044`, and the `candidate-photos` bucket it once claimed is now the spine's. The amendment touches the migration number, the bucket's ownership, the byte-read count, and where an answer's *person facts* are written; it changes none of the six decisions and no field type, layout rule, ceiling, console behaviour or fallback.
**Scope:** one slice — recruiters author the questions a candidate answers when they apply, assign those forms to an opening or to every opening, and the public apply page renders what was authored. One migration (`044`, **not authored yet** — `db/migrations/` stops at `042_offers.sql` on the day this was written, and `043` is the spine's), five tables and one column, one pure domain module, one new staff page (`/forms`), two new route handlers (a public layout read, a public upload), one new AI capability, and one new pass on the existing retention sweep. The `candidate-photos` bucket is created by `043`, not here. The candidate portal is not touched.

---

## Why

The apply flow is fixed. `src/app/careers/apply/[id]/ApplyWizard.tsx:61` declares
the entire candidate experience as four steps — `about`, `cv`, `questions`,
`review` — and `ApplyInput` (`src/app/careers/actions.ts:260`) is the only
vocabulary a submission can carry: name, email, phone, pasted CV text, a LinkedIn
link, a CV file path, gate answers, two consents. A recruiter who needs a
candidate's visa status, shift acceptance, licence class, years at a front desk,
or a photo has exactly one tool: a gate question, which is yes/no, is scored, and
lives in a different table answering a different purpose.

Every hiring platform the research looked at solves this with a form builder, and
the reason it matters is not convenience. A receptionist role needs a photo and a
height; a driver role needs a licence number and an expiry date; a night role needs
a shift declaration. Without those fields at the door, the recruiter learns them
on a phone call — after the AI has already screened a CV that never mentioned them.

The gap is not storage. `applications` is a wide table and PostgREST writes jsonb
easily. The gap is that nothing in the platform authors a field, resolves which
fields an opening asks, renders an arbitrary field, or — the part that makes this
an architectural change rather than a form — **finds and deletes the bytes a custom
field collects when a person asks to be erased.**

## What the platform already has

| Fact | Where |
| --- | --- |
| `applications` carries the canonical identity columns a form must write into | `db/schema.sql:205` (`full_name`, `email`, `phone`, `cv_text`, `cv_file_path`, `gate_answers`) |
| One live application per person per role | `db/schema.sql:1401` (`applications_one_live_per_job`) |
| The apply flow is four hard-coded steps | `src/app/careers/apply/[id]/ApplyWizard.tsx:61` |
| Submission validation, insert, consent planning, gate scoring, auto-screening | `src/app/careers/actions.ts:377` onward |
| A public table already scoped "global or one job", with `is_active` retirement instead of deletion | `db/migrations/018_application_gate_questions.sql` |
| Authoring is gated by a permission that takes no company argument | `db/schema.sql:1237` (`has_permission(text)`), write policy at `db/schema.sql:1513` |
| Pure domain module shared by three callers that must not disagree, with the pass/fail flags stripped before the browser | `src/modules/careers/gate-questions.ts` |
| Anonymous read of public rows through a route handler, deliberately outside the page cache | `src/app/api/careers/questions/route.ts` |
| Storage is a disk seam: `$UPLOADS_ROOT/<bucket>/<path>` plus metadata rows in `public.files` | `src/lib/files/store.ts:32` (upload / signedUrl / download / remove / list) |
| Four buckets in use; the local store enforces **nothing** but path containment | `src/modules/careers/attachment-rules.ts` (header comment) |
| Uploads are magic-byte sniffed, because three live applications hold a web page saved as `CV.pdf` | `src/app/api/careers/upload/route.ts` |
| Erasure deletes every byte before it blanks the row, and the byte list is **enumerated by name** | `src/modules/privacy/application/erasure.ts:80` (`collectPaths`) |
| The database function that blanks the row | `db/migrations/041_privacy.sql:359` (`erase_candidate_data(uuid)`) |
| Native HTML5 drag-and-drop, no library, gated by `canWrite` | `src/app/(admin)/candidates/CandidateBoard.tsx`, `src/app/(admin)/questions/BankColumns.tsx` |
| AI authoring that validates a model's JSON into reviewable drafts and never writes | `src/modules/assessment/domain/aiAuthoring.ts` |
| A new staff page is four tables that must agree | `src/modules/analytics/presentation/nav.ts:55`, `src/lib/auth/staffRoutes.ts:28`, the Guide manual, the live-watch areas |
| The nav/page-directory parity check runs as `prebuild`, not under bare `next build` | `scripts/check-staff-routes.mjs` |

## What the platform does not have

- No form, field, or step table of any kind. `application_attachments` holds
  *files*, not questions; `application_gate_questions` holds *scored yes/no filters*.
- No column to put custom answers in. There is no jsonb answers bag on
  `applications` beyond `gate_answers`, which has a different meaning.
- No place a custom uploaded file would be recorded. `collectPaths`
  (`erasure.ts:80`) reads exactly three sources — `applications.cv_file_path`,
  `candidate_responses.video_path`, `application_attachments` — so a photo buried
  in a jsonb answer is **invisible to erasure**. This is the fact that decides the
  data model.
- No generic field renderer. Every input on the apply page is hand-written for
  its one purpose (`ApplyAboutStep.tsx`, `ApplyCvStep.tsx`, `ApplyQuestionsStep.tsx`).
- No `form_authoring` AI capability. `AiCapability`
  (`src/lib/config.ts:48`) has nine values and none is this.
- No image content sniffer. The existing sniff (`cvContentError`) knows documents;
  a photo field needs PNG/JPEG/WebP/GIF magic bytes, which nothing writes today.

## The constraint that decides the design

> **Any byte this feature collects, the privacy engine must be able to find and
> delete without being told it exists.**

`eraseApplication` is order-critical and unforgiving: it resolves every storage
path a record points at, removes the bytes, and *aborts before blanking the row*
if any removal fails (`erasure.ts:170`). The list of places paths live is hard
coded. So a design that puts a photo's storage key inside `applications.form_answers`
jsonb would make the erasure engine silently wrong — the candidate is told they
are erased while their face sits on the disk. PostgREST cannot query inside a jsonb
array of answers, so `collectPaths` could not even find it.

The same argument decides three smaller things: file rows go in their own table
(not the shared `application_attachments`, whose rows are staff-authored and keyed
by `application_id`, which does not exist yet when an anonymous applicant uploads);
the erase function is replaced in the same migration that creates the table (not
"later"); and the access copy must print the answers, because
`readApplications` (`accessCopy.ts:66`) currently selects name, email, phone,
stage, date, score and summary — a copy of "what we hold" that omits a photo is
not a copy of what is held.

## Approaches considered

### A — Extend the fixed wizard with an optional "extra questions" list
A recruiter authors a list of fields; the wizard keeps its four steps and renders
the extras inside step one. Cheap, no fallback risk. Rejected by the user's own
decision: the extras can never add a step, reorder the flow, or own the identity
fields, so the builder is a footnote rather than a builder.

### B — Fully dynamic application (chosen)
The builder defines the whole apply flow. The four fixed steps retire for any
opening whose layout resolves; the wizard renders from the resolved schema. This
is what "form builder" means to a recruiter, and it is the only version where the
photo and the address actually arrive. Its cost is the bootstrapping hazard, and
§9 closes it with a seeded form plus a fallback to the wizard that exists today.

### C — Import a form library or store a vendor-shaped JSON blob
`@formkit`, `react-hook-form` schemas, or a `fields_json` column. Rejected: a blob
is the jsonb trap above (unqueryable, therefore unerased), and a vendor schema
would put a dependency between the public application flow and a package the
platform does not control. The renderer is ~6 input components and one switch.

### The decision

B, with the identity contract in §4 fixing the parts that must never be editable,
and one pure function (`resolveLayout`, §5) being the only place the stack of
forms is composed.

---

## The six decisions

These were each put to the user and chosen; they are recorded here because every
later section follows from one of them.

1. **Fully dynamic application.** The builder defines the apply flow; the fixed
   four steps retire behind a fallback, they do not coexist as a hybrid.
2. **Identity contract, fixed consent.** System fields bind to canonical columns;
   publishing is refused unless the contract holds. The consent boxes and the
   Review step are not builder fields and cannot be deleted. Gate questions stay
   a separate scored surface in the Question Bank.
3. **Ordered stack, unique keys.** Global forms first in their own order, then the
   opening's assigned forms in assignment order. A field key is unique across the
   whole resolved layout, and an assignment that would duplicate one is refused
   with the offending field named. Global forms are always asked — no per-job opt-out.
4. **17 application-safe types.** §3. Password, auto-increment/ID, reference/FK,
   JSON/document and rich text/HTML are excluded *deliberately*, not forgotten.
5. **Drafts, edits go live, answers snapshot.** `DRAFT` until the contract passes,
   then `PUBLISHED`; an in-place edit reaches the next page load and bumps
   `version`; every submission stores a self-describing snapshot so a six-month-old
   application renders what was actually asked. Assignment offers `PUBLISHED` only.
6. **`/forms` is its own staff page.** Not a tab on `/questions`, not a panel on
   `/jobs` (though `/jobs` gets an assignment door into it).

---

## 1. Data model

One migration, `db/migrations/044_application_forms.sql`, to be authored when this
plan is executed and **not applied** — applying it needs the owner's per-file
approval like every migration since 031. Five tables and one column.

**It applies after `041` and after `043`.** 041 for the reason in §8 (this
migration replaces a function 041 defines); 043 because the `candidate-photos`
bucket, its `files` policies and its `person_profiles.photo_path` column are that
slice's, and because §4's `person:` bindings write into tables only 043 creates.

### 1.1 `application_forms` — the container

```sql
create table if not exists public.application_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  -- True: asked on every open role. False: only where it is assigned.
  is_global boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  -- Bumped by every layout save and by publish. Recorded in each snapshot.
  version integer not null default 1 check (version > 0),
  global_position integer not null default 0,
  -- Retirement, never deletion: applications still carry this form's answers.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

No company column, exactly as `application_gate_questions` (018) has none: the
write policy is `has_permission('jobs.manage')`, and that function
(`db/schema.sql:1237`) takes only a permission name. Forms are therefore
platform-global authoring — see *Known limits*.

### 1.2 `application_form_fields` — the whole layout, flat

```sql
create table if not exists public.application_form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.application_forms (id) on delete cascade,
  -- Generated once, never rewritten on rename. This is the snapshot's join key.
  key text not null check (char_length(key) between 3 and 60),
  type text not null check (type in (
    'short_text','long_text','email','phone','url','number','currency',
    'date','datetime','select','radio','multi_select','checkbox',
    'file','photo','address','section_heading')),
  label text not null check (char_length(btrim(label)) between 1 and 200),
  help_text text,
  placeholder text,
  required boolean not null default false,
  -- Per-type settings: options, min/max, accept kinds, address components.
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  -- The canonical destination this field writes. Null for ordinary fields.
  -- The seven bare keys are columns on `applications`, as decided before this
  -- amendment. A `person:<key>` binding is the spine's registry key and lands in
  -- a person table through its writer — see §4.
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

**There is no sections table.** The step divider is the `section_heading` field
type, and the flat ordered list *is* the layout: a step is the heading plus the
fields that follow it until the next heading. Two tables would have meant two
position sequences to keep in agreement, a two-list drag-and-drop, and an
`ON DELETE` question about fields whose section was removed. A heading carries
`label` (step title) and `help_text` (step guidance) and cannot be answered.

**`unique (form_id, key)` is half of decision 3.** The database can guarantee a key
is unique *inside* a form; uniqueness across a resolved layout spans rows of
several forms and cannot be a constraint. That half lives in `resolveLayout`'s
violations (§2), checked at the save door, the publish door and the assignment door
— and again at submit, because a layout that resolved cleanly when it was assigned
can stop resolving cleanly when a third form becomes global.

### 1.3 `job_application_forms` — the assignment

```sql
create table if not exists public.job_application_forms (
  job_id uuid not null references public.job_openings (id) on delete cascade,
  form_id uuid not null references public.application_forms (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (job_id, form_id)
);
```

`form_id` is checked non-global by the action, not by the database: a global form
is asked everywhere by definition, so assigning it to one role would silently mean
"only this role", the opposite of the flag. The pair being the primary key makes a
double-assign impossible; `position` is the recruiter's order within the opening.

### 1.4 `application_form_files` — the byte ledger erasure reads

```sql
create table if not exists public.application_form_files (
  id uuid primary key default gen_random_uuid(),
  -- Null between the upload and the submit. The retention sweep clears these.
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

Every file or photo field writes a row here and nothing else. No storage key ever
goes into a jsonb — that is the whole reason the table exists (§*constraint*).

### 1.5 `applications.form_answers` — the snapshot

```sql
alter table public.applications
  add column if not exists form_answers jsonb;

comment on column public.applications.form_answers is
  'What the candidate actually answered, as the form asked it: {fields:[{key,label,
  type,value,systemKey}], forms:[{id,name,version}], resolvedAt}. Written once at
  submit and never rewritten, so an application renders the questions it was filed
  against even after the form is edited, retired, or deleted.';
```

An **object**, not a bare array, because the snapshot has to name the forms and
their versions alongside the answers — that is what makes "edits go live" safe.
File fields contribute `{key, label, type:'file', value:'<sanitised filename>'}`;
the bytes stay in §1.4.

### 1.6 RLS

Same shape as 018, because the same two callers exist — an anonymous applicant who
must read the layout, and a recruiter with `jobs.manage`.

- `application_forms` — `select using (is_staff() or (status = 'PUBLISHED' and archived_at is null))`.
- `application_form_fields` — visibility lives on the parent, so the anon read is
  an existence check rather than a row flag: `select using (is_staff() or exists
  (select 1 from public.application_forms f where f.id = form_id and f.status =
  'PUBLISHED' and f.archived_at is null))`. 018 could put `is_active` on the row
  itself; a field cannot, because deactivating a form must not deactivate its
  fields' rows one by one.
- `job_application_forms` — `select using (is_staff() or exists (select 1 from
  public.application_forms f where f.id = form_id and f.status = 'PUBLISHED' and
  f.archived_at is null))`; a stranger has no reason to read assignments, so this
  policy is defence in depth, not the access path.
- `application_form_files` — `select using (is_staff())`. Bytes and paths are never
  anonymous-readable, and the erasure engine reaches it with the service role
  exactly as it already reaches `application_attachments`.
- Writes on all five: `has_permission('jobs.manage')`, plus the `insert`/`select`
  grant `applications` needs for the submit path — which is the service role, so no
  anon write policy exists on any of these tables.

**The public read is not the anon role.** The apply page and the submit action read
through the **service** role, as `activeGateQuestions` (`actions.ts:296`) already
does, because "which fields does this opening ask" is decided by `resolveLayout`
and must be decided identically on both sides of the write. The policies above are
what a stolen anon key would see; the code path a candidate actually takes is the
service read plus §5's public projection, which strips `system_key`, `config` and
the table shape before anything reaches a browser.

### 1.7 Seed

044 inserts one `PUBLISHED`, `is_global` form named **Personal details** holding
`section_heading`, `name`, `email`, `phone`, `cv` (file, kinds `pdf|doc`),
`about` (long_text) and `linkedin` (url) — the fields the fixed wizard collects
today, expressed as the first published form. Version 1, `global_position` 0.

## 2. The one read that composes it

`resolveLayout` is the single function that decides what an opening asks. The
apply page, the submit action, the builder's conflict check and the assignment
door all call it, so none of them can disagree — the same reason
`src/modules/careers/gate-questions.ts` is one module with three callers.

```ts
resolveLayout(input: {
  forms: readonly FormRow[];           // PUBLISHED, not archived
  fieldsByForm: Readonly<Record<string, readonly FieldRow[]>>;
  assignments: readonly { jobId: string; formId: string; position: number }[];
  jobId: string;
}): ResolvedLayout

type ResolvedLayout = {
  steps: ResolvedStep[];               // heading + its fields, in order
  fields: ResolvedField[];             // flat, in answer order
  violations: LayoutViolation[];       // duplicate key/system, contract breach, ceilings
};
```

Order is decision 3 and nothing else: global forms in `global_position` then id
order, then the opening's assigned forms in `position` then form-name order.
Within a form, `position` then key. A tie is broken by id so two runs of the same
read cannot disagree.

`violations` is never swallowed. The apply page treats a non-empty list as "render
the built-in wizard" and logs the reason; the submit action treats it as a refusal;
the builder and the assignment door print it with the offending field named. Same
data, three honest reactions — a stranger gets a form that works, a write never
lands on a broken layout, and the recruiter sees the sentence that explains both.

## 3. The seventeen types

| Type | `config` | Normalised value | Notes |
| --- | --- | --- | --- |
| `short_text` | `maxLength` ≤ 300 | trimmed string | |
| `long_text` | `maxLength` ≤ 5000, `rows` 2–8 | trimmed string | **plain text only** — no HTML, ever |
| `email` | — | lowercased, `EMAIL_PATTERN` | same pattern as `actions.ts:284` |
| `phone` | — | digits, `+`, spaces; 7–20 | |
| `url` | `hostHint` | absolute http(s) URL, ≤ 500 | |
| `number` | `min`, `max`, `decimals` 0–2 | decimal string | merges Integer + Decimal |
| `currency` | `min`, `max`, `currencyCode` (ISO-3, default `EGP`) | decimal string | the code is stored, the symbol is not |
| `date` | `min`, `max` (ISO) | `YYYY-MM-DD` | must be a real calendar day |
| `datetime` | `min`, `max` (ISO) | RFC 3339 | the org timezone from `organisation.timezone` |
| `select` | `options[]` 2–30 | one offered label | |
| `radio` | `options[]` 2–30 | one offered label | |
| `multi_select` | `options[]` 2–30, `minSelections`, `maxSelections` | array of offered labels | |
| `checkbox` | `mustBeTrue` | `'true'` / `'false'` | one declaration, not a group |
| `file` | `kinds[]`, `maxBytes` ≤ 10 MB | filename in the snapshot; bytes in §1.4 | |
| `photo` | `maxBytes` ≤ 5 MB | as `file` | images only, own bucket |
| `address` | `components[]` ⊆ line1/line2/city/region/postalCode/country | one joined, trimmed line | structured input, one stored value |
| `section_heading` | — | not answerable | the step divider (§1.2) |

`kinds` is a **closed vocabulary**, not author-typed MIME strings: `pdf`, `doc`,
`sheet`, `slides`, `image`, `audio`, `video`, `text`, each mapping to a fixed set
of accepted types plus its magic-byte sniff and byte ceiling — the same discipline
`src/modules/careers/attachment-rules.ts` applies, whose header records that these
rules are now *the only* size and type enforcement a byte gets. An author cannot
ask for `.exe`, and the client's `accept` is derived from the kind, never sent by
the browser.

Excluded, and why: `password` (we would be storing a secret we cannot hash or
rotate, in a table a candidate can ask to be read out of), auto-increment/ID
(nothing to reference), reference/FK (cross-record integrity is not a form's job),
JSON/document (a field the renderer cannot render and the eraser cannot erase),
rich text/HTML (the public page would be rendering stranger-authored markup —
`dangerouslySetInnerHTML` on a careers form is an XSS we would be shipping on
purpose).

## 4. System fields and the identity contract

Seven `system_key`s, each pinned to one type, each writing where the fixed wizard
writes today:

| `system_key` | type | destination |
| --- | --- | --- |
| `name` | `short_text` | `applications.full_name` |
| `email` | `email` | `applications.email` |
| `phone` | `phone` | `applications.phone` |
| `about` | `long_text` | `applications.cv_text` |
| `cv` | `file` (kinds `pdf\|doc`) | `applications.cv_file_path` + text extraction into `cv_text` |
| `linkedin` | `url` | prepended to `cv_text` — `actions.ts:528`, unchanged |
| `photo` | `photo` | `application_form_files` in `candidate-photos` |

`photo` gets **no column on `applications`**. It is a file, files live in §1.4,
and `collectPaths` reads §1.4. That is the difference between a photo that can be
erased and a photo that cannot.

**The `candidate-photos` bucket is not created here.** The spine's `043` registers
it — the union member, the descriptor, `ownersFor`, `unlinkReference`, and its
staff-side `files` policies — so `044` adds exactly one thing to it: the anon
insert policy that lets a candidate who is not signed in file a byte at all (the
apply page has no session; `careers/upload` already needs the same shape for the
CV). One bucket, one disk contract, one erasure read per byte. The path stays
`applications/<jobId>/<uuid>-<leaf>` — per-application, **not** the spine's
`persons/<personId>/…` — because at upload time nobody yet knows whether this
applicant is an existing person or a new one, and an unsubmitted photo must be
removable without touching a profile (§8's orphan pass). `person_profiles.photo_path`
is written only by the spine's writer, never by this one.

### 4.1 `person:` bindings — where a person fact goes

A `system_key` may also be `person:<registry key>` (`§1.2`'s CHECK). That is the
only route by which an authored field becomes a fact about the *human* rather than
an answer on *this application*:

- the key must exist in `PERSON_FIELDS` (`src/modules/candidates/domain/person-fields.ts`),
  and the field's type must be the type the registry declares for it — a `date_of_birth`
  binding is a `date` field or the write is refused at publish;
- the answer is written through `applyPersonField(personId, changes, consent)` with
  `door: "candidate_form"`, `actorKind: "candidate"` — a rung **below** a recruiter's
  hand, and the spine's §3.3 says why: this door knows an address, not a person. The
  form creates a profile, beats a model's reading and the backfill, replaces what the
  same mailbox typed on the last application, and loses to a value a recruiter put
  there by hand. The application's own snapshot keeps the answer either way;
- the same value is still snapshotted into `form_answers`, so the application keeps
  showing the questions it was filed against (§1.5) even after the profile moves on;
- the rest of the form — every field with no `system_key` — lands only in
  `form_answers`. Custom questions stay per-application; identity and background
  become per-person. That is the whole amendment: the form is one of the spine's
  doors, not a second store.

An authored field bound to a Tier-3 registry key (a disability, a blood type, a
family plan) is collectable, and the consent box beside it is what makes it lawful —
see §5. Nothing here lets a form field into a prompt or a report column: the §10
boundary holds, and the spine's registry is what the proof scans for Tier-3 keys.

**When both `about` and `cv` exist, `cv_text` carries both.** Today a file's
extracted text *replaces* the pasted text: `finalCvText = extracted.text`
(`actions.ts:507`) discards whatever the candidate wrote in the About step. The
dynamic path must not inherit that — the contract explicitly allows a form to bind
both, and "attach a CV and tell us about yourself" is the first thing a recruiter
will build. So the dynamic submit files `cv_text` as the About answer, then the
extracted CV text, in that order, under a fixed separator the drawer and the
screening reader already tolerate. The legacy path keeps `actions.ts:507` exactly
as it is: changing it would silently re-file how every existing application reads,
and that is an owner decision, not a side effect of this slice — see *Known limits*.

`identityIssues(fields)` returns every contract breach, phrased for a recruiter,
and is called by the publish action, the assignment door and the submit action:

- exactly one `name`, required; exactly one `email`, required;
- at least one of `cv` / `about`, and whichever is present is required — this is
  `actions.ts:396` ("attach a CV or paste its text") expressed as an author-time
  rule instead of a submit-time surprise;
- at most one field per `system_key` in the **resolved layout**, not merely per
  form — two forms each binding `email` is decision 3's collision and the contract
  catches it by the same read;
- `phone`, `photo`, `linkedin` are the author's choice;
- a `person:` binding is the author's choice too, and **satisfies no part of the
  contract** — `person:name` is not `name`. The identity of the human is established
  by the `name`/`email` fields exactly as today, and `applyPersonField` is only
  reached once that person is resolved (§4.1);
- a `person:` key absent from the registry, or bound to a field whose type is not
  the registry's, is an issue naming the field — an author cannot invent a column;
- a field bound to a **consent-gated group** (any group the spine's checker guards —
  health, family, and the rest of Tier 3) may not be `required`. Making the medical
  questions mandatory trades a person's health data for an interview, and §5's
  "I'd rather not say" must stay a answer that does not block the application;
- a bound field's type must be the pinned type above;
- no `section_heading` may carry a `system_key`; and if the form contains any
  heading, no answerable field may precede the first one — it would sit in a step
  with no title. A form with **no** headings at all is legal and is one step named
  after the form (§5), which is why this is a conditional rule rather than a
  requirement to start with a heading.

Publishing is refused while any issue stands, and the refusal names the field by
label. **Consent and Review are not in the contract because they are not in the
builder**: the two consent boxes (`planApplicationConsent`) and the Review step
stay hard-coded, non-deletable, and outside every form. No recruiter can author
away a legal basis for processing. The per-group boxes §5 adds are generated by
the registry from the resolved layout, so they are outside the author's reach in
the same way — a form that asks health facts gets the health box whether or not
its author thought of it, and a form that asks none never shows one.

## 5. The public apply page

`src/app/careers/apply/[id]/page.tsx` resolves the layout and hands it to a new
`<DynamicApplyWizard>`; the existing `ApplyWizard.tsx` stays exactly as it is and
becomes the fallback (§9).

- **Steps.** One `section_heading` = one step, in resolved order. Then the
  existing gate-questions step (only when the opening has active gate questions —
  the `/api/careers/questions` fetch and `ApplyQuestionsStep.tsx` are untouched),
  then the fixed Review step with the two consents. A layout with no headings is
  one step under the form's own name.
- **Consent groups, derived not authored.** The page's server render maps the
  resolved layout's `person:` bindings through `consentPurposeFor` and passes the
  wizard one thing per group: *which step first asks it*. That step opens with a
  box — the group's name, why it is asked, that it is not used to score, how to
  withdraw, all from the spine's notice file, plus two controls: agree, or **"I'd
  rather not say"**. Neither is a submit blocker: refusing a group hides its fields
  and the writer refuses them anyway, which is the same outcome as leaving them
  blank and the one a candidate must be able to choose and still apply. A tick is
  recorded as a `person_consents` row for that `personId` through the spine's own
  consent checker — newest-row-wins against the current notice version — and the
  write reads back through that same checker, never a second one. A layout with no
  `person:` bindings renders no box, so today's form looks exactly like today's
  wizard.
- **A new public read.** `GET /api/careers/form?jobId=…`, shaped like
  `/api/careers/questions`: a route handler with a service-role read. Being a
  handler that consumes `request.url` makes it request-time, which is the point —
  the same reason the questions route is a handler rather than part of the cached
  job page (`/api/careers/questions/route.ts` carries no `connection()` and no
  cache): a recruiter's edit reaches the next page load instead of sitting in a
  cache window. It emits the *public projection* only — label, help, placeholder,
  type, required, the derived `accept`, options as labels. No `system_key`, no
  `config.maxBytes`, no table names — and no registry key: the consent-group map
  above is computed in the page's server render, so the browser is told *this step
  needs a box*, never *this field writes your diagnosis*.
- **Uploads.** One `POST /api/careers/form-upload` for every `file`/`photo` field:
  oversize guard *before* buffering (as `careers/upload` does), kind whitelist from
  the field's `config` **resolved server-side from the published layout** — the
  browser's `Content-Type` and `accept` are never believed — magic-byte sniffing
  on the head bytes, `applications/<jobId>/<uuid>-<sanitised-leaf>` keys, and an
  `application_form_files` row with `application_id` null — `candidate-photos` for
  a `photo` field, whose bucket `043` registers and whose one addition here is the
  anon insert policy (§4). The response is an
  opaque `uploadId`; the browser shows a local object-URL preview and nothing else.
- **Submit.** `submitApplication` gains `formUploads` and `customAnswers`, and the
  order is fixed: re-resolve the layout → refuse on violations → validate the
  system fields with today's rules → `normaliseAnswer` per field, required
  included → map bound fields onto columns → snapshot the rest into `form_answers`
  → attach the named `uploadId`s (each must be unattached, for this job, and for
  this `field_key`) → **the person write** (§4.1, below) → gate scoring, the
  existing `planApplicationConsent` rows, tracking code, referral credit,
  auto-screening and the polite-rejection path all unchanged.
- **The person write is last, and it cannot break the application.** Only after the
  `applications` row exists: resolve the person from the submitted email —
  `person_emails` by `personKey(email)`, else create `person_profiles` plus its
  email row — the spine's `personWriter`, not a second one this page invents; set
  `applications.person_id`; record each ticked group in `person_consents`; then
  `applyPersonField(personId, the person-bound answers, consent)` at
  `door: "candidate_form"`, `actorKind: "candidate"`. Every refusal and every failure
  here is logged and returned as nothing at all to the candidate: an application
  that reached the database is a submitted application, and a profile store that
  hiccuped is our problem, not a reason to tell someone to apply again. The
  §1.5 snapshot already holds their words, so nothing is lost — the profile is
  behind, and §7's console will show it as such.
- **Nothing about a custom answer reaches the AI prompt in this slice.** Screening
  reads `cv_text` as it does today, and `cv_text` is built only from the `about`
  and `cv` system fields plus the LinkedIn line. Free-text custom fields are
  stored and displayed, not fed to the model — see *Security boundaries*.

## 6. The console: `/forms`

A nineteenth staff route. Registration is the four-table contract, and
`scripts/check-staff-routes.mjs` fails the build if two of them disagree:

1. `NAV` — `{ href: "/forms", label: "Application Forms", icon: FormInput, hint: "Build what an application asks", section: "Hiring" }`, placed after `/jobs`
2. `STAFF_ROUTES` (`src/lib/auth/staffRoutes.ts:28`) — typed as `StaffRoute`, so a typo is a type error
3. the Guide manual entry
4. the live-watch area list (the page reloads when `application_forms` changes)

Its hint promises only what the page renders — the standing rule from the nav-hint
audit.

**Layout.** A list (name, status, scope — global or N roles, `version`, field
count, updated) and a three-pane editor: palette of the 17 types on the left, the
section-card canvas in the middle, the inspector for the selected field on the
right. Reordering uses native HTML5 drag-and-drop like `CandidateBoard.tsx` and
`BankColumns.tsx` — and like those two, it pairs the drag with a control a keyboard
can reach: `BankColumns.tsx:29` names its non-drag path a card's "keyboard
alternative" precisely because a pointer-only move is not usable. Here that control
is an up/down button on every row, not only a drag handle. Writes stay behind the
same `canWrite` gate.

**The inspector's binding picker** lists the seven bare `system_key`s and, under a
"also save as a fact about this person" group, the spine's registry keys — read
from `PERSON_FIELDS`, never a second list the console could drift away from. Each
is shown tier-labelled, and a Tier-2 or Tier-3 key carries its group's notice
sentence beside it, so an author sees what the question becomes before writing the
label. The picker cannot offer a key the writer would refuse, because both read the
same registry.

**Editing model.** The canvas holds client state; one `saveFormLayout(formId,
fields, expectedVersion)` action commits the whole layout in a single write with an
optimistic version check, so a drag that raced another recruiter's save fails
loudly instead of silently dropping rows. It refuses before writing: unanswerable
config (a select with fewer than two usable options, `min > max`, empty `kinds`),
duplicate keys inside the form, a ceiling breach, a heading with a `system_key`, a
`person:` binding the registry does not know or whose type is not the registry's,
or a consent-gated binding marked `required`.
Publish is a **separate** action that runs `identityIssues` over the resolved
layout and prints every violation with the field named — so an author can save an
incomplete draft and cannot ship one. Retire sets `archived_at`; deletion is not
offered while any application carries the form's answers.

**Preview** renders the *same* field components the public page uses, from the
same resolved layout, so a preview that lies is structurally impossible.

**Assignment** lives in two places over one action: a panel on `/forms` (which
roles get this form) and a per-opening door on `/jobs` (which forms this role
asks). Both call `assignFormToJob`, which resolves the would-be layout and refuses
on a duplicate key by naming the field *and* the other form that holds it, and on
a ceiling breach by printing both counts.

## 7. AI drafting

A new capability, `form_authoring`, added to `AiCapability` and `modelChains`
(`src/lib/config.ts:48`, `:69`) and surfaced in the routing console — rather than
overloading `interview_questions`, for the reason already recorded in the
translation chain's comment: routing one must not silently reroute the other.

The brief is free text, or a chosen opening's title, responsibilities and
requirements. The model returns a field list; `aiAuthoring.ts`'s discipline
applies verbatim — the JSON is extracted, bounded, and validated **through the
same domain rules as a human save**, a refused entry is dropped and *named* in the
result, and nothing writes. Output lands as a `DRAFT` with the system fields
pre-placed, so a drafted form is one publish away from being correct and cannot
become one by accident. It is never assigned automatically.

A draft may propose a `person:` binding, and the registry decides: an invented key
or a mismatched type is dropped and named like any other refused entry, and a
consent-gated field the model marked `required` is refused — because a model
volunteering that it wants a candidate's blood type is exactly the case the
human-only publish step exists to catch.

## 8. Privacy, erasure, and the access copy

- `collectPaths` (`erasure.ts:80`) gains **one more** read: `application_form_files`
  by `application_id`, grouped by its own `bucket` column — the same treatment
  `application_attachments` already gets, because a file field names a bucket and a
  hard-coded `candidate-photos` constant would be the mistake the module's comment
  at `attachment-rules.ts` warns about. It still removes bytes *before* the row is
  blanked, and still aborts the run if a byte survives.
  **The read count is a moving figure and this slice must not claim the photo as
  its own:** the module enumerates three sources today, `043` makes it four by
  adding `person_profiles.photo_path`, and `044` makes it five with the ledger
  above. A form's photo bytes are found through §1.4, never through the profile —
  one bucket, two paths in, two reads out, each naming its own table.
- `erase_candidate_data(uuid)` is `CREATE OR REPLACE`**d inside 044** to null
  `applications.form_answers` and delete its `application_form_files` rows
  alongside the columns it already blanks. It does **not** null
  `applications.person_id` and touches no `person_*` table: erasing an application
  is not erasing a human. The spine decides whether the profile goes, when the last
  live application linked to it is erased; this function only stops the application
  from holding anything. Replacing the function preserves its
  owner and ACLs, so 041's `revoke` (`041_privacy.sql:499`) still holds.
- **Ordering is a real constraint:** 041 is not applied on the local database yet,
  and neither is 043. 044 replaces a function 041 defines and adds a policy to a
  bucket 043 registers, so it cannot be applied before either. The spec states the
  dependency and the plan must not schedule a live proof of the erasure half before
  all three are applied.
- The access copy gains a "what you told us" section built from `form_answers`
  (label → value, filenames for files) and the §1.4 rows, bounded by the existing
  `MAX_ANSWERS`/`MAX_ANSWER_CHARS` cuts, each cut printed. Honest framing: the
  copy already omits `cv_file_path` and the gate answers today
  (`accessCopy.ts:71`), so this is not a gap the builder introduced — but the
  builder makes it a photo-sized gap, so this slice closes it.
  A `person:`-bound answer therefore appears in **two** access copies, and that is
  not a bug to reconcile: this one prints what was answered *on this application,
  at this version* — decision 5's snapshot — while the spine's §8.2 prints what we
  hold *now*. They disagree by design the moment the profile moves on, and a
  candidate reading both should see exactly that.
- **Orphan uploads are cleared, and that is the one place the slice overrides a
  switch.** An applicant who attaches a photo and never submits leaves real bytes
  with no record and — decisively — no consent, because `planApplicationConsent`
  runs in the submit action, so nothing ever agreed to hold the file.
  `src/app/api/cron/retention/route.ts` runs two bounded passes today (warn, then
  erase via `eraseApplication`) and does nothing unless
  `privacy.retention_enabled`, which ships off. This slice adds a third pass that
  runs **whatever that switch says**: `application_form_files` rows still unattached
  after a fixed 24-hour window have their bytes removed through the same
  `getFileStore().remove` the erasure engine uses, then their rows deleted. The
  switch governs erasing records that exist; an upload that never became one has no
  record to protect, and "off" cannot mean "keep a stranger's photo forever". The
  route's doc comment says this, so the exception is on the page that grants it and
  not only here. The window is a constant in `limits.ts`, not a setting, so it
  cannot be widened by accident.

## 9. Failure behaviour and the bootstrapping fallback

Fully dynamic means a bad state can starve the front door: an opening whose forms
are all drafts would otherwise render an apply page with no fields, which is worse
than no apply page. One rule covers every failure: **degrade the page, never the
record.**

| State | What the candidate gets | What the write does |
| --- | --- | --- |
| Nothing published resolves (no globals, no assignments) | **today's `ApplyWizard`**, unchanged | the legacy submit path, unchanged |
| `application_forms` is missing — 044 not applied | today's `ApplyWizard`; `isMissingSchemaError` is the probe, as `erasure.ts:26` already uses it | legacy path |
| A published layout with violations | today's `ApplyWizard`, and the reason is logged | **refused** — a broken layout never files an application |
| The layout read throws or times out | today's `ApplyWizard` | refused |
| One field's value fails validation | the same wizard, that field marked with its sentence | nothing written |
| A consent-gated group was declined | the wizard, its fields for that group hidden | application written; the group's person fields are not |
| The person write is refused or throws | the wizard, and the candidate sees nothing of it | application written; `person_id` and the profile simply lag, and the refusal is logged by key |

The fallback is read-only-safe and write-strict: degrading the *page* is always
allowed, degrading the *record* never is. It is deleted in a later slice only once
every live opening resolves a published layout — and `resolveLayout` is where that
audit will be counted, which is why the "no forms published" state is a distinct
branch rather than an empty list.

**"The record" is the application, and that boundary matters now there are two
stores on one page.** This slice owns the `applications` row: it is never half-
written, never filed against a broken layout, never filed without its snapshot. The
person tables are the spine's, and the form is one door into them — so a person
write may be refused or fail and the application still stands, exactly as the spine's
own §9 lets a `cv_extraction` fail without undoing a record. What must never happen
is the reverse: an application refused because our profile store was unhappy.

A candidate mid-form when a recruiter republishes: the next load gets the new
layout; the submit re-resolves and refuses a key that vanished, telling the
candidate to reload rather than filing an application against questions it no
longer has. Answers already typed into `form_answers` of past submissions are
untouched — that is decision 5's snapshot.

## 10. Security boundaries

- **Server-resolved constraints.** Upload size, kind, and magic bytes are decided
  from the published field config fetched by id, never from the request. An
  applicant cannot widen a 5 MB photo field by posting `maxBytes: 1e9`.
- **`uploadId` ownership.** The submit may only attach an upload that is
  unattached, filed against the same `job_id`, and named by the same `field_key`.
  This is strictly better than the current CV door, which stores whatever
  `cvFilePath` the client names (`actions.ts:532`) and downloads it to extract text
  (`actions.ts:482`) — protected today only by a `crypto.randomUUID()` in the key.
  The builder does not replicate that; the pre-existing CV path is left alone
  (*Not in this slice*) but the new table is what makes hardening it possible
  later.
- **No injection through a field.** Labels, help text, option labels and answers
  are rendered as React children, never as HTML; the snapshot is read back through
  a parser that drops malformed entries (the `parseGateAnswers` precedent), so a
  hand-edited jsonb cannot smuggle markup into a recruiter's screen.
- **No prompt path.** Custom answers never enter `cv_text` and never reach the AI
  screening prompt, the assistant, or a report column in this slice. A form field
  is data, not instruction.
- **Authoring is permissioned, not session-guessed.** Every write checks
  `has_permission('jobs.manage')` server-side before touching PostgREST, and the
  public read projects away `system_key`, `config` and table shape.
- **Bounded reads.** Forms, fields, assignments and resolved layouts all carry
  limits (§11); an unbounded read on a public route is the pattern the pagination
  audit already swept.
- **An anonymous door does not get the top rung.** Anyone can post a form carrying
  any email address, so `candidate_form` writes create a profile and beat a model's
  reading, but they cannot overwrite a value a recruiter set by hand — see §4.1 and
  the spine's §3.3. The answer the person typed is still on their application
  forever, because the snapshot is written before the ladder runs.
- **No write without the registry, no value without the box.** A `person:` binding
  is checked against `PERSON_FIELDS` at publish and again in the writer; §1.2's
  column CHECK only bounds the key's *shape*, so the registry read is what stops an
  invented key, and a request that invents one has no path to a column — the writer
  refuses before any table is named. A consent-gated group with no live
  `person_consents` row is refused by the
  spine's checker before a value is looked at, so the browser cannot supply a
  consent tick it never made: the write re-reads the row rather than trusting the
  submission.

## 11. Limits

| Thing | Ceiling | Why |
| --- | --- | --- |
| Fields per form | 40 | a step per two fields is already a long application |
| `section_heading`s per form | 12 | the wizard's step rail has to stay usable on a phone |
| Options per choice field | 30 | a 100-option select is a list, not a question |
| Files per field | 1 | multi-file would make a key hold a list, and the snapshot is one value per key |
| Global forms | 12 | they are asked on every role; the resolved ceiling binds first |
| Forms assigned per opening | 8 | assignment refuses past it, naming the count |
| Resolved fields per application | 80 | `resolveLayout` violation; refuses the assignment, not the page |
| `file` bytes | 10 MB | matches `ATTACHMENT_RULES` for `resumes` |
| `photo` bytes | 5 MB | an identity photo is a few hundred KB in practice |
| Long text | 5,000 chars | snapshot and drawer both have to render it |
| `form_answers` per row | 80 entries | same ceiling as the layout |

Ceilings live in `src/modules/form-builder/domain/limits.ts` as one exported
object, so the proof, the action and the UI copy cannot drift apart.

## Not in this slice

- **Conditional fields** (show X when Y), and branching/multi-page routing beyond
  linear steps.
- **Per-field translations.** `SUPPORTED_LOCALES` labels stay in the i18n layer;
  an author's label is one string.
- **Scoring or gating inside a form.** A passing answer is a gate question in the
  Question Bank; two surfaces stay two surfaces.
- **Immutable published versions.** `version` is recorded in the snapshot and the
  trail; an old *revision* of a form is not reconstructible.
- **Assistant tools** for `/forms`. The page ships with its own console; chat
  parity is a follow-up, exactly as several before it deferred it.
- **Form answers as report or analytics columns,** and CSV export of `form_answers`.
- **Reference/FK, password, rich-text and JSON field types** (§3).
- **Rewriting existing applications.** Rows filed before 044 keep the four fixed
  columns and no snapshot; nothing back-fills. The same is true of `person_id` —
  the spine's §1.11 backfill gives existing applications a person, and this
  migration adds none.
- **Hardening the pre-existing `cvFilePath` door** (§10).
- **Any candidate-portal surface.** The (candidate) portal, `NoticeInbox` and
  `communication_logs` are off-limits.

## Proof

`scripts/prove-form-builder.mjs`, standalone `node`, printing `N checks passed`
and exiting non-zero — the house style, no jest.

**Domain (no database, no network).**
1. `resolveLayout` order: globals before assignments, `global_position` then id, `position` then name; a run twice gives identical output.
2. A duplicate `key` across two forms is a violation naming both forms; a duplicate `system_key` likewise; unique keys give no violation.
3. `identityIssues` for each of the §4 bullets, including the `cv`-or-`about` rule, a type-mismatched binding, a `person:` key the registry does not carry, and a consent-gated binding marked `required`.
4. `normaliseAnswer` per type: accepts, rejects, and the boundary values for every numeric/date ceiling; `multi_select` honouring min/max selections; `address` component joining; `section_heading` refusing a value.
5. `kinds` → accepted types and byte ceilings, and an unknown kind refusing.
6. Snapshot encode → parse round-trip, and a parser that drops malformed entries.
7. Every ceiling in §11 enforced by name, not by an inline number.
8. The binding map: a `person:` field's registry group and tier come from
   `PERSON_FIELDS` and nowhere else; the consent groups a layout needs are exactly
   the groups its bindings belong to; a layout with no bindings needs no box.
9. The rung: with a value already held by `hand_record`, a `candidate_form` write is
   reported as a conflict and the held value stands; the same write against an empty
   field applies; the same write against a `cv_extraction` value wins. In all three
   the application's snapshot keeps the incoming answer.

**Wiring (source-grepped, comment-stripped).**
10. `collectPaths` reads `application_form_files`, and 044 replaces `erase_candidate_data` to blank `form_answers` and delete those rows — and the same read proves it does **not** null `applications.person_id`, which is 043's column and the spine's to clear. **Pinned as code, not prose** — the vacuous-needle failure the JD proof already hit, so every needle here strips comments before matching.
11. The upload route resolves its constraints from the layout (a needle that the accept list is *not* taken from the request body).
12. The public projection omits `system_key`, `config` and every registry key.
13. `/forms` appears in `NAV`, `STAFF_ROUTES`, the Guide and the live areas, and the staff-route count pin is **derived from the directory listing**, exactly as `prove-job-distribution.mjs` section 8 now does — so the figure cannot go stale.
14. `form_authoring` exists in `AiCapability`, `modelChains`, and the routing console.
15. The two fixed consent boxes and the Review step are not produced by any builder component; the per-group boxes are produced only from a layout that contains a binding, and their copy comes from the spine's notice file rather than a string in this slice.
16. The dynamic submit builds `cv_text` from **both** the About answer and the
    extracted CV (§4), and `actions.ts:507`'s legacy overwrite is untouched — the
    check pins both, so neither half can silently change the other.
17. The bucket: `candidate-photos` already sits in `BucketKey`, `BUCKETS`,
    `ownersFor`, `unlinkReference` and 043's `files` policies — those five places are
    the spine's and this proof only asserts they are unchanged. What 044 must add is
    the **anon `files` insert policy** for that bucket, and the check pins that the
    policy exists, is `to anon`, is an `insert`, and constrains the path prefix — the
    one registration place that is this slice's, because the public form is the
    second door into a bucket 043 opened for a staff door.
18. The retention route has an orphan pass over `application_form_files` with
    `application_id is null`, its window comes from `limits.ts`, it removes bytes
    through `getFileStore().remove` **before** deleting the row, and it is not
    gated behind `privacy.retention_enabled` — while the two existing passes are.
19. `submitApplication` calls `applyPersonField` with `door: "candidate_form"` and
    the consent checker, and the call sits **after** the `applications` insert — a
    needle on the order, because a person write that runs first turns a store
    failure into a refused application.

**Mutation proofs.** Break each rule and confirm the check that owns it fails:
swap the two assignment orders; rename a key to collide; drop the `cv`/`about`
clause; set a ceiling one higher than the check reads; delete the
`application_form_files` read from `collectPaths`; feed the upload route a
client-sent `accept`; remove `/forms` from `STAFF_ROUTES`; drop the About answer
from the merged `cv_text`; take `candidate-photos` out of `BucketKey` while leaving
its descriptor — a place that is 043's, and this slice's check still catches it;
make the orphan pass delete the row **before** removing the bytes; put the orphan
pass back behind `privacy.retention_enabled`; move the `applyPersonField` call
**above** the `applications` insert; let the 044 rewrite of `erase_candidate_data`
null `applications.person_id` too; promote `candidate_form` to the top rung; mark a
health-group binding `required` and let it publish; drop the anon `files` insert
policy while leaving the bucket registered.
Every one must turn the proof red, and the file is restored before the gates are
run. Five of them are the interesting ones, because nothing else in a build notices:
a bucket that exists but is unlisted, a sweep that unlinks the metadata and leaves
the photo on the disk, an orphan pass quietly gated behind a switch that ships off,
a person write that can veto an application by running first, and an anonymous door
promoted into the authority to rewrite a stranger's profile.

**Gates.** `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`;
`npm run lint` with its two known tolerated warnings and no third;
`node scripts/prove-form-builder.mjs`; `node scripts/prove-job-distribution.mjs`
(132 checks, the staff-route count pin moves 18 → 19 and must stay green);
`node scripts/check-staff-routes.mjs`.

**Live proof (needs the owner's local stack, and 041, 043 and 044 applied).** Draft
a form in `/forms`, fail publish on the contract, fix it, publish; bind a field to a
registry key and try marking a health-group question `required` — the publish must
refuse; assign it to an opening and watch the duplicate-key refusal; apply as a
candidate with a photo and a file, decline one consent group and submit anyway, and
confirm the application filed, that group's fields never rendered for the candidate
to answer, and `person_consents` holds no agreeing row for it; read the row back in
`/candidates` and confirm the snapshot
renders the questions as asked; then erase that application and confirm the
`candidate-photos` byte is gone from `$UPLOADS_ROOT` while `applications.person_id`
still points at a profile that is **not** erased — **that last pair of facts is the
slice's actual point**, that the byte went and the person did not, and it cannot be
proved until all three migrations are applied, which is an owner decision per file,
not a step this plan schedules.

## Known limits

- A form is platform-global authoring with no company scoping, because
  `has_permission` takes no company argument — the same limit `application_gate_questions`
  already lives with. A second company on this deployment shares the form library.
- Editing a published layout while candidates are mid-form can invalidate a key;
  the submit refuses and asks for a reload rather than filing a partial record.
- `form_answers` is a snapshot of *labels*, so a renamed label renders the old
  wording on old applications. That is the intended behaviour (decision 5), but it
  means the drawer can show copy the form no longer uses.
- The `candidate-photos` bucket is a **closed-union** disk bucket, and registering
  it is not this slice's work: the File Manager's buckets are a union, not a
  listing — `BucketKey` (`src/app/(admin)/files/file-browser-types.ts:13`) with one
  descriptor each (`:26`–`:47`) and per-bucket branches in `files/actions.ts`
  (`:303`, `:416`, `:517`, `:538`). The spine's `043` puts the member, the descriptor
  and the row-reader in place, because that is where its own staff-recorded photo
  lives. So the limit for *this* slice is a dependency, not a task: `application_form_files`
  points into a bucket it did not register, and applying 044 without 043 means a
  photo upload lands in a bucket no reader knows. Item 17 of the *Proof* section names
  the union
  member as 043's and pins only 044's own addition — the anon `files` insert policy —
  so a merge that ships one without the other turns the proof red.
- Erasing an application whose form was deleted still works: §1.4 carries the
  bucket and path, and the snapshot carries the label. Nothing in the delete path
  dereferences `application_forms`.
- The legacy submit still discards the pasted About text when a CV file extracts
  (`actions.ts:507`). The dynamic path fixes that for forms (§4); openings on the
  fallback keep today's behaviour until the owner decides to change it. Two paths
  that merge `cv_text` differently is a deliberate, recorded difference, not a drift.
- One cron pass ignores a setting. The retention route's two existing passes are
  gated behind `privacy.retention_enabled`, which ships off; the orphan-upload pass
  (§8) is not, because an upload that never became a record was never consented to
  and has no record to protect. Anyone reading the route's promise must find that
  exception in its own doc comment, and the proof pins it in both directions.

## Surfaces this slice must not touch

- `src/app/(candidate)/portal/**` — the standing "leave the candidate portal alone".
- The four fixed steps' behaviour for openings with no published layout. The
  fallback is the whole point; `ApplyWizard.tsx` is not rewritten.
- `applications` columns other than the new `form_answers`, and the stage machine.
- Gate-question tables, scoring, and the polite-rejection path.
- `erase_candidate_data`'s existing blanks. 044 replaces the function to add its own
  two — the `form_answers` null and the `application_form_files` delete — and every
  column 041 already blanks stays as 041 wrote it. The spine's 043 does not rewrite
  the function at all; it only adds a source to the TypeScript side that calls it.
- Existing buckets' rules in `attachment-rules.ts`; new kinds go in the builder's
  own table.
- `next-env.d.ts`, `.next`, and the user's dev server on 3001.

## Sources

- `db/migrations/018_application_gate_questions.sql` — global-or-job authoring, `is_active` retirement, jsonb options with a `jsonb_typeof` check, `is_staff() or <visibility>` read policy.
- `src/modules/careers/gate-questions.ts` — one pure module, three callers, public projection strips what would make it gameable.
- `src/modules/privacy/application/erasure.ts` — the order (blockers → bytes → blank), the enumerated byte sources, `isMissingSchemaError` as the unapplied-schema probe.
- `src/modules/careers/attachment-rules.ts` — the header recording that these rules are now the *only* size/type enforcement a byte gets.
- `src/app/api/careers/upload/route.ts` — oversize-before-buffer, magic-byte sniffing, uuid-prefixed keys.
- `src/app/careers/actions.ts` — `ApplyInput`, the CV-or-text rule, LinkedIn into `cv_text`, consent planning, gate scoring, the service-role question read.
- `src/app/careers/apply/[id]/ApplyWizard.tsx` — the four steps this design replaces and then falls back to.
- `src/app/api/careers/questions/route.ts` — why a public layout read is a route handler and not a cached page read.
- `scripts/check-staff-routes.mjs`, `src/modules/analytics/presentation/nav.ts`, `src/lib/auth/staffRoutes.ts` — the four-table registration contract and what fails it.
- `node_modules/next/dist/docs/` — App Router route handlers and metadata routes (`connection()` is what makes a prerendered `robots.ts`/`sitemap.ts` read the deployment's own origin; a route handler that consumes `request.url` is already request-time), Server Actions and `revalidatePath`.
- The user's field-type catalogue and the six choices recorded in *The six decisions*.
