-- ============================================================================
-- A company profile a careers page can actually show.
--
-- `tenants_and_companies` was built as a filing key: it names the company a job
-- opening belongs to, so the recruiter's pickers, the rails and the reports can
-- group by it. Every descriptive column it does have — legal name, website,
-- logo, address, city — is empty on all four live rows, which is why the public
-- careers board can only print a job title, a location and a salary band. A
-- candidate reading it learns nothing about who they would work for.
--
-- So the profile lives here, beside the row the roles already point at, rather
-- than in a table of its own: a company is one entity, and a second table keyed
-- 1:1 to it would mean every read that wants the history also wants a join, and
-- every write that renames a company has to remember a second row.
--
-- Nothing here is seeded with invented copy. A careers page that says "we were
-- founded to bring hospitality excellence to the Red Sea" because a template
-- said so is worse than one that says nothing, so each column stays NULL until a
-- recruiter writes the company's own words in Settings → Master data → Companies.
-- The page then renders exactly what is filed and shows no placeholder for a
-- field nobody has filled.
--
-- `milestones` and `benefits` are jsonb for the same reason `job_openings.requirements`
-- is: they are ordered lists of short entries the console edits as rows, not
-- prose to be split on newlines. Each is checked for shape rather than content,
-- because Postgres cannot tell a true milestone from a false one and neither can
-- a constraint — the array holding whatever a recruiter typed is the point.
--
-- These columns are readable by anonymous visitors through the Data API, exactly
-- as the existing `companies_read` policy already lets it read this table's name
-- and sector. That is intended for the careers copy; it is worth knowing that the
-- same policy also exposes `legal_name`, `contact_phone` and `address` today,
-- which is a separate question this migration does not change.
-- ============================================================================

alter table public.tenants_and_companies
  add column if not exists tagline text,
  add column if not exists description text,
  add column if not exists history text,
  add column if not exists careers_pitch text,
  add column if not exists founded_year smallint,
  add column if not exists ownership_type text,
  add column if not exists employee_range text,
  add column if not exists headquarters text,
  add column if not exists milestones jsonb,
  add column if not exists benefits jsonb,
  add column if not exists cover_url text;

-- Lengths are bounded where a page has to fit the text, not where a person has
-- something long to say: a 40,000-character history would be stored happily and
-- then render as an unbroken wall, so the ceiling is stated here and the console
-- counts characters against it.
alter table public.tenants_and_companies
  drop constraint if exists tenants_and_companies_tagline_length,
  add constraint tenants_and_companies_tagline_length
    check (tagline is null or char_length(btrim(tagline)) <= 160),
  drop constraint if exists tenants_and_companies_description_length,
  add constraint tenants_and_companies_description_length
    check (description is null or char_length(btrim(description)) <= 4000),
  drop constraint if exists tenants_and_companies_history_length,
  add constraint tenants_and_companies_history_length
    check (history is null or char_length(btrim(history)) <= 12000),
  drop constraint if exists tenants_and_companies_careers_pitch_length,
  add constraint tenants_and_companies_careers_pitch_length
    check (careers_pitch is null or char_length(btrim(careers_pitch)) <= 2000),
  -- A company cannot be founded before the year the portal can claim to record,
  -- and a founded_year of 3 is a person who meant to type 1993. The bound keeps
  -- the timeline it feeds sortable.
  drop constraint if exists tenants_and_companies_founded_year_sane,
  add constraint tenants_and_companies_founded_year_sane
    check (founded_year is null or (founded_year between 1900 and 2200)),
  drop constraint if exists tenants_and_companies_milestones_shape,
  add constraint tenants_and_companies_milestones_shape
    check (milestones is null or jsonb_typeof(milestones) = 'array'),
  drop constraint if exists tenants_and_companies_benefits_shape,
  add constraint tenants_and_companies_benefits_shape
    check (benefits is null or jsonb_typeof(benefits) = 'array');

comment on column public.tenants_and_companies.tagline is
  'One line under the company name on the careers page. Public, and blank means the line is not shown.';
comment on column public.tenants_and_companies.description is
  'Who this company is, in its own words. Public careers copy, written in Settings → Master data.';
comment on column public.tenants_and_companies.history is
  'The company''s story, in paragraphs. Written line by line as the candidate reads it.';
comment on column public.tenants_and_companies.careers_pitch is
  'Why someone would want to work here — the paragraph above the open roles.';
comment on column public.tenants_and_companies.founded_year is
  'Year the company was founded, used for the timeline and the "since 1996" figure.';
comment on column public.tenants_and_companies.ownership_type is
  'Public Company, Private Limited, Family group… A description of governance, not a legal form.';
comment on column public.tenants_and_companies.employee_range is
  'Headcount as a band, e.g. 501-1,000. A band rather than a number because nobody can verify a number.';
comment on column public.tenants_and_companies.headquarters is
  'Where the company is run from, as a candidate would read it.';
