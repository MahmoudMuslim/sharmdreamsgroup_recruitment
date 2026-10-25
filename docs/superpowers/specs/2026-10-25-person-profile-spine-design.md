# Person profile spine

**Date:** 2026-10-25
**Status:** Draft for owner review — nothing is built until this design is signed off
**Scope:** one slice — the platform gains a store for the person behind an application, not the application: identity, contact, photo, education, work history, skills, languages, location, marital and family facts, and the health and household answers a candidate can be asked to consent to. One migration (`043`, authored here, **not applied**), eleven tables, one column, one new bucket, one field registry that is the only place any field's sensitivity is declared, one writer that owns the precedence ladder, one extractor, one indicator module, three new permissions, and a hand-record door that finally accepts a CV file. No new staff page. The candidate portal is not touched.

---

## Why

There is no person in this database. There are applications.

`applications` ([db/schema.sql:205](../../../db/schema.sql)) carries `full_name`, `email`, `phone`, `cv_text`, `cv_file_path`, `stage`, `source`, `ai_*`, `gate_answers` and `diversity_flags` — and nothing else about the human. Date of birth, nationality, address, education history, employers, tenure, skills as facts, marital status, a photo: none of these have a column anywhere. So today:

| The ask | What actually exists |
| --- | --- |
| "Candidate profile must have photo, date of birth, age, education, skills, job history, location, marital status, children" | One text column (`cv_text`) a model reads, and a card titled "Who they are" ([page.tsx:135](../../../src/app/(admin)/candidates/%5Bid%5D/page.tsx)) that prints name, email, phone and **the opening's** location |
| "Record a candidate by hand via CV file" | `createCandidate` ([candidate-actions.ts:864](../../../src/app/(admin)/candidates/candidate-actions.ts)) inserts `{job_id, full_name, email, phone, source}`; `NewCandidateDrawer.tsx` has five fields (`:162`, `:187`, `:201`, `:220`, `:232`) and **no file control at all** — its subtitle tells the recruiter to attach a CV afterwards |
| "Extract total years of experience and job stability" | Computed nowhere. `job_openings.experience_level` ([033_opening_terms.sql:42](../../../db/migrations/033_opening_terms.sql)) is a property of the *job*, not the person |
| One candidate, several applications | A *convention*: `personKey()` lowercases the email ([personIdentity.ts:38](../../../src/modules/candidates/domain/personIdentity.ts)) and `getCandidateProfile` pulls rows `.in("email", emailSpellings(email))` ([profile.ts:386](../../../src/app/(admin)/candidates/%5Bid%5D/profile.ts)). A person is a group of rows sharing a string, resolved in TypeScript on every read |
| Structured history exists | It does — for prospects. `extractProfile` ([profile-extract.ts:87](../../../src/modules/sourcing/infrastructure/profile-extract.ts)) returns `experience[]`, `education[]`, `certifications[]`, `skills[]`, `languages[]`, `location` — and writes them into `sourced_prospects.profile` jsonb, a column an applicant can never reach |

The last two rows are the whole design problem. The platform already knows what a structured person looks like; it only ever files that knowledge under the wrong subject (a prospect, not an applicant) and in the wrong shape (one jsonb blob, whose dates are the strings a model chose to keep: `"2019"`, `"Present"`).

The meeting notes the owner supplied make the requirement concrete: *out of 50 applications about 30 qualify and are filtered to around 15*, *marital status, work experience and job tenure are used to build an initial profile*, and *resumes are inconsistent — missing dates, missing major, missing years of experience, missing photos*. Every one of those needs a dated row, not a paragraph. A paragraph cannot be summed.

## What the platform already has

| Fact | Where |
| --- | --- |
| Append-only, newest-row-wins consent, versioned against a notice | `db/migrations/041_privacy.sql:131` (`candidate_consents`, its `comment on table`, and the `recorded_at desc` index at `:154`) |
| Erasure anonymises rather than deletes, and refuses a hired or in-flight record | `erase_candidate_data(uuid)` at `041_privacy.sql:359`, guards at `:380`, `:385`, `:394`, blanking at `:467` |
| Bytes are found and removed *before* the row is blanked, from an enumerated list of sources | `collectPaths` ([erasure.ts:80](../../../src/modules/privacy/application/erasure.ts)) — three reads: `applications.cv_file_path` (`CV_BUCKET` = `candidate-cvs`, `:31`), `candidate_responses.video_path` via attempts, `application_attachments` by row |
| A single seam over the disk byte store | `getFileStore()` → `upload/signedUrl/download/remove/list` ([store.ts](../../../src/lib/files/store.ts)); path containment only, **no bucket allow-list**, so a new bucket is a policy question, not a store question |
| File metadata and its RLS | `public.files` ([db/schema.sql:2650](../../../db/schema.sql)), eight named per-bucket policies from `:2672` |
| The File Manager's four-place bucket contract | `BucketKey` ([file-browser-types.ts:13](../../../src/app/(admin)/files/file-browser-types.ts)), `BUCKETS` descriptors, `ownersFor` ([files/actions.ts:295](../../../src/app/(admin)/files/actions.ts)) and `unlinkReference` (`:512`) |
| A grant that un-masks what is masked by default | `scoreVisibility.ts:30` returns `!permissions.has("scores.view_unmasked")` |
| A change trail that already distinguishes human, AI, cron and candidate authorship | `ACTIVITY_AREAS` ([trail.ts:47](../../../src/modules/activity/domain/trail.ts)), `ACTIVITY_ENTITIES` (`:70`), `recordActivity` ([record.ts:78](../../../src/modules/activity/application/record.ts)) |
| The gateway an extractor uses, with truncation distinguished from refusal | `complete()` / `parseJsonResponse` / `AiGatewayError` / `TruncatedJsonResponseError` ([profile-extract.ts:22-29](../../../src/modules/sourcing/infrastructure/profile-extract.ts)) |
| A schema probe for "this table is not on this database yet" | `isMissingSchemaError` from `@/modules/interviews/domain/interviewScorecard`, used the same way 038's notes desk uses it |
| The CV byte rules the staff door must reuse | `CV_MAX_MB = 5`, `CV_TEXT_MIN_CHARS = 40` ([cv-rules.ts:10](../../../src/modules/careers/cv-rules.ts)) and `cvContentError`'s magic-byte check (`%PDF`, `PK`, OLE) |
| A pure domain module shared by several doors, so surfaces cannot disagree | `src/modules/careers/gate-questions.ts` is the precedent this slice copies |

## What the platform does not have

- No table that is about a human rather than an application. There is no `candidates` table at all.
- No place a photo can be stored. `BucketKey` names four buckets; none of them receives an image, and `application_attachments.bucket` is CHECKed to `('resumes','candidate-audio')` ([db/schema.sql:773](../../../db/schema.sql)).
- No dated employment or education rows for an applicant, so nothing summable.
- No consent basis coarser than "processing" and "talent pool" (`041_privacy.sql:140`) — which means there is currently no way to record that someone agreed to be asked about a disability and refused to be asked about their children.
- Nothing that logs who *read* sensitive data. The trail records writes.
- No person-level erasure. `erase_candidate_data` is scoped to one application id; it rewrites that row's email to `'erased+' || … || '@erased.invalid'` (`041_privacy.sql:405`), which is the fact the backfill in §1.11 must exclude.

## The constraint that decides the design

This is not a feature request with a data-protection footnote; the footnote is the constraint.

Egypt's Law 151/2020 and GDPR Art. 9 both treat health, disability, and (in practice) sex life and family data as the category that needs its own basis, and the owner's answer to the field inventory was *"everything on the list"* — including blood type, chronic conditions, dietary restrictions, health-insurance status and future family planning. The system will hold that on a server the owner runs.

So the design has one load-bearing rule, and everything else follows from it:

> **A field's sensitivity is declared once, in a registry, and the store is divided along that declaration — not along what is convenient to query.**

Concretely: the special-category answers do not sit in `person_profiles` as columns. They sit in their own tables, behind their own grants, so a `select *` from the main table cannot leak, a new column added to `person_profiles` is Tier 1 or Tier 2 by construction, and the only way to read a health answer is to name the table that holds it. That is why the store is hybrid rather than one wide table (§Approaches).

The second rule the constraint forces: **the change log holds values, so the change log is itself inside the boundary.** A `person_events` row that says `marital_status: single → married` is a Tier-2 fact; one that says `blood_type: — → O+` is a Tier-3 fact sitting in a table a recruiter opens to see history. Hence `person_events.field_group`, stamped from the registry by the writer, and an RLS predicate that gates the rows, not the table (§1.9).

The third: **nothing a model infers is ever allowed to touch the boundary.** An extractor reads a CV and could write "female", "married", "wheelchair user" from pronouns in a paragraph. The extraction vocabulary is closed to Tier 1 and the validator refuses any other key before a value reaches the database (§5).

## Approaches considered

### A — One wide `person_profiles`, every field a column

