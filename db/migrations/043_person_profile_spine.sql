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

-- ----------------------------------------------------------------------------
-- §1.1 person_profiles — the person, and only their own facts
--
-- No email column. One copy of any fact is the rule, and person_emails is the
-- only place an address is stored (§1.5).
-- ----------------------------------------------------------------------------

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

comment on table public.person_profiles is
  'One row per human — the person behind the applications. Holds only this '
  'person''s own facts: an address lives in person_emails, another person''s '
  'name in the Tier-3 tables, and every change in person_events.';

comment on column public.person_profiles.gender is
  'Tier 2 free-ish text with no enum check: a two-value check on a person''s '
  'identity is a lie the database tells. The value is what the person wrote.';

comment on column public.person_profiles.pronouns is
  'Tier 2, stated in the person''s own words, never inferred from a name, a '
  'photo or a CV pronoun. The value is what the person wrote.';

comment on column public.person_profiles.children_count is
  'A count the candidate or recruiter states, not a count of person_dependants '
  'rows. Deriving it would make RLS answer 0 to a reader who cannot see the '
  'rows — a fabricated figure dressed as a fact. Where both exist, the writer '
  'records the disagreement as an event rather than silently reconciling it.';

comment on column public.person_profiles.photo_path is
  'Tier 2 and never in a model: the byte lives in candidate-photos at '
  'persons/<personId>/<uuid>.<ext>; the photo is excluded from every prompt, '
  'screening surface and export by the same rule blind grading already applies.';

comment on column public.person_profiles.erased_at is
  'Set by erase_person_data(). The profile is anonymised, not deleted, so the '
  'pipeline can still say an application was judged; a non-null value also '
  'keeps the backfill (§1.12) from ever re-linking an erased person.';

-- ----------------------------------------------------------------------------
-- §1.2 person_health — special category, own table, own grant
--
-- The row exists only once someone has written it, and absence has three
-- readings: no row and no 'health' consent row = never asked; a granted =
-- false consent row = asked and refused, no value stored; a row with all
-- columns null = asked, agreed, answered nothing.
-- ----------------------------------------------------------------------------

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

comment on table public.person_health is
  'Tier 3: the health and disability answers, in their own table behind '
  'candidates.view_health_data so a select * from person_profiles cannot leak '
  'them and the only way to read a health answer is to name this table. Rows '
  'are deleted, not anonymised, on erasure.';

-- ----------------------------------------------------------------------------
-- §1.3 person_family_details and person_dependants
-- ----------------------------------------------------------------------------

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

comment on table public.person_family_details is
  'Other people''s data, held because the candidate volunteered it. Tier 3 '
  'behind candidates.view_family_data. On erasure these rows are deleted, not '
  'anonymised: anonymising a third party''s name to "Erased" invents a record '
  'of someone who never existed.';

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

comment on table public.person_dependants is
  'Other people''s data, held because the candidate volunteered it. Tier 3 '
  'behind candidates.view_family_data; an append-only collection, never an '
  'overwrite. A named child''s row is deleted on erasure, not anonymised.';

create index if not exists person_dependants_person_idx
  on public.person_dependants (person_id, date_of_birth);

-- ----------------------------------------------------------------------------
-- §1.4 person_emergency_contacts
--
-- Two, because the questionnaire asks for a primary and a secondary. Held
-- under its own grant for a distinct reason: the purpose is safety, not
-- screening, and giving an office manager the door to that purpose must not
-- hand them a medical file.
-- ----------------------------------------------------------------------------

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

comment on table public.person_emergency_contacts is
  'Contacts held for safety, not screening, behind '
  'candidates.view_emergency_contacts. Other people''s data: deleted, not '
  'anonymised, when the person is erased.';

-- ----------------------------------------------------------------------------
-- §1.5 person_emails, person_languages
--
-- The lower(email) CHECK is the identity rule stated in SQL instead of in a
-- TypeScript function that each door has to remember.
-- ----------------------------------------------------------------------------

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

comment on table public.person_emails is
  'The identity table: the only place an address is stored, because one copy '
  'of any fact is the rule. Two addresses for one person are two rows on one '
  'profile, once someone says so — through a merge action, never silently.';

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