comment on column public.tenants_and_companies.milestones is
  'Ordered array of {"year": …, "title": …, "detail": …} objects shown as the history timeline.';
comment on column public.tenants_and_companies.benefits is
  'Array of short strings — what the company offers. Rendered as chips, never promised as a contract.';
comment on column public.tenants_and_companies.cover_url is
  'A banner image for this company''s careers section: a path or an absolute URL. Blank shows no image.';

-- ---------------------------------------------------------------------------
-- One row is the group's own profile.
--
-- The four rows this portal seeded are subsidiaries, and the group's founding
-- story is not any one of theirs: putting "founded 1996" on Sharm Dreams
-- Touristic would make Rowad Misr's careers section wrong by omission and the
-- touristic one wrong by inheritance. So the story gets its own row, and a flag
-- says which row the careers page reads as the group — a flag rather than a
-- hard-coded uuid or a name match, because both would break the first time a
-- recruiter renames the row or restores the database on another project.
--
-- Exactly one, enforced by the index: two rows claiming to be the group produce
-- two different founding years on the same page.
-- ---------------------------------------------------------------------------
alter table public.tenants_and_companies
  add column if not exists is_group_profile boolean default false not null;

create unique index if not exists tenants_and_companies_one_group_profile
  on public.tenants_and_companies (is_group_profile)
  where is_group_profile;

comment on column public.tenants_and_companies.is_group_profile is
  'The row whose profile is the whole group''s. Exactly one; read by the careers page for the group header, and excluded from the pickers a job or a suite is filed under.';

-- ---------------------------------------------------------------------------
-- The group row, with only what is sourced.
--
-- Every figure here comes from docs/RESEARCH.md, the record captured from the
-- group's own LinkedIn page: founded 1996 under the parent Sharm Dreams for
-- Tourist Investment, Hilton Sharm Dreams Resort from 2000, seven hotels plus
-- real-estate projects across Sharm El Sheikh, Sahl Hasheesh and Marsa Alam,
-- twelve companies, 501-1,000 people, a public company in the hospitality
-- industry.
--
-- What that record does NOT say is left NULL on purpose — a headquarters city,
-- a benefits list, a recruiting pitch, a cover image. A careers page prints what
-- is filed and prints nothing where nothing is filed, so the blank columns are
-- an invitation to the people team rather than a silent invention. The same
-- applies to the four subsidiary rows: no per-company history was captured, so
-- none was written.
-- ---------------------------------------------------------------------------
insert into public.tenants_and_companies (
  name, slug, sector, country, sort_order, is_group_profile,
  tagline, description, history, founded_year, ownership_type, employee_range, milestones
)
select
  'Sharm Dreams Group',
  'sharm-dreams-group',
  'HOSPITALITY',
  'Egypt',
  1,
  true,
  'Hospitality, real estate and corporate services across the Red Sea — 12 companies, founded 1996.',
  'Sharm Dreams Group is a public Egyptian company in the hospitality industry, founded in 1996 with Sharm Dreams for Tourist Investment as its parent. It works across three Red Sea hubs — Sharm El Sheikh, Sahl Hasheesh near Hurghada, and Marsa Alam — and today comprises twelve companies: subsidiaries, affiliates and sister companies covering hotel operations, real estate and shared corporate services.',
  'The group was founded in 1996, with Sharm Dreams for Tourist Investment as its parent company.' || E'\n\n' ||
  'Its first hotel, Hilton Sharm Dreams Resort, opened in 2000. From that single resort the group grew over the following twenty-four years to seven hotels, alongside real-estate projects in Sharm El Sheikh, Sahl Hasheesh (Hurghada) and Marsa Alam.' || E'\n\n' ||
  'It now comprises twelve companies — subsidiaries, affiliates and sister companies — and employs between 501 and 1,000 people. Its stated commitment is to deliver innovative projects and exceptional services, with sustainable growth and a positive contribution to the communities it operates in.',
  1996,
  'Public Company',
  '501–1,000',
  '[
     {"year": 1996, "title": "Founded", "detail": "Sharm Dreams Group is established, with Sharm Dreams for Tourist Investment as its parent company."},
     {"year": 2000, "title": "The first resort", "detail": "Hilton Sharm Dreams Resort opens in Sharm El Sheikh."},
     {"year": null, "title": "Today", "detail": "Seven hotels and real-estate projects across Sharm El Sheikh, Sahl Hasheesh (Hurghada) and Marsa Alam, within twelve companies."}
   ]'::jsonb
where not exists (
  select 1 from public.tenants_and_companies where slug = 'sharm-dreams-group'
);

-- PostgREST holds its own view of the schema, so a column added by this file is

-- invisible to the careers read until the API is told to look again. Without this
-- the recruiter saves real history into a real column and the page still shows
-- nothing, which reads exactly like the feature was never built.
notify pgrst, 'reload schema';