~60 columns. Indicators computable in SQL, one column list to erase, one table to read, the simplest thing that could work.

**Refused:** health, disability, blood type and family planning end up as columns on the same table a recruiter browses all day. The boundary becomes a `select` list that rots on the first added field, and `select *` — which is what PostgREST readers naturally write — is a leak with an entry in the change log.

### B — `person_profiles` with jsonb group columns

`identity jsonb`, `family jsonb`, `health jsonb`. Consent maps 1:1 onto a column, widening costs nothing.

**Refused:** dates land inside jsonb. Total years of experience and stability gaps become TypeScript-only arithmetic over unindexed blobs, which is the opposite of the ask — the notes want those two indicators, and the reason they do not exist today is that `cv_text` is a paragraph.

### C — Three stores by data shape, one change log (chosen)

Real columns for the facts indicators need (dated employment, dated education, identity, contact, status counts); **separate tables** for the special-category groups and for third-party identities (partner, children, emergency contacts); append-only rows for every collection; one `person_events`; one `person_emails` as the identity table.

**Cost:** eleven tables instead of one, one join per surface, and a registry that must be maintained as the single authority.
**Buy:** the boundary is a table and a grant, not a column list; indicators are SQL-shaped; third-party data is distinguishable from the candidate's own; erasure can be exhaustive because the shape of "a person's data" is a list of tables rather than a list of columns.

### The decision

**C**, with the tier line drawn at *"a count or a status is less sensitive than a name, a date or a relationship"*. The owner chose that split explicitly, knowing the meeting notes ask for marital status in the initial profile: `marital_status`, `children_count` and `household_size` stay Tier 2 and usable for screening; the spouse's name, employer and contact, each child's name and date of birth, the wedding date, and who lives in the house move to Tier 3.

## The decisions

1. **One row per human, keyed by address.** `person_profiles` + `person_emails` (unique, lowercased, CHECK-enforced). An email is the identity because the platform already treats it as one. Two addresses for one person are two `person_emails` rows on one profile, once someone says so — through a merge action, never silently.
2. **Nothing about the future changes the past.** Three shapes, decided per field: immutable (date of birth), current-with-history (marital status, address, photo, phone → a column plus an event row per change), append-only collection (jobs, schooling, children, contacts → a new row, never an overwrite). "Was single, now married" is a `person_profiles` update *and* a `person_events` row naming the old value, the door and the actor.
3. **A ladder of six doors decides who wins when the same fact arrives twice.** The rung belongs to the *door*, because the person and the trust are not the same thing (§3.3). A candidate using the link we signed to their own address is the highest authority there is. The same candidate typing into the public apply form is one rung below a recruiter's hand — not because they are less truthful, but because that door cannot tell them from anybody else holding the address, and the write that says "single → married" is byte-for-byte the write that says "my colleague is married". Either way the **application keeps their answer as asked** — the snapshot is written before the ladder runs, so nothing is ever lost, only deferred to a human. A recruiter hand edit beats an extractor. An extracted value may fill an empty field and may never overwrite one a human set. Enforced by one writer (§3), not by each door remembering.
4. **Three grants, not one.** `candidates.view_health_data`, `candidates.view_family_data`, `candidates.view_emergency_contacts`, seeded to `SUPER_ADMIN` only. Health and family are different purposes and a cleared health reader has no claim to a spouse's employer.
5. **Reading Tier 3 is logged, not just writing it.** Each open of a Tier-3 table writes an `activity` row. Without it the trail proves only half of what happened.
6. **The photo is Tier 2, and never enters a model.** It lives in a new `candidate-photos` bucket; the byte is referenced by `person_profiles.photo_path`, follows the four-place bucket contract, and is excluded from every prompt, screening surface and export by the same rule blind grading already applies.
7. **Extraction is a click, not a side effect.** The record door stores the file and its text. Turning that text into dated rows is one deliberate action per candidate, on the existing `resume_screening` capability. Filling a name field does not send a person's CV to a model.
8. **Age is never stored.** Derived from `date_of_birth` at read time, in the organisation's timezone, and printed as "34 (b. 12 Mar 1991)".
9. **Erasure reaches the person when the last application does.** `erase_person_data(uuid)`, called after the existing per-application erasure, deletes the Tier-3 rows, the collections and the history, and anonymises the profile row rather than deleting it.

---

## 1. Data model — `db/migrations/043_person_profile_spine.sql`

Eleven tables, one column, one bucket, three permissions, one function, and a backfill. Ordered so each statement stands alone; the file is idempotent (`if not exists`, `create or replace`, `drop policy if exists`) exactly as 041 and 042 are.

### 1.1 `person_profiles` — the person, and only their own facts

```sql
create table if not exists public.person_profiles (
  id uuid default gen_random_uuid(),
  legal_name text not null,
  preferred_name text,
  pronouns text,
  gender text,
  date_of_birth date,
  birthplace text,
  national_id text,
  nationality text,
  photo_path text,
  photo_mime text,
  mailing_address text,
  current_city text,
  phone text,
  marital_status text,
  children_count smallint,
  household_size smallint,
  housing_tenure text,
  commute_mode text,
  commute_minutes smallint,
  relocation_willingness text,
  travel_restrictions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  erased_at timestamptz,
  constraint person_profiles_pkey primary key (id),
  constraint person_profiles_marital_check check (
    marital_status is null or marital_status in
    ('single','married','divorced','widowed','civil_partnership','cohabiting','prefer_not_to_say')
  ),
  constraint person_profiles_housing_check check (
    housing_tenure is null or housing_tenure in ('own','rent','live_with_family','other')
  ),
  constraint person_profiles_commute_mode_check check (
    commute_mode is null or commute_mode in ('car','public','motorbike','bicycle','walk','remote','other')
  ),
  constraint person_profiles_relocation_check check (
    relocation_willingness is null or relocation_willingness in ('yes','no','depends')
  ),
  constraint person_profiles_dob_check check (date_of_birth is null or date_of_birth < current_date),
  constraint person_profiles_children_count_check check (children_count is null or (children_count >= 0 and children_count <= 30)),
  constraint person_profiles_household_size_check check (household_size is null or (household_size between 1 and 40)),
  constraint person_profiles_commute_minutes_check check (commute_minutes is null or (commute_minutes between 0 and 600)),
  constraint person_profiles_name_length_check check (char_length(legal_name) between 2 and 160)
);
```

No `email` column. One copy of any fact is the rule, and `person_emails` is the only place an address is stored (§1.5).

`children_count` is a column the candidate or recruiter states, **not** a count of `person_dependants` rows. Deriving it would make RLS answer `0` to a recruiter who cannot see the rows, which is a fabricated figure dressed as a fact. Where both exist, the writer records the disagreement as an event rather than silently reconciling it (§3).

`gender` and `pronouns` are Tier 2 free-ish text with length checks, not an enum: a two-value check on a person's identity is a lie the database tells. The comment on the column states that the value is what the person wrote.

### 1.2 `person_health` — special category, own table, own grant

```sql
create table if not exists public.person_health (
  person_id uuid not null,
  disability_status text,
  accommodations text,
  chronic_conditions text,
  allergies text,
  dietary_restrictions text,
  blood_type text,
  health_insurance text,
  updated_at timestamptz not null default now(),
  constraint person_health_pkey primary key (person_id),
  constraint person_health_disability_check check (
    disability_status is null or disability_status in ('yes','no','prefer_not_to_say')
  ),
  constraint person_health_blood_type_check check (
    blood_type is null or blood_type in ('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown')
  ),
  constraint person_health_insurance_check check (
    health_insurance is null or health_insurance in ('active','none','prefer_not_to_say')
  ),
  constraint person_health_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);
```

1:1, and the row exists only once someone has written it. Absence is a state with three readings, and the store keeps them apart: no `person_health` row and no `health` consent row means **never asked**; a `granted = false` consent row means **asked and refused**, with no value stored; a row with all columns null means **asked, agreed, answered nothing**. A desk that cannot tell those three apart cannot tell a candidate who declined from a candidate nobody thought to ask, which is the difference between a privacy refusal and a gap in our own process.

Long answers (`accommodations`, `chronic_conditions`) are text with a 2,000-character limit enforced in the writer, not in SQL: the database refuses at insert rather than truncating, and the message names the field.

### 1.3 `person_family_details` and `person_dependants`

```sql
create table if not exists public.person_family_details (
  person_id uuid not null,
  partner_name text,
  partner_occupation text,
  partner_contact text,
  anniversary_date date,
  household_composition text,
  family_planning text,
  updated_at timestamptz not null default now(),
  constraint person_family_details_pkey primary key (person_id),
  constraint person_family_planning_check check (
    family_planning is null or family_planning in
    ('planning','not_planning','already_children','prefer_not_to_say')
  ),
  constraint person_family_details_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);

create table if not exists public.person_dependants (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  name text not null,
  relationship text not null default 'child',
  date_of_birth date,
  note text,
  created_at timestamptz not null default now(),
  constraint person_dependants_pkey primary key (id),
  constraint person_dependants_relationship_check check (
    relationship in ('child','spouse','partner','parent','sibling','other')
  ),
  constraint person_dependants_name_length_check check (char_length(name) between 1 and 120),
  constraint person_dependants_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);
create index if not exists person_dependants_person_idx
  on public.person_dependants (person_id, date_of_birth);
```