comment on table public.person_languages is
  'Language claims with a stated proficiency; one row per (person, language). '
  'Tier 1 — a CV says them and an interview asks them.';

-- ----------------------------------------------------------------------------
-- §1.6 person_education — dated, and the dates are usable
-- ----------------------------------------------------------------------------

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

comment on table public.person_education is
  'Dated schooling rows; "highest level of education" is derived from these '
  'by a stated order, never a stored column. as_written keeps the exact '
  'string the CV used beside the parsed value.';

create index if not exists person_education_person_idx
  on public.person_education (person_id, graduation_year desc nulls last);

-- ----------------------------------------------------------------------------
-- §1.7 person_employment — the table the indicators are built from
--
-- Year and month columns instead of a date + a precision flag: a CV says
-- "2019–2022" and Postgres date cannot hold the first, and a date faked to
-- 2019-01-01 is a claim the document never made.
-- ----------------------------------------------------------------------------

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

comment on table public.person_employment is
  'The dated roles the experience and stability indicators are computed from. '
  'A period is start_year plus a nullable start_month — never a faked date — '
  'and as_written keeps the exact string the CV used.';

create index if not exists person_employment_person_idx
  on public.person_employment (person_id, start_year desc);

-- ----------------------------------------------------------------------------
-- §1.8 person_skills and person_certifications — the two claims a CV makes
-- in words. Both are append-only collections; the uniqueness is case-folded
-- because CVs are not tidy, and the writer trims before insert — the index
-- cannot be trusted to.
-- ----------------------------------------------------------------------------

create table if not exists public.person_skills (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  skill text not null,
  proficiency smallint,
  as_written text,
  source text not null default 'hand_record',
  created_at timestamptz not null default now(),
  constraint person_skills_pkey primary key (id),
  constraint person_skills_skill_length_check check (char_length(skill) between 1 and 80),
  constraint person_skills_proficiency_check check (
    proficiency is null or (proficiency between 1 and 5)
  ),
  constraint person_skills_source_check check (
    source in ('hand_record','cv_extraction','candidate_form')
  ),
  constraint person_skills_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);

comment on table public.person_skills is
  'Skill claims in the person''s own words — the claim, not a match. '
  'Resolving a skill to the catalogue is a later slice''s conclusion; a '
  'skill_id here would store a match that did not run. proficiency reuses '
  'the platform''s 1–5 ruler and is null when the CV states no level.';

create unique index if not exists person_skills_person_skill_idx
  on public.person_skills (person_id, lower(skill));
create index if not exists person_skills_person_idx
  on public.person_skills (person_id, created_at desc);

create table if not exists public.person_certifications (
  id uuid default gen_random_uuid(),
  person_id uuid not null,
  title text not null,
  issuer text,
  year smallint,
  as_written text,
  source text not null default 'hand_record',
  created_at timestamptz not null default now(),
  constraint person_certifications_pkey primary key (id),
  constraint person_certifications_title_length_check check (char_length(title) between 1 and 160),
  constraint person_certifications_issuer_length_check check (
    issuer is null or char_length(issuer) between 1 and 160
  ),
  constraint person_certifications_year_check check (year is null or (year between 1950 and 2200)),
  constraint person_certifications_source_check check (
    source in ('hand_record','cv_extraction','candidate_form')
  ),
  constraint person_certifications_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);

comment on table public.person_certifications is
  'Professional-development claims: title, issuer and year as the certificate '
  'states them; year is a smallint because a certificate says "2023", and a '
  'date faked to 2023-01-01 is a precision the document never offered. A row '
  'with neither issuer nor year is still a row.';

create unique index if not exists person_certifications_person_title_idx
  on public.person_certifications (person_id, lower(title), lower(coalesce(issuer, '')));
create index if not exists person_certifications_person_idx
  on public.person_certifications (person_id, year desc nulls last);

