-- ============================================================================
-- Sourced prospect profiles.
--
-- The pool used to hold only what a recruiter typed or pasted beside a name: a
-- headline, a company, a location. Everything a profile page actually contains —
-- each job they have held, their education, licenses and certifications, projects,
-- skills — was on the page and never in the record.
--
-- This adds the read. `profile` holds the structured result as the reader produced
-- it, `profile_source` records *how* it was obtained (a fetched URL, text copied
-- out of a page the recruiter can see, or an uploaded export) and
-- `profile_captured_at` when, because a profile is a snapshot of a page that its
-- owner can edit at any time. `profile_error` keeps the last refusal in plain
-- words, so a blocked LinkedIn read is something the recruiter can see and act on
-- rather than a button that appears to do nothing.
--
-- `profile_url` is separate from `linkedin_url`: a GitHub, personal site or online
-- CV is a legitimate place to read a person from, and filing that link under a
-- column named for LinkedIn would make the pool's own source untrustworthy.
-- ============================================================================

alter table sourced_prospects
  add column if not exists profile jsonb,
  add column if not exists profile_url text,
  add column if not exists profile_source text
    check (profile_source in ('URL', 'PASTE', 'FILE')),
  add column if not exists profile_captured_at timestamptz,
  add column if not exists profile_error text;

comment on column sourced_prospects.profile is
  'Structured profile as last read: experience, education, certifications, '
  'projects, skills, languages, links. Null until someone reads it.';

comment on column sourced_prospects.profile_source is
  'URL = fetched from profile_url, PASTE = text a recruiter copied out of a page '
  'they can see, FILE = an export they uploaded. Which reader produced the row.';

comment on column sourced_prospects.profile_error is
  'Last refusal a reader gave, in recruiter-facing words, cleared when a read '
  'succeeds. Not a failure of this application.';