These are **other people's** data, held because the candidate volunteered it. The column comment says so, and it is the reason the emergency-contact and dependant rows are erased on their own terms: when a person is erased, a named child's row is deleted, not anonymised (anonymising a third party's name to "Erased" invents a record of someone who never existed).

### 1.4 `person_emergency_contacts`

```sql
create table if not exists public.person_emergency_contacts (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  sequence smallint not null,
  name text not null,
  relationship text,
  phone text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint person_emergency_contacts_pkey primary key (id),
  constraint person_emergency_contacts_sequence_check check (sequence in (1, 2)),
  constraint person_emergency_contacts_person_sequence_key
    unique (person_id, sequence),
  constraint person_emergency_contacts_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);
```

Two, because the questionnaire asks for a primary and a secondary. Held under its own grant for a distinct reason: the purpose is safety, not screening, and giving an office manager the door to that purpose must not hand them a medical file.

### 1.5 `person_emails`, `person_languages`

```sql
create table if not exists public.person_emails (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  email text not null,
  is_primary boolean not null default false,
  added_at timestamptz not null default now(),
  constraint person_emails_pkey primary key (id),
  constraint person_emails_email_key unique (email),
  constraint person_emails_email_is_lower_check check (email = lower(email)),
  constraint person_emails_email_shape_check check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  constraint person_emails_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);
create index if not exists person_emails_person_idx on public.person_emails (person_id);
-- One primary address per person, and only when the person is still a person.
create unique index if not exists person_emails_one_primary_idx
  on public.person_emails (person_id) where is_primary;

create table if not exists public.person_languages (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  language text not null,
  proficiency text not null default 'professional',
  constraint person_languages_pkey primary key (id),
  constraint person_languages_person_language_key unique (person_id, language),
  constraint person_languages_proficiency_check check (
    proficiency in ('native','fluent','professional','elementary')
  ),
  constraint person_languages_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);
```

The `lower(email)` CHECK is the identity rule stated in SQL instead of in a TypeScript function that each door has to remember. `personKey()` ([personIdentity.ts:38](../../../src/modules/candidates/domain/personIdentity.ts)) stays exactly where it is and gains a job in front of every write into `person_emails`; the CHECK is what makes it non-optional. `emailSpellings` stays for the *applications* read — those rows keep whatever the candidate typed.

### 1.6 `person_education` — dated, and the dates are usable

```sql
create table if not exists public.person_education (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  level text not null default 'other',
  institution text not null,
  degree text,
  field text,
  major text,
  minor text,
  graduation_year smallint,
  start_year smallint,
  end_year smallint,
  gpa numeric(4,2),
  honors text,
  as_written text,
  source text not null default 'hand_record',
  created_at timestamptz not null default now(),
  constraint person_education_pkey primary key (id),
  constraint person_education_level_check check (
    level in ('high_school','diploma','associate','bachelor','master','doctorate','vocational','other')
  ),
  constraint person_education_source_check check (
    source in ('hand_record','cv_extraction','candidate_form')
  ),
  constraint person_education_year_range_check check (
    (graduation_year is null or (graduation_year between 1950 and 2200))
    and (start_year is null or (start_year between 1950 and 2200))
    and (end_year is null or (end_year between 1950 and 2200))
  ),
  constraint person_education_gpa_check check (gpa is null or (gpa >= 0 and gpa <= 10)),
  constraint person_education_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);
create index if not exists person_education_person_idx
  on public.person_education (person_id, graduation_year desc nulls last);
```

`level` carries `high_school` because the questionnaire asks for it separately, and "highest level of education" is then `max(level)` by a stated order — a derived figure, never a stored one (§6).

### 1.7 `person_employment` — the table the indicators are built from

```sql
create table if not exists public.person_employment (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  employer text not null,
  title text,
  location text,
  employment_type text,
  start_year smallint not null,
  start_month smallint,
  end_year smallint,
  end_month smallint,
  ongoing boolean not null default false,
  duties text,
  as_written text,
  source text not null default 'hand_record',
  created_at timestamptz not null default now(),
  constraint person_employment_pkey primary key (id),
  constraint person_employment_year_range_check check (
    start_year between 1950 and 2200
    and (start_month is null or start_month between 1 and 12)
    and (end_year is null or end_year between 1950 and 2200)
    and (end_month is null or end_month between 1 and 12)
  ),
  constraint person_employment_no_end_before_start_check check (
    end_year is null or end_year >= start_year
  ),
  constraint person_employment_ongoing_has_no_end_check check (
    not (ongoing and (end_year is not null or end_month is not null))
  ),
  constraint person_employment_employer_length_check check (char_length(employer) between 1 and 160),
  constraint person_employment_source_check check (
    source in ('hand_record','cv_extraction','candidate_form')
  ),
  constraint person_employment_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);
create index if not exists person_employment_person_idx
  on public.person_employment (person_id, start_year desc);
```

**Why year and month columns instead of `date` + a precision flag.** A CV says "2019–2022" and "March 2021 to present". Postgres `date` cannot hold the first, and a `date` faked to `2019-01-01` is a claim the document never made. So a period is `start_year` plus a nullable `start_month`, and `as_written` keeps the exact string the CV used. Any indicator computed from a year-only row is *less precise than one computed from a month row*, and §6 makes the module say so rather than averaging the difference away.

### 1.8 `person_consents` — copied shape, person scope

```sql
create table if not exists public.person_consents (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  purpose text not null,
  granted boolean not null,
  notice_version text not null,
  door text not null,
  recorded_at timestamptz not null default now(),
  constraint person_consents_pkey primary key (id),
  constraint person_consents_purpose_check check (
    purpose in ('identity','contact','photo','work_history','education','languages',
                'marital_status','family_details','dependants','emergency_contacts',
                'health','housing','extraction')
  ),
  constraint person_consents_door_check check (
    door in ('hand_record','profile_edit','candidate_form','privacy_page','system')
  ),
  constraint person_consents_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);
create index if not exists person_consents_person_idx
  on public.person_consents (person_id, purpose, recorded_at desc);
```

Verbatim the `candidate_consents` discipline: one row per answer, never an edit, a withdrawal is a later row with `granted = false`, the newest row by `recorded_at` is the answer in force, `notice_version` names the wording it was given against. Group-level means the candidate who answers the health block and refuses the family block is recorded as two rows, and the writer's refusal text is: *"That question needs your agreement to this group. Nothing has been saved."* (§3).

`purpose = 'extraction'` is the record that a person's CV was handed to a model to be structured, which is a processing purpose of its own and should not hide behind `'work_history'`.

### 1.9 `person_events` — the change log, which is inside the boundary

```sql
create table if not exists public.person_events (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  field_key text not null,
  field_group text not null,
  old_value text,
  new_value text,
  door text not null,
  actor_id uuid,
  actor_kind text not null,
  recorded_at timestamptz not null default now(),
  constraint person_events_pkey primary key (id),
  constraint person_events_field_group_check check (
    field_group in ('identity','contact','work_history','education','languages','photo',
                    'marital_status','family_details','dependants','emergency_contacts',
                    'health','housing','extraction','merge')
  ),
  constraint person_events_door_check check (
    door in ('hand_record','profile_edit','cv_extraction','candidate_form','privacy_page','merge','system')
  ),
  constraint person_events_actor_kind_check check (
    actor_kind in ('staff','candidate','extractor','system')
  ),
  constraint person_events_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);
create index if not exists person_events_person_idx
  on public.person_events (person_id, recorded_at desc);
create index if not exists person_events_field_idx
  on public.person_events (person_id, field_key, recorded_at desc);
```

`field_group` is not the recruiter's choice; the writer stamps it from the registry. It is what lets the SELECT policy gate a single row by the sensitivity of the field it describes, instead of gating the whole table — which would either hide a marital-status change or expose a blood-type change.

`old_value`/`new_value` are text because a `date_of_birth`, a photo path and a list of children's names all have to live in the same two columns. Values longer than 500 characters are stored as their first 80 characters followed by `… [1,204 chars]` — a change trail that keeps whole medical narratives turns the trail into the largest copy of the sensitive data in the system, and a trail that keeps the full text of an accommodations answer is a second place that text must be erased from. The full value is always in its own table, which is where the reader gets it.

### 1.10 `applications.person_id`, RLS, grants, permissions

```sql
alter table public.applications
  add column if not exists person_id uuid;
comment on column public.applications.person_id is
  'The human this application belongs to, resolved from their address at the door that '
  'wrote the row. Nullable: applications predating 043 are backfilled here, and an '
  'erased application keeps its link to an anonymised person.';

grant select on table
  public.person_profiles, public.person_emails, public.person_languages,
  public.person_education, public.person_employment, public.person_events,
  public.person_consents, public.person_health, public.person_family_details,
  public.person_dependants, public.person_emergency_contacts
  to authenticated;
grant all on table
  public.person_profiles, public.person_emails, public.person_languages,
  public.person_education, public.person_employment, public.person_events,
  public.person_consents, public.person_health, public.person_family_details,
  public.person_dependants, public.person_emergency_contacts
  to service_role;
```

Every table: `alter table … enable row level security`, `drop policy if exists`, then policies named the way 041 names them.

| Table | SELECT for `authenticated` |
| --- | --- |
| `person_profiles`, `person_emails`, `person_languages`, `person_education`, `person_employment` | `is_staff()` |
| `person_events` | `is_staff() and (field_group <> 'health' or has_permission('candidates.view_health_data')) and (field_group not in ('family_details','dependants') or has_permission('candidates.view_family_data')) and (field_group <> 'emergency_contacts' or has_permission('candidates.view_emergency_contacts'))` |
| `person_health` | `is_staff() and has_permission('candidates.view_health_data')` |
| `person_family_details`, `person_dependants` | `is_staff() and has_permission('candidates.view_family_data')` |
| `person_emergency_contacts` | `is_staff() and has_permission('candidates.view_emergency_contacts')` |
| `person_consents` | `is_staff()` — *who agreed to what* is not itself the sensitive answer, and a desk that cannot see the absence of consent cannot explain an empty column |

No anon policy on any of them: this slice's doors are all staff-side. The public apply form writes into the spine in the form-builder amendment (§13), and when it does it goes through a server action on `service_role`, as `submitApplication` already does ([actions.ts:377](../../../src/app/careers/actions.ts)) — not through an anon policy.

Three permission rows, `on conflict (key) do nothing`, following [db/schema.sql:2388](../../../db/schema.sql):

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

The role matrix reads `permissions` from the database ([settings/actions.ts:38](../../../src/app/(admin)/settings/actions.ts) selects `key, label, group_name, description` and `PermissionMatrixCard.tsx:39` groups it), so the three rows appear there without a UI change. `PermissionKey` ([types.ts:20](../../../src/modules/settings/domain/types.ts)) gains three union members — that is a compile-time requirement, and the reason forgetting one is caught.

`docs/AUTHENTICATION.md` gains three rows in the permission table (`:92` region) and three columns of ticks in the role table (`:119` region).

### 1.11 The backfill, inside 043

```sql
-- 0. The addresses that name a surviving person, with the name their newest row carries.
create temp table if not exists backfill_people (
  email text primary key,
  legal_name text not null,
  phone text
) on commit drop;

insert into backfill_people (email, legal_name, phone)
select lower(a.email),
       (array_agg(a.full_name order by a.created_at desc))[1],
       (array_agg(a.phone order by a.created_at desc) filter (where a.phone is not null))[1]
from public.applications a
where a.erased_at is null
  and a.email not like '%@erased.invalid'
  and lower(a.email) ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'
group by lower(a.email)
having char_length((array_agg(a.full_name order by a.created_at desc))[1]) between 2 and 160;

/*
 * 1. One profile per address. The id is derived from the address rather than drawn
 * from gen_random_uuid(), because a backfill has to be re-runnable without a
 * mapping table: the same address resolves to the same person on the second run,
 * and step 3 finds the row step 1 created without joining on a name — which two
 * different people who share a name would break. Profiles created after this
 * migration take a random id as usual; the derived id is only ever a seed.
 */
insert into public.person_profiles (id, legal_name, phone)
select md5(bp.email || '|person-profile-spine')::uuid, bp.legal_name, bp.phone
from backfill_people bp
on conflict (id) do nothing;

-- 2. The address rows. Every person has exactly one address at this moment, so it
--    is the primary one; a merge or a second address is a human action later.
insert into public.person_emails (person_id, email, is_primary)
select md5(bp.email || '|person-profile-spine')::uuid, bp.email, true
from backfill_people bp
on conflict (email) do nothing;

-- 3. The link.
update public.applications a
  set person_id = pe.person_id
  from public.person_emails pe
  where a.erased_at is null
    and a.person_id is null
    and pe.email = lower(a.email);

drop table if exists backfill_people;
```

`having` sits on step 0 rather than on the inserts so a row whose name would violate `person_profiles_name_length_check` never becomes a profile *or* an address row — filtering at step 1 alone would leave step 2 inserting a `person_emails` row whose `person_id` does not exist, and the foreign key would abort the migration.

Three exclusions, each load-bearing:

- `a.email not like '%@erased.invalid'` — `erase_candidate_data` mints those addresses (`041_privacy.sql:405`), so without this the backfill invents people out of erased records, one per ghost address.
- The shape regex — `applications.email` is plain text with no CHECK ([personIdentity.ts:45](../../../src/modules/candidates/domain/personIdentity.ts) documents exactly this), and `person_emails` has one, so a legacy typo would abort the migration on a constraint violation.
- The `having char_length(...) between 2 and 160` — it matches the rule `submitApplication` already applies to a name ([actions.ts:377](../../../src/app/careers/actions.ts) onward) and `person_profiles.legal_name` states as a CHECK, and it is on step 0 rather than step 1 so a row that cannot become a profile cannot become an address row either.

A person whose rows disagree on the name takes the newest live row's, and every distinct older name is added as… nothing. It is left on the application, which keeps its own `full_name`. The spine does not overwrite history to unify it; the merge action (§3.4) is where a human decides.

The step is **idempotent by construction**: `on conflict (email) do nothing`, and step 3 only touches rows with `person_id is null`. Re-running 043 changes nothing.

`applications.person_id` gains no FK constraint in 043. Adding `references person_profiles(id)` to a table whose rows can predate a partially-failed backfill converts a data problem into a migration that cannot complete; the writer maintains the link and a proof query checks for orphans instead. *Known limits* carries it as a deferred constraint rather than a solved one.

## 2. The field registry — one declaration per field

`src/modules/candidates/domain/person-fields.ts`, pure, no imports from `app`:

```ts
export type PersonFieldGroup =
  | "identity" | "contact" | "work_history" | "education" | "languages" | "photo"
  | "marital_status" | "family_details" | "dependants" | "emergency_contacts"
  | "health" | "housing" | "extraction";

export type PersonFieldTier = 1 | 2 | 3;

export interface PersonField {
  key: string;                       // "marital_status", "date_of_birth"
  label: string;                     // "Marital status"
  group: PersonFieldGroup;           // consent purpose and event stamp
  tier: PersonFieldTier;             // 1 operational · 2 personal · 3 special category
  table: "person_profiles" | "person_health" | "person_family_details";
  column?: string;                   // profiles/health/family facts
  collection?: "education" | "employment" | "languages" | "dependants" | "emergency_contacts";
  input: "text" | "date" | "number" | "select" | "textarea" | "photo" | "list";
  options?: readonly string[];       // mirrors the SQL CHECK, never wider
  maxChars?: number;
  permission?: "candidates.view_health_data"
             | "candidates.view_family_data"
             | "candidates.view_emergency_contacts";
}

export const PERSON_FIELDS: readonly PersonField[] = [ /* …one entry per field… */ ];

export function personField(key: string): PersonField | null;
export function extractableFieldKeys(): string[];              // tier 1 lists only
export function fieldsForTier(tier: PersonFieldTier): PersonField[];
export function consentPurposeFor(key: string): PersonFieldGroup;
export function visibleFields(granted: ReadonlySet<string>): PersonField[];
```

The registry is the single answer to four questions, which is the reason it exists at all:

| Question | Consumer |
| --- | --- |
| May this value be written here? | `applyPersonField` refuses any key absent from the registry — a stray form field cannot reach SQL |
| Which consent purpose gates it? | the same writer, before the insert |
| Who may read it, and what group does its event carry? | the reader (§3.5) and the event stamp (§1.9) |
| Does it belong in the access copy, and out of an AI prompt? | §8 and §5 read the same `tier` |

The invariant the proof section pins: **no `tier: 3` field key may appear in any prompt, report row or export shape.** Verified by source-scanning the screening engine and the export loaders for registry Tier-3 keys, which is a mutation-proof rather than a code comment.

`options` mirrors the SQL CHECK and must not be wider; a control offering a value the column refuses is a promise the database will break. The proof asserts every `options` entry satisfies its `*_check` by name-matching — the same discipline §11 of the form-builder spec applies to its 17 types.

## 3. The one writer

`src/modules/candidates/application/personWriter.ts`. Every door — the record drawer, the profile editor, the extractor, the future application form — calls this. It is the only code that writes the spine.

### 3.1 The shape

```ts
export interface PersonFieldChange {
  key: string;
  value: unknown;
  door: "hand_record" | "profile_edit" | "cv_extraction" | "candidate_form" | "privacy_page" | "system";
  actorId: string | null;
  actorKind: "staff" | "candidate" | "extractor" | "system";
}

export interface PersonWriteResult {
  applied: string[];                 // keys written
  refused: { key: string; reason: string }[];   // named, never silently dropped
  conflicts: { key: string; held: string; incoming: string; winner: string }[];
  personId: string;
}

export async function applyPersonField(
  personId: string,
  changes: readonly PersonFieldChange[],
  consent: ConsentChecker
): Promise<PersonWriteResult | { error: string }>;
```

Refusals come back named. A door that silently swallows a rejected field is how a profile ends up quietly missing a marital status nobody was told was refused.

### 3.2 Consent before value

For each change, `consentAlive(personId, consentPurposeFor(key))` must be true. A live consent is the newest `person_consents` row for that purpose with `granted = true` against the current `notice_version` — the newest-row-wins rule 041 states in its own table comment ([041_privacy.sql:145](../../../db/migrations/041_privacy.sql)). Absent, refused, withdrawn, or given against an older notice → the field is refused with the reason naming the group, and **no value is written, including no empty placeholder**. This widens from the two purposes `planApplicationConsent` ([privacy.ts:94](../../../src/modules/privacy/domain/privacy.ts)) already decides for the apply form to the thirteen `person_consents` purposes, and it stays a pure planner in the same module: one function decides, so the door's refusal and the desk's explanation cannot drift apart.

Notice wording is a deliverable of this spec, in `src/modules/candidates/domain/person-notice.ts`: one paragraph per group saying why it is asked, who reads it, that it is not used to score, and how to withdraw. It is not legal advice and the file says so in a comment; it ships as the owner's draft for their own review.

### 3.3 The precedence ladder, in code

The rung is the **door's**, not the actor kind's. `actorKind` says who to blame in
the event; `door` says how much to believe them — and the two come apart at exactly
one place, the public application form, where the person really is the candidate and
nobody checked that they were the one typing.

```ts
const PRECEDENCE: Record<Door, number> = {
  privacy_page: 40,   // the candidate, holding the signed link sent to their own address
  hand_record: 30,    // a recruiter's hand, on the record they are editing
  profile_edit: 30,   // the same hand, later
  candidate_form: 20, // the candidate's own answer, at a door that cannot verify it
  cv_extraction: 10,  // a model reading a document
  system: 5,          // backfill, retention
};
```

- An incoming value from a **lower** rung never overwrites a higher rung's stored value. It is reported as a conflict (`held`, `incoming`, `winner`) and the door shows it. This is the rule that stops a bad CV parse from erasing what a recruiter typed.
- An incoming value from an **equal** rung overwrites — a recruiter correcting their own earlier entry, a candidate changing their own answer — and the event records both sides.
- `cv_extraction` may fill a field that is empty and nothing else, ever.
- `date_of_birth` is immutable after any human set it: only `privacy_page` may change it, and only with the reason recorded.

**Why `candidate_form` is one rung below a recruiter's hand.** The apply page is
anonymous: it knows an email address, not a person. At the top rung, anyone holding
a colleague's address could file an application that rewrote that person's marital
status, dependants or photo — the "single → married" self-correction and the
impersonation edit are the same write, and the store cannot tell them apart without
a session. So the form's answers land where a stranger's claim belongs: they **create** a profile, they win against a model's reading and against the backfill, they overwrite what the same mailbox typed last time (equal rung, both values in the event), and they lose to a value a recruiter put there by hand. The refusal is a conflict row the `/candidates` editor sees, and the fix is a human on the phone — not a silent accept. The candidate's **own application keeps their own answer either way**, because §1.5's snapshot is written before the ladder runs; the rung decides what the profile believes, never what was asked and answered.

### 3.4 Collections and merges are not overwrites

`person_education`, `person_employment`, `person_languages`, `person_dependants`, `person_emergency_contacts` are appended. Editing a row produces a new row and an event naming both ids; nothing in the spine updates a job's employer in place, because the *next* application is a different moment in that person's life. Duplicate rows are prevented by a stated rule (`unique (person_id, language)`, `unique (person_id, sequence)`) or by the writer's exact-match check on `(person_id, employer, start_year, end_year)`, which refuses the duplicate and says so.

`mergePersons(fromPersonId, toPersonId)` moves `person_emails` rows, repoints `applications.person_id`, appends `person_events` with `field_group = 'merge'`, and **refuses while any field has a different value in both profiles**, returning the list. The recruiter resolves each one. A silent merge is a person whose children's names came from the wrong profile and nobody can say when.

### 3.5 Reads are tiered, and Tier 3 is logged

`personReader.ts` composes `person_profiles` + Tier-1 lists, then asks for each grant and, only when granted, reads the Tier-3 tables. A denied grant is not an error and not an empty array printed as a fact: the reader returns `{ hidden: ["health", "family_details"] }` and the surface renders "Not shown to you".

Each successful Tier-3 read calls `recordActivity` with `action: "viewed"`, `entity: "person health data"` (a new `ACTIVITY_ENTITIES` entry, [trail.ts:70](../../../src/modules/activity/domain/trail.ts)), the person id, and the area `"candidates"`. One row per open, not per field.

## 4. The record door: hand-record with a CV

`createCandidate` ([candidate-actions.ts:864](../../../src/app/(admin)/candidates/candidate-actions.ts)) today takes `{jobId, fullName, email, phone?, source}` and inserts one `applications` row. It becomes the door the owner asked for.

**Input gains:** `cvFilePath?`, `cvFileBytes?` handled by the existing upload route, `photoPath?`, and `person?: PersonFieldChange[]` — an array of registry keys, so the drawer's controls are generated from the registry rather than mirrored by hand.

**Order, and why each step is where it is:**

1. `hasPermissionForUser("candidates.write")` — unchanged ([candidate-actions.ts:873](../../../src/app/(admin)/candidates/candidate-actions.ts)).
2. Validate the person changes against the registry, then the consent checker. A refusal here means **no byte is stored**: a rejected CV should not sit on disk under a path nobody references.
3. Resolve the person: `person_emails` by `personKey(email)`, else create `person_profiles` + `person_emails` in one service-role transaction. The name on the profile is the one the door was given, not the one the CV says — an unverified model reading is not where a person's legal name comes from.
4. Store the CV in `candidate-cvs` at `applications/<jobId>/<uuid>-<leaf>` — the shape the career site already writes and the path `collectPaths` reads ([erasure.ts:31](../../../src/modules/privacy/application/erasure.ts)). **Not `resumes`**: that bucket's rows live in `application_attachments`, whose CHECK is limited to `('resumes','candidate-audio')` ([db/schema.sql:773](../../../db/schema.sql)), and a CV filed there would need its own erasure read.
5. `extractCvText` → `cv_text`, using the same extension→mime mapping and the same silent-failure tolerance the apply action already has ([actions.ts:480](../../../src/app/careers/actions.ts) onward). The existing overwrite behaviour in the legacy path is **not** changed by this slice — it is named in *Surfaces this slice must not touch*.
6. Insert `applications` with `person_id` set.
7. Photo in `candidate-photos` at `persons/<personId>/<uuid>.<ext>`, `person_profiles.photo_path`.
8. Apply the person changes through `applyPersonField` with `door: "hand_record"`.
9. `recordActivity` — the application and the person are two entities, and the trail names which fields changed.

**Failure rule:** steps 4-8 are one unit. If the `applications` insert fails after the byte landed, the byte is removed before the action returns, and the message says the record was not created. A candidate whose recruiter cannot find is a candidate whose CV is on our disk for no reason.

**The drawer** ([NewCandidateDrawer.tsx](../../../src/app/(admin)/candidates/NewCandidateDrawer.tsx)) gains a CV file input (reusing `attachmentRule("resumes")`'s type list and `CV_MAX_MB`), a photo control, and collapsible groups whose Tier-3 sections render only for a holder of the matching grant. The subtitle at `:146` is rewritten: it currently tells the recruiter to attach a CV *after* creating the record, which stops being true.

`POST /api/files/upload` is reused for the bytes; its `candidates.write` gate ([upload/route.ts:35](../../../src/app/api/files/upload/route.ts)) already matches.

## 5. Extraction: CV text → dated Tier-1 rows

`src/modules/candidates/infrastructure/cvProfileExtract.ts`, one function over the existing gateway:

```ts
export async function extractPersonProfile(
  cvText: string,
  hints: { name?: string | null; email?: string | null } = {}
): Promise<ExtractedPersonProfile>;
```

**Reuses** `resume_screening` for routing (its own comment at [profile-extract.ts:17](../../../src/modules/sourcing/infrastructure/profile-extract.ts) argues the case: a document being turned into structured facts about a person, one model list in Settings rather than two), the `complete()`/`parseJsonResponse` pair, `temperature: 0.1`, the 28,000-character input slice, and `describeExtractionFailure`'s two-way split between a truncated answer and a refused chain.

**Does not reuse** `normalizeProspectProfile`, whose whole job is to keep dates as the strings the model was told to preserve. Dates here must become `start_year`/`start_month`, so the extraction schema asks for numbers with a stated granularity and one `as_written` string:

```json
{
  "experience": [{ "employer": string, "title": string, "location": string,
                   "start_year": number, "start_month": number | null,
                   "end_year": number | null, "end_month": number | null,
                   "ongoing": boolean, "duties": string, "as_written": string }],
  "education":  [{ "institution": string, "level": string, "degree": string,
                   "field": string, "graduation_year": number | null,
                   "gpa": number | null, "honors": string, "as_written": string }],
  "languages":  [{ "language": string, "proficiency": string }],
  "skills":     string[],
  "location":   string
}
```

The prompt inherits every rule the prospect prompt already states — never invent, keep spellings, omit an empty section — and adds two of its own: **"Convert a date only when the text states a month by name or number. Never guess a month from a season, a school year or a holiday."** and **"Report nothing about marriage, children, health, disability, religion, nationality, blood type, housing or an address. If the text states them, ignore them."**

A prompt instruction is a wish, so the boundary is code:

```ts
export function validateExtractedPersonProfile(raw: unknown):
  { value: ExtractedPersonProfile; dropped: string[] }
```

Any key outside `extractableFieldKeys()` — Tier 1 only — is dropped and **named** in `dropped`, which the door prints ("Ignored 2 fields the extractor is not allowed to write: `marital_status`, `nationality`"). An extractor that returns a health answer is evidence of a prompt leak, and the only honest response is to say so out loud rather than quietly drop it. This is the form-builder spec's drop-and-name discipline applied to the AI boundary.

**It is a click.** The record door and the profile page offer "Structure it from the CV"; nothing calls it automatically. A recruiter filing a name and an email must not cause a person's CV to be sent to a model, and a free-tier chain that 429s (a documented condition, not a hypothesis) must not be on the critical path of creating a record. The result previews — N roles, M schools, with each row's `as_written` beside the parsed period — and the recruiter confirms. Only then does `applyPersonField` run, at `cv_extraction` precedence, so it can fill an empty field and never a human's.

## 6. Indicators: what the notes actually asked for

`src/modules/candidates/domain/careerIndicators.ts`, pure, no database:

```ts
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
export function computeCareerIndicators(
  roles: readonly EmploymentRow[],
  now: Date
): CareerIndicators;
```

An ongoing role is counted to `now`. A year-only period counts 12 months, or the remainder to `now` if it is the last role, and contributes to `coverage.withMonths`, which the surface prints: **"Total 9.4 years — 3 of 5 roles state a month, the rest are counted as whole years."** A figure that silently treats "2019" as January is a fabricated precision, and the owner will make hiring decisions on it.

`job_stability` is deliberately not a score. It is four numbers and a caveat list, and no verdict is attached to anyone's marriage or children count. The design's contribution to the 50→30→15 funnel is that a recruiter can read the numbers off the profile; converting them into a ranking is a separate slice with a separate decision, because a stability score computed from a form a candidate filled in bad faith penalises exactly the people whose CVs are untidiest.

"Highest education" is derived, in a stated order (`doctorate > master > bachelor > associate > vocational > diploma > high_school`), never a column.

## 7. The profile surfaces

`/candidates/[id]` stays the only place a person is seen. **No new staff route**, so the four-place registration contract (`STAFF_ROUTES`, `NAV`, `PAGE_GUIDE`, `LIVE_WATCH`) and the 18-path count pinned in `scripts/prove-job-distribution.mjs:505` and `scripts/check-staff-routes.mjs` do **not** move. That is a deliberate saving: this slice's cost is in the store and the boundary, not in the portal tables.

- **"Who they are" ([page.tsx:135](../../../src/app/(admin)/candidates/%5Bid%5D/page.tsx))** — the card the page already has, now fed by `personReader`: legal and preferred name, age with the date beside it, nationality, languages, city, photo. `getCandidateProfile` ([profile.ts:348](../../../src/app/(admin)/candidates/%5Bid%5D/profile.ts)) resolves the person through `person_emails` and keeps its `.in("email", emailSpellings(email))` read at `:386` — the application rows stay the spine's evidence, and the spine does not replace them.
- **New tabs beside the existing ones:** History (education and employment, each with `as_written` and the source door), Background (Tier 2), Health (Tier 3, or "Not shown to you"), Family (Tier 3), Changes (`person_events`, tier-filtered). The page's read-only stance ([page.tsx:212](../../../src/app/(admin)/candidates/%5Bid%5D/page.tsx)) becomes read-and-edit for the fields the actor holds; the drawer pattern is the one the candidate record already uses for contact details (task #50).
- **Indicators** render as one strip above History, with the coverage caveat in the same text, not in a tooltip.
- **`/files`** shows `candidate-photos` as a fifth bucket with an honest `writtenBy` line, and `unlinkReference` gains the `person_profiles.photo_path` target ([files/actions.ts:512](../../../src/app/(admin)/files/actions.ts)) — a deleted photo must clear the column that names it, or the profile offers an image that 404s.

## 8. Privacy: erasure, access copy, retention

### 8.1 Erasure

The existing order is kept — blockers, then bytes, then the row — and the person hangs off the end of it.

1. `collectPaths` ([erasure.ts:80](../../../src/modules/privacy/application/erasure.ts)) gains a **fourth read**: `person_profiles.photo_path` → `candidate-photos`, resolved through the application's `person_id`. Today it enumerates exactly three sources; a photo added without a read there is a byte that survives an erasure request while the paperwork says it did not.
2. `erase_candidate_data(uuid)` is **not** rewritten by 043. It erases the application row and leaves `applications.person_id` in place, pointing at a profile that may by then be anonymised; the paragraph under the function below states why the link survives.
3. After a successful per-application erasure, `eraseApplication` calls `erasePersonIfLast(personId)`: count `applications` where `person_id = X and erased_at is null`; at zero, execute `erase_person_data(uuid)`.

```sql
create or replace function public.erase_person_data(p_person_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from person_profiles where id = p_person_id) then
    return jsonb_build_object('person_id', p_person_id, 'erased', false, 'reason', 'no such person');
  end if;

  if exists (select 1 from applications where person_id = p_person_id and erased_at is null) then
    return jsonb_build_object('person_id', p_person_id, 'erased', false, 'reason', 'an application still lives');
  end if;

  delete from person_health           where person_id = p_person_id;
  delete from person_family_details   where person_id = p_person_id;
  delete from person_dependants       where person_id = p_person_id;
  delete from person_emergency_contacts where person_id = p_person_id;
  delete from person_education        where person_id = p_person_id;
  delete from person_employment       where person_id = p_person_id;
  delete from person_languages        where person_id = p_person_id;
  delete from person_events           where person_id = p_person_id;
  delete from person_consents         where person_id = p_person_id;
  delete from person_emails           where person_id = p_person_id;

  update person_profiles
     set legal_name = 'Erased person', preferred_name = null, pronouns = null,
         gender = null, date_of_birth = null, birthplace = null, national_id = null,
         nationality = null, photo_path = null, photo_mime = null, mailing_address = null,
         current_city = null, phone = null, marital_status = null, children_count = null,
         household_size = null, housing_tenure = null, commute_mode = null,
         commute_minutes = null, relocation_willingness = null, travel_restrictions = null,
         erased_at = coalesce(erased_at, now()), updated_at = now()
   where id = p_person_id;

  return jsonb_build_object('person_id', p_person_id, 'erased', true, 'erased_at', now());
end;
$$;
revoke all on function public.erase_person_data(uuid) from public, anon, authenticated;
grant execute on function public.erase_person_data(uuid) to service_role;
```

Third-party rows are **deleted**, not anonymised: a child renamed to "Erased" is a record of a person who never existed. Consent rows go with them — the erasure itself is already evidenced by `privacy_requests` and the application row's `erased_at`. `applications.person_id` survives pointing at an anonymised profile, because the pipeline needs to say an application was judged and the link is the only place "these four rows were one human" is recorded. `person_profiles` is anonymised rather than deleted to keep that fact without keeping the person.

`erased_at` on `person_profiles` is also the backfill's exclusion filter (§1.11), so an erased person is never re-linked by a later run.

### 8.2 The access copy

`readApplications` ([accessCopy.ts](../../../src/modules/privacy/application/accessCopy.ts)) selects seven columns today and omits `cv_file_path`, `gate_answers` and every person fact — which means a subject-access request currently returns *less* than the portal shows. 043 makes the copy the truth:

- Tier-1 and Tier-2 fields, education, employment, languages, the photo, and `person_events` — the requester's own data, which they are entitled to see including what they consented to.
- Tier-3 tables read on `service_role` (RLS binds staff sessions, not the DSAR path) and rendered **only** in the document the token-holder opens. Nothing is added to an email subject or body: a Gmail message is not a secure channel for a blood type.
- Third-party rows are included with a stated note — the child's name and date of birth are the requester's own data as they gave it; the emergency contact's phone number is someone else's, and the copy names that rather than pretending.
- Existing caps extend: `MAX_ANSWERS = 300`, `MAX_ANSWER_CHARS = 4_000`, `MAX_APPLICATIONS = 20` become one table of limits in §11.

### 8.3 Retention

No new cron pass. The sweep already erases applications ([retention/route.ts](../../../src/app/api/cron/retention/route.ts) → `eraseApplication`), and a person goes when their last application does. Two consequences stated so nobody is surprised:

- A person with twelve applications over six years stays whole until the twelfth is erased. That is correct — the record of the person is the union of their live applications — and it means retention `months` is a per-application clock, not a per-person one.
- When `privacy.retention_enabled` is off, nothing is erased, person included. This slice does not add a sweep that runs regardless of the switch; the form-builder spec's orphan-upload pass has its own reasoning and stays in that slice.

## 9. Failure behaviour — degrade the page, never the record

| Condition | What happens |
| --- | --- |
| 043 not applied | Every spine read catches `isMissingSchemaError` and returns `{ available: false, note }`. "Who they are" renders from `applications` exactly as today, with one line: *Person details need migration 043.* The record door refuses a person write and says which migration; the CV file still lands and the application is still created, because that path exists today. |
| A model refuses the chain | The preview never appears; `describeExtractionFailure`'s sentence is printed; the record stays as filed. Extraction failure is never a record failure. |
| Consent missing for a group | Those fields refuse, named. The rest of the write completes. A half-saved profile is not a privacy failure — the refused values simply are not there. |
| Byte stored, then insert fails | The byte is removed before returning; the action reports the record was not created. |
| RLS refuses a Tier-3 read | `{ hidden: [...] }` → "Not shown to you". Never `[]` rendered as "no children", which is a fabricated fact about a person. |
| Merge with conflicting fields | Refused, listing each field and both values. |
| A `person_id` orphan after a partial run | A proof query counts them; the profile falls back to the email read, which still works, because `getCandidateProfile` never depended on `person_id`. |

The page never blanks because the spine is missing, and the record never half-writes because the page is degraded — the same two rules the notes desk and the requisition-skills slice already follow.

## 10. Security boundaries

- **RLS is the read gate, the writer is the write gate.** No anon policy exists on any spine table; every staff write is authorised by `hasPermissionForUser` in the action before the service-role write, as `submitApplication` already does. The three Tier-3 grants bind both the SQL policy and the reader, so a table is unreachable through a hand-built REST call.
- **`erase_person_data` is `security definer`, `search_path = public`, service-role execute only**, revoked from `public`, `anon`, `authenticated` — byte-for-byte 041's hardening at `:499`.
- **The extractor sees Tier-1 text and nothing else.** It is fed `cv_text`, never `person_health`, `person_family_details` or `person_events`. The special-category store being separate tables is what makes this assertable by source scan rather than by care.
- **No prompt contains another candidate's data.** One CV in, one profile out; no few-shot examples drawn from live rows.
- **The photo is excluded from blind grading by construction.** `scores.view_unmasked` and the existing mask rule govern names; the photo is not in the surfaces a reviewer sees, and the proof asserts no component under `/assessments` reads `photo_path`.
- **Upload routes re-check size before buffering and content by magic bytes**, the same two rules the form-builder spec §5 sets for its uploads, using `CV_MAX_MB`/`cvContentError` for the CV and 5 MB + `image/jpeg,image/png,image/webp` + magic-byte checks (`\xff\xd8`, `\x89PNG`, `RIFF….WEBP`) for the photo.
- **`national_id` is stored in a plain column.** The disk store has no encryption at rest and Postgres is not encrypted on this deployment; *Known limits* states it as an exposure rather than a solved problem, and the notice the candidate sees must say so.

## 11. Limits

One module, `src/modules/candidates/domain/person-limits.ts`, cited by every control and message.

| What | Limit |
| --- | --- |
| Fields on `person_profiles` | fixed by the table — no dynamic fields here; that is the form builder's job |
| `person_education` rows | 60 |
| `person_employment` rows | 80 (a 21-year career with short contracts fits; the notes' example demands it) |
| `person_languages` rows | 20 |
| `person_dependants` rows | 20 |
| `person_emergency_contacts` | 2 |
| `person_events` rows per person | unbounded; read capped at the newest 500 |
| Text: name / employer / institution | 160 |
| Text: duties, accommodations, conditions, allergies | 2,000 |
| Text: `as_written`, mailing address, honors | 500 |
| `person_events` value columns | 500, then a length-and-hash note |
| Photo | 5 MB, jpeg/png/webp |
| CV file | 5 MB (`CV_MAX_MB`), pdf/docx/doc/txt as the apply path already accepts |
| Extraction input | 28,000 characters (matching `extractProfile`), output 3,000 tokens |
| Access copy | 20 applications, 300 answers, 4,000 characters per answer, plus 200 education and 200 employment rows |

## 12. i18n

Every label is an `en`/`ar` key, because every public-adjacent surface in this project is bilingual and a half-translated profile page is the one place a candidate's own facts go wrong under a machine guess. Keys live under `candidates.person.*`, `candidates.health.*`, `candidates.family.*`, `candidates.indicators.*`. Arabic wording for a medical or family field is reviewed by a human, not drafted by the `translation` capability, and the file comment says so.

## 13. What the form-builder spec must change

The owner's chosen option was: this spine first, then the form-builder spec amended to write into it before its plan is executed. The amendment list, to be applied as a separate commit so the approved spec's own decisions are not silently rewritten:

1. Migration number `043` → **`044`**, and "authored, not applied" restated from the real directory listing (043 does not exist yet either).
2. Its `applications.form_answers` jsonb stays, but the **person facts among those answers** (`name`, `email`, `phone`, plus any field bound to a registry key) route through `applyPersonField` with `door: "candidate_form"`, `actorKind: "candidate"`. Custom answers stay per-application; identity and background become per-person. **Applying this item changed §3.3 of this spec**: the apply page is anonymous, so `candidate_form` sits one rung *below* a recruiter's hand rather than at the top — an applicant's answer always survives in that application's snapshot, and what the profile believes is the ladder's decision. The rung belongs to the door, not the actor kind.
3. Its `candidate-photos` bucket and `photo` field type defer to this spec's §1 bucket, policies, path shape and `unlinkReference` target. One bucket, one contract; the form is the second door into it, and the anon `files` insert policy is the form-builder's to add.
4. Its §8 erasure section: `collectPaths` gains two reads, the photo **here** in 043 and the form files in 044. The 044 spec must stop claiming the photo read as its own.
5. Its consent step gains a per-group consent write into `person_consents` whenever a rendered field maps to a registry key, using this spec's checker rather than a second one.
6. Its `system_key` vocabulary grows a `person:` binding so an authored field can name `date_of_birth` and land in the right table instead of in `form_answers`.
7. From the same read of that spec's security section, three constraints this slice must own rather than leave to it. **The ladder rung above is one of them.** The other two: a field bound to a consent-gated group must not be markable `required` — a mandatory medical question trades health data for an interview — so the rule is enforced by *this* spec's registry and its checker, and the form-builder's publish action inherits it rather than inventing it; and this slice's `unlinkReference` for `candidate-photos` clears `person_profiles.photo_path` and nothing else, so a photo an applicant uploaded and never submitted — a byte no profile ever referenced — is reachable only by the form-builder's orphan pass. The spine must not assume its own reference-clearing covers a byte with no reference.
8. Nothing else. The amendment must not change that spec's six decisions, its 17 field types, its layout rules, its ceilings, its console behaviour, or its `ApplyWizard` fallback.

## Not in this slice

- The form builder itself (spec approved, plan deferred behind §13).
- Writing the spine from the public apply page — the only self-service door is §4's staff record door.
- The candidate portal: no `(candidate)` route, no `NoticeInbox`, no `communication_logs` read or dismiss. The owner's standing instruction.
- Level-weighted scoring, and any use of a background field in scoring. The notes ask for it; it is a decision with a discrimination exposure and it does not ship inside a store slice.
- Timed multi-test sequencing, the 24-48-72h follow-up discipline, and job descriptions with daily-work scope.
- Analytics, reports or exports over Tier 2 or Tier 3. Anonymised aggregate demographic reporting is a separate design with its own basis.
- Skill-catalogue matching against `person_employment.duties`, and the `candidate_skills` roll-up.
- Encrypting `national_id`, and any self-service correction door for the candidate.

## Proof

`scripts/prove-person-spine.mjs` in the house plain-Node style (`check`, `sourceHas`, the `registerHooks` `@/` resolver, no jest).

**Domain, from fixtures:**
1. `PERSON_FIELDS` is the only key source: an unknown key refuses, and every registry key maps to a real table.
2. Precedence, by door: `privacy_page` beats `hand_record` beats `candidate_form` beats `cv_extraction` beats `system`; `cv_extraction` fills empty and never overwrites; equal rungs overwrite with both values in the event; the six `PRECEDENCE` keys are exactly the §1.9 `person_events_door_check` values minus `merge`, so a door that writes cannot be a door the ladder forgot.
3. `date_of_birth` accepts the first human write, then refuses a later `cv_extraction`, `hand_record` and `candidate_form` write, and accepts `privacy_page` with the reason recorded.
4. Consent: absent / refused / withdrawn / older-notice all refuse, naming the group; a withdrawal row does not delete the value, the value is withheld by the reader and the writer refuses the next change.
5. Tier-3 keys appear in no `extractableFieldKeys()` output.
6. Indicators: month-precise sums, ongoing counted to `now`, year-only roles counted as whole years **and disclosed in `coverage`**; a gap sequence sums to the stated months.
7. `validateExtractedPersonProfile` drops and names a `marital_status` and a `nationality` key from a simulated model answer.

**SQL, against the applied migration on the local stack:**
8. `person_emails.email = lower(email)` rejects a mixed-case write.
9. One primary index rejects a second primary for one person.
10. `person_employment` rejects `ongoing` with an `end_year`, and an end before a start.
11. A staff session without `candidates.view_health_data` reads zero `person_health` rows **and zero `person_events` rows in the health group**, while still reading its marital-status history.
12. `erase_person_data` refuses while a live application links, erases after, and leaves `applications.person_id` pointing at an anonymised row.
13. The backfill creates no profile for an `@erased.invalid` address, and is idempotent when run twice.

**Boundaries, by source scan:**
14. No Tier-3 registry key appears in `src/modules/screening/**`, in the export loaders, or in any file under `src/app/(admin)/assessments`.
15. `photo_path` is read by no component under `src/app/(candidate)` or `src/app/(admin)/assessments`.
16. `collectPaths` counts four reads, and the fourth names `candidate-photos`.
17. `candidate-photos` exists in `BucketKey`, in `BUCKETS`, in `ownersFor`, in `unlinkReference`, and in 043's `files` policies — five places, one bucket.
18. `PermissionKey` has the three new members and the migration seeds three `permissions` rows; the counts match.
19. The staff route count is **still 18** and `scripts/check-staff-routes.mjs` passes untouched.

**Mutation proofs** — each must turn a check red, or the check proves nothing:
- add a Tier-3 key to `extractableFieldKeys()` → 7 and 5 fail;
- drop `field_group` from the `person_events` policy → 11 fails;
- delete the `@erased.invalid` filter from the backfill → 13 fails;
- change `cv_extraction` precedence above `hand_record` → 2 fails;
- put `candidate_form` on the top rung → 2 fails, which is the only proof here that
  catches an anonymous door being promoted into an impersonation door;
- remove the photo read from `collectPaths` → 16 fails.

**Gates:** `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`; `npm run lint` (the two tolerated warnings, no new ones); `node scripts/prove-person-spine.mjs`; `node scripts/check-staff-routes.mjs`.

**Live proof** needs 041 and 043 applied — owner approval per file, migrations never applied on inference — then: record a candidate by hand with a real CV, click Structure it, read the indicators off the profile, sign in as a role without the health grant and see "Not shown to you", delete the photo from `/files` and watch `photo_path` clear, then erase the person through the privacy desk and confirm the byte, the profile and every dependant row are gone.

## Known limits

- **One identity, one address.** Two people sharing a mailbox are one person here; one person with two addresses is two until a recruiter merges them. Phone-number identity was not designed in.
- **No FK on `applications.person_id`.** The writer maintains it and a proof counts orphans; referential integrity is deferred to a 044-or-later `not valid` constraint once the backfill has run on real data.
- **Tier-3 values sit in plain columns on an unencrypted disk.** A stolen `pg_dump` is a stolen medical file. §10 says so; only a separate keystore fixes it.
- **`person_events` keeps old Tier-3 values until the person is erased.** The change log is the boundary (§1.9), which handles reading; it does not make the trail small.
- **Extraction quality is the model's.** Untidiest CVs produce the fewest rows, and a free tier that 429s or 503s mid-chain is a documented condition here, not a hypothesis — which is why the door works without it.
- **Age needs a timezone to be a fact.** Derived against `organisation.timezone` the way the portal's other clock-dependent readings are; a candidate near a birthday can see "34" and "35" on different days, and the DOB is always printed beside it.
- **Consent is group-level, not field-level.** Refusing the health group hides every question inside it; a per-field basis was considered and rejected as a form-builder concern, not a store one.
- **The four groups with no screening purpose stay collectable.** Blood type, dietary restrictions, future family planning and housing tenure are asked because the owner asked for everything on the list. Nothing in this design makes them defensible as hiring inputs; *Not in this slice* excludes background fields from scoring, which limits the damage. The owner can drop all four by deleting four registry entries and their columns, and that is a smaller decision than the one this slice makes.

## Surfaces this slice must not touch

- `src/app/(candidate)/**` — the candidate portal, `NoticeInbox`, `communication_logs`.
- `submitApplication`'s CV handling ([actions.ts:480](../../../src/app/careers/actions.ts) onward) and its `cv_text` composition. The legacy overwrite at the extract step stays exactly as it is; changing it is the form-builder's job under its own §4.
- The 18-place staff route contract, `STAFF_ROUTES`, `NAV`, `LIVE_WATCH.paths`, `PAGE_GUIDE`, `robots.ts`.
- `scoreVisibility.ts` and the blind-grading mask — reused as the precedent, not edited.
- `application_attachments`' bucket CHECK — the spine stores the photo path on the person, so no new attachment kind is needed.
- `planRetention`, `nextRetentionAction`, `privacy.retention_enabled` — retention reads the person only through `eraseApplication`.
- `normalizeProspectProfile` and `sourced_prospects` — the prospect path keeps its own dates-as-written contract; §5 copies its discipline, not its code.

## Sources

| Cited | Where |
| --- | --- |
| The person-is-an-email convention | `src/modules/candidates/domain/personIdentity.ts:38`, `:52`, `:60`, `:78` |
| The profile read | `src/app/(admin)/candidates/[id]/profile.ts:348`, `:386` |
| The "Who they are" card, the read-only stance | `src/app/(admin)/candidates/[id]/page.tsx:68`, `:135`, `:212` |
| The hand-record door and its five fields | `src/app/(admin)/candidates/candidate-actions.ts:864`, `:873`; `NewCandidateDrawer.tsx:136`, `:144`, `:162`, `:187`, `:201`, `:220`, `:232` |
| Consent shape being copied | `db/migrations/041_privacy.sql:131`, `:140`, `:150`, `:154` |
| Erasure function, guards, blanking, hardening | `041_privacy.sql:359`, `:380`, `:385`, `:394`, `:405`, `:467`, `:499` |
| The three byte sources erasure knows | `src/modules/privacy/application/erasure.ts:31`, `:61`, `:80`, `:91`, `:142`, `:203` |
| Files table and its bucket policies | `db/schema.sql:2650`, `:2667`, `:2676`, `:2686`, `:2696`, `:2706` |
| Attachment bucket CHECK's two names | `db/schema.sql:773`, `:2020` |
| Bucket contract in the File Manager | `src/app/(admin)/files/file-browser-types.ts:13`, `:24`, `:55`; `src/app/(admin)/files/actions.ts:295`, `:512` |
| The extractor and its discipline | `src/modules/sourcing/infrastructure/profile-extract.ts:17`, `:22`, `:29`, `:87`, `:103`, `:107` |
| Mask-by-default grant | `src/modules/settings/application/scoreVisibility.ts:30` |
| Permission union and its seed | `src/modules/settings/domain/types.ts:20`; `db/schema.sql:2388`, `:2414`; `db/migrations/001_settings_rbac.sql:150` |
| The matrix reads the table | `src/app/(admin)/settings/actions.ts:38`; `PermissionMatrixCard.tsx:39` |
| Activity vocabulary | `src/modules/activity/domain/trail.ts:47`, `:70`, `:102`; `src/modules/activity/application/record.ts:78` |
| CV rules the staff door reuses | `src/modules/careers/cv-rules.ts:10`, `:19`, `:71`; `src/modules/careers/attachment-rules.ts` |
| The apply action and its insert | `src/app/careers/actions.ts:342`, `:377`, `:480`, `:518` |
| The upload door's own gate | `src/app/api/files/upload/route.ts:35` |
| Access-copy caps | `src/modules/privacy/application/accessCopy.ts` (`MAX_ANSWERS`, `MAX_ANSWER_CHARS`, `MAX_APPLICATIONS`) |
| The retention sweep's only person path | `src/app/api/cron/retention/route.ts` |
| Opening seniority is a job property, not a person one | `db/migrations/033_opening_terms.sql:42` |