-- ----------------------------------------------------------------------------
-- §1.9 person_consents — copied shape, person scope
--
-- Verbatim the candidate_consents discipline: one row per answer, never an
-- edit, a withdrawal is a later row with granted = false, the newest row by
-- recorded_at is the answer in force, notice_version names the wording it
-- was given against.
-- ----------------------------------------------------------------------------

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
    purpose in ('identity','contact','photo','work_history','education','languages','skills',
                'marital_status','family_details','dependants','emergency_contacts',
                'health','housing','extraction')
  ),
  constraint person_consents_door_check check (
    door in ('hand_record','profile_edit','candidate_form','privacy_page','system')
  ),
  constraint person_consents_person_id_fkey foreign key (person_id)
    references person_profiles (id) on delete cascade
);

comment on table public.person_consents is
  'Append-only consent history at person scope, copied from '
  'candidate_consents: one row per answer, never an edit. A withdrawal is a '
  'later row with granted = false, and the newest row by recorded_at is the '
  'answer in force. Group-level: the skills purpose covers both claim '
  'collections. purpose = ''extraction'' records that a CV was handed to a '
  'model, which is its own processing purpose.';

create index if not exists person_consents_person_idx
  on public.person_consents (person_id, purpose, recorded_at desc);

-- ----------------------------------------------------------------------------
-- §1.10 person_events — the change log, which is inside the boundary
--
-- A row that says "marital_status: single → married" is a Tier-2 fact; one
-- that says "blood_type: — → O+" is a Tier-3 fact sitting in a table a
-- recruiter opens to see history. field_group is stamped by the writer from
-- the registry, never chosen by the reader, and the SELECT policy below
-- gates the rows, not the table.
-- ----------------------------------------------------------------------------

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
    field_group in ('identity','contact','work_history','education','languages','skills','photo',
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

comment on table public.person_events is
  'The change log, inside the boundary: values live here, so rows are gated '
  'by field_group — stamped from the registry by the writer — not by the '
  'whole table. Long values are stored truncated with a length note; the '
  'full value is always in its own table.';

create index if not exists person_events_person_idx
  on public.person_events (person_id, recorded_at desc);
create index if not exists person_events_field_idx
  on public.person_events (person_id, field_key, recorded_at desc);

-- ----------------------------------------------------------------------------
-- §1.11 applications.person_id — the link, with no FK constraint.
--
-- Adding `references person_profiles(id)` to a table whose rows can predate a
-- partially-failed backfill converts a data problem into a migration that
-- cannot complete; the writer maintains the link and a proof query counts for
-- orphans instead.
-- ----------------------------------------------------------------------------

alter table public.applications
  add column if not exists person_id uuid;
comment on column public.applications.person_id is
  'The human this application belongs to, resolved from their address at the door that '
  'wrote the row. Nullable: applications predating 043 are backfilled here, and an '
  'erased application keeps its link to an anonymised person.';

-- ----------------------------------------------------------------------------
-- Row level security
--
-- Every table: enable, drop policy if exists, then one policy block per
-- command. SELECT follows the spec §1.11 tier table; every write is
-- is_staff() and has_permission('candidates.write'). No anon policy anywhere
-- — the public apply form writes through the spine's own service-role door in
-- the 044 slice, not here.
-- ----------------------------------------------------------------------------

alter table if exists public.person_profiles enable row level security;
alter table if exists public.person_health enable row level security;
alter table if exists public.person_family_details enable row level security;
alter table if exists public.person_dependants enable row level security;
alter table if exists public.person_emergency_contacts enable row level security;
alter table if exists public.person_emails enable row level security;
alter table if exists public.person_languages enable row level security;
alter table if exists public.person_education enable row level security;
alter table if exists public.person_employment enable row level security;
alter table if exists public.person_skills enable row level security;
alter table if exists public.person_certifications enable row level security;
alter table if exists public.person_consents enable row level security;
alter table if exists public.person_events enable row level security;

-- person_profiles — Tier 1 reads on the staff key alone.
drop policy if exists "person_profiles_staff_read" on public.person_profiles;
create policy "person_profiles_staff_read" on public.person_profiles
  for SELECT
  to authenticated
  using (is_staff());

drop policy if exists "person_profiles_staff_insert" on public.person_profiles;
create policy "person_profiles_staff_insert" on public.person_profiles
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_profiles_staff_update" on public.person_profiles;
create policy "person_profiles_staff_update" on public.person_profiles
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_profiles_staff_delete" on public.person_profiles;
create policy "person_profiles_staff_delete" on public.person_profiles
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_health — Tier 3: only a holder of the health grant reads it.
drop policy if exists "person_health_staff_read" on public.person_health;
create policy "person_health_staff_read" on public.person_health
  for SELECT
  to authenticated
  using (is_staff() and has_permission('candidates.view_health_data'));

drop policy if exists "person_health_staff_insert" on public.person_health;
create policy "person_health_staff_insert" on public.person_health
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_health_staff_update" on public.person_health;
create policy "person_health_staff_update" on public.person_health
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_health_staff_delete" on public.person_health;
create policy "person_health_staff_delete" on public.person_health
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_family_details — Tier 3: only a holder of the family grant reads it.
drop policy if exists "person_family_details_staff_read" on public.person_family_details;
create policy "person_family_details_staff_read" on public.person_family_details
  for SELECT
  to authenticated
  using (is_staff() and has_permission('candidates.view_family_data'));

drop policy if exists "person_family_details_staff_insert" on public.person_family_details;
create policy "person_family_details_staff_insert" on public.person_family_details
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_family_details_staff_update" on public.person_family_details;
create policy "person_family_details_staff_update" on public.person_family_details
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_family_details_staff_delete" on public.person_family_details;
create policy "person_family_details_staff_delete" on public.person_family_details
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_dependants — Tier 3, same grant as family details.
drop policy if exists "person_dependants_staff_read" on public.person_dependants;
create policy "person_dependants_staff_read" on public.person_dependants
  for SELECT
  to authenticated
  using (is_staff() and has_permission('candidates.view_family_data'));

drop policy if exists "person_dependants_staff_insert" on public.person_dependants;
create policy "person_dependants_staff_insert" on public.person_dependants
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_dependants_staff_update" on public.person_dependants;
create policy "person_dependants_staff_update" on public.person_dependants
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_dependants_staff_delete" on public.person_dependants;
create policy "person_dependants_staff_delete" on public.person_dependants
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_emergency_contacts — Tier 3 under its own safety-purpose grant.
drop policy if exists "person_emergency_contacts_staff_read" on public.person_emergency_contacts;
create policy "person_emergency_contacts_staff_read" on public.person_emergency_contacts
  for SELECT
  to authenticated
  using (is_staff() and has_permission('candidates.view_emergency_contacts'));

drop policy if exists "person_emergency_contacts_staff_insert" on public.person_emergency_contacts;
create policy "person_emergency_contacts_staff_insert" on public.person_emergency_contacts
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_emergency_contacts_staff_update" on public.person_emergency_contacts;
create policy "person_emergency_contacts_staff_update" on public.person_emergency_contacts
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_emergency_contacts_staff_delete" on public.person_emergency_contacts;
create policy "person_emergency_contacts_staff_delete" on public.person_emergency_contacts
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_emails — Tier 1.
drop policy if exists "person_emails_staff_read" on public.person_emails;
create policy "person_emails_staff_read" on public.person_emails
  for SELECT
  to authenticated
  using (is_staff());

drop policy if exists "person_emails_staff_insert" on public.person_emails;
create policy "person_emails_staff_insert" on public.person_emails
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_emails_staff_update" on public.person_emails;
create policy "person_emails_staff_update" on public.person_emails
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_emails_staff_delete" on public.person_emails;
create policy "person_emails_staff_delete" on public.person_emails
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_languages — Tier 1.
drop policy if exists "person_languages_staff_read" on public.person_languages;
create policy "person_languages_staff_read" on public.person_languages
  for SELECT
  to authenticated
  using (is_staff());

drop policy if exists "person_languages_staff_insert" on public.person_languages;
create policy "person_languages_staff_insert" on public.person_languages
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_languages_staff_update" on public.person_languages;
create policy "person_languages_staff_update" on public.person_languages
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_languages_staff_delete" on public.person_languages;
create policy "person_languages_staff_delete" on public.person_languages
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_education — Tier 1.
drop policy if exists "person_education_staff_read" on public.person_education;
create policy "person_education_staff_read" on public.person_education
  for SELECT
  to authenticated
  using (is_staff());

drop policy if exists "person_education_staff_insert" on public.person_education;
create policy "person_education_staff_insert" on public.person_education
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_education_staff_update" on public.person_education;
create policy "person_education_staff_update" on public.person_education
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_education_staff_delete" on public.person_education;
create policy "person_education_staff_delete" on public.person_education
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_employment — Tier 1.
drop policy if exists "person_employment_staff_read" on public.person_employment;
create policy "person_employment_staff_read" on public.person_employment
  for SELECT
  to authenticated
  using (is_staff());

drop policy if exists "person_employment_staff_insert" on public.person_employment;
create policy "person_employment_staff_insert" on public.person_employment
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_employment_staff_update" on public.person_employment;
create policy "person_employment_staff_update" on public.person_employment
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_employment_staff_delete" on public.person_employment;
create policy "person_employment_staff_delete" on public.person_employment
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_skills — Tier 1: the claims are what the CV says; a grant that hid
-- them would hide the CV.
drop policy if exists "person_skills_staff_read" on public.person_skills;
create policy "person_skills_staff_read" on public.person_skills
  for SELECT
  to authenticated
  using (is_staff());

drop policy if exists "person_skills_staff_insert" on public.person_skills;
create policy "person_skills_staff_insert" on public.person_skills
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_skills_staff_update" on public.person_skills;
create policy "person_skills_staff_update" on public.person_skills
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_skills_staff_delete" on public.person_skills;
create policy "person_skills_staff_delete" on public.person_skills
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_certifications — Tier 1, same reasoning as person_skills.
drop policy if exists "person_certifications_staff_read" on public.person_certifications;
create policy "person_certifications_staff_read" on public.person_certifications
  for SELECT
  to authenticated
  using (is_staff());

drop policy if exists "person_certifications_staff_insert" on public.person_certifications;
create policy "person_certifications_staff_insert" on public.person_certifications
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_certifications_staff_update" on public.person_certifications;
create policy "person_certifications_staff_update" on public.person_certifications
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_certifications_staff_delete" on public.person_certifications;
create policy "person_certifications_staff_delete" on public.person_certifications
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_consents — is_staff(): the absence of consent is a fact the
-- recruiter must see; who agreed to what is not itself the sensitive answer.
drop policy if exists "person_consents_staff_read" on public.person_consents;
create policy "person_consents_staff_read" on public.person_consents
  for SELECT
  to authenticated
  using (is_staff());

drop policy if exists "person_consents_staff_insert" on public.person_consents;
create policy "person_consents_staff_insert" on public.person_consents
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_consents_staff_update" on public.person_consents;
create policy "person_consents_staff_update" on public.person_consents
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_consents_staff_delete" on public.person_consents;
create policy "person_consents_staff_delete" on public.person_consents
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- person_events — the log is inside the boundary: the policy gates the rows,
-- not the table, by the field_group the writer stamped.
drop policy if exists "person_events_staff_read" on public.person_events;
create policy "person_events_staff_read" on public.person_events
  for SELECT
  to authenticated
  using (
    is_staff()
    and (field_group <> 'health' or has_permission('candidates.view_health_data'))
    and (field_group not in ('family_details','dependants') or has_permission('candidates.view_family_data'))
    and (field_group <> 'emergency_contacts' or has_permission('candidates.view_emergency_contacts'))
  );

drop policy if exists "person_events_staff_insert" on public.person_events;
create policy "person_events_staff_insert" on public.person_events
  for INSERT
  to authenticated
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_events_staff_update" on public.person_events;
create policy "person_events_staff_update" on public.person_events
  for UPDATE
  to authenticated
  using (is_staff() and has_permission('candidates.write'))
  with check (is_staff() and has_permission('candidates.write'));

drop policy if exists "person_events_staff_delete" on public.person_events;
create policy "person_events_staff_delete" on public.person_events
  for DELETE
  to authenticated
  using (is_staff() and has_permission('candidates.write'));

-- Grants. The bulk select grant is the spec §1.11 block verbatim; the wider
-- write grant and the anon revoke are the per-table contract every door
-- relies on. service_role is the spine's own door, as submitApplication's
-- write already is.
grant select on table
  public.person_profiles, public.person_emails, public.person_languages,
  public.person_education, public.person_employment, public.person_skills,
  public.person_certifications, public.person_events,
  public.person_consents, public.person_health, public.person_family_details,
  public.person_dependants, public.person_emergency_contacts
  to authenticated;
grant all on table
  public.person_profiles, public.person_emails, public.person_languages,
  public.person_education, public.person_employment, public.person_skills,
  public.person_certifications, public.person_events,
  public.person_consents, public.person_health, public.person_family_details,
  public.person_dependants, public.person_emergency_contacts
  to service_role;

grant select, insert, update on table
  public.person_profiles, public.person_emails, public.person_languages,
  public.person_education, public.person_employment, public.person_skills,
  public.person_certifications, public.person_events,
  public.person_consents, public.person_health, public.person_family_details,
  public.person_dependants, public.person_emergency_contacts
  to authenticated;
revoke all on table
  public.person_profiles, public.person_emails, public.person_languages,
  public.person_education, public.person_employment, public.person_skills,
  public.person_certifications, public.person_events,
  public.person_consents, public.person_health, public.person_family_details,
  public.person_dependants, public.person_emergency_contacts
  from anon;

-- ----------------------------------------------------------------------------
-- The candidate-photos bucket on public.files.
--
-- This slice registers the bucket for the recruiter's hand-record door; the
-- anon policy is the form-builder's addition in 044. The staff write policy
-- enforces the persons/<personId>/<uuid>.<ext> prefix spec §4 step 7 uploads
-- into.
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- The three Tier-3 permissions, seeded to SUPER_ADMIN only. Health and family
-- are different purposes and a cleared health reader has no claim to a
-- spouse's employer. The role matrix reads this table, so the rows appear
-- there without a UI change.
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- erase_person_data — person-scope erasure, called after the last live
-- application's per-application erasure.
--
-- Third-party rows are deleted, not anonymised: a child renamed to "Erased"
-- is a record of a person who never existed. applications.person_id survives
-- pointing at an anonymised profile, because the pipeline needs to say an
-- application was judged and the link is the only place "these four rows were
-- one human" is recorded. person_profiles is anonymised rather than deleted
-- to keep that fact without keeping the person.
-- ----------------------------------------------------------------------------

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
  delete from person_skills           where person_id = p_person_id;
  delete from person_certifications   where person_id = p_person_id;
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

comment on function public.erase_person_data(uuid) is
  'Erases the person, not the application. The last live application''s '
  'erasure calls this, at the end of eraseApplication: it refuses while any '
  'application still links, deletes the Tier-3 rows, the collections, the '
  'emails and the history, and anonymises the profile row rather than '
  'deleting it — the link must keep pointing at a judgment, not a person. '
  'Hardened byte-for-byte like erase_candidate_data at 041:499.';

revoke all on function public.erase_person_data(uuid) from public, anon, authenticated;
grant execute on function public.erase_person_data(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- §1.12 The backfill — idempotent by construction: the derived id and
-- `on conflict ... do nothing` make the same address resolve to the same
-- person on every run, and step 3 only touches rows with person_id is null.
-- The three exclusions are load-bearing: the @erased.invalid filter because
-- erase_candidate_data (041:405) mints those addresses and without it the
-- backfill invents people out of erased records; the shape regex because
-- applications.email is plain text with no CHECK and a legacy typo would
-- abort the migration; the having clause so a row whose name would violate
-- person_profiles_name_length_check never becomes a profile *or* an address
-- row — filtering at step 1 alone would leave step 2 inserting a person_emails
-- row whose person_id does not exist, and the foreign key would abort.
-- ----------------------------------------------------------------------------

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

-- PostgREST caches its view of the schema, so a REST read of the new tables is
-- refused as an unknown resource until the API reloads.
notify pgrst, 'reload schema';
-- Next file: 044.
