-- ---------------------------------------------------------------------------
-- Candidate archive.
--
-- Clearing junk out of the talent database — a test submission, a double
-- applicant, a hire whose noise clutters the board — wants the record out of
-- the console, not out of the database. The assessment answers, the notices
-- already sent and the screening scores are the group's record of a real
-- person, so `archived_at` is a filing door: every staff read hides the row,
-- one click brings it back, nothing is erased.
-- ---------------------------------------------------------------------------
alter table applications
  add column if not exists archived_at timestamptz;

comment on column applications.archived_at is
  'Set when staff file this candidate out of the pipeline. The row and every '
  'answer, notice and score on it stay; only staff reads hide it. Null = live.';

-- Every live listing asks for this predicate, so the partial index covers the
-- rows it actually has to walk.
create index if not exists idx_applications_live
  on applications (created_at desc)
  where archived_at is null;

-- Archiving also has to free the door the applicant walks through.
-- `applications_one_live_per_job` exists to stop one person sitting twice in
-- the same pipeline; an archived row is in nobody's pipeline, so it must not
-- silently block that address from applying again.
drop index if exists applications_one_live_per_job;

create unique index if not exists applications_one_live_per_job
  on applications (job_id, lower(email))
  where stage in ('NEW', 'AI_SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER')
    and archived_at is null;

comment on index applications_one_live_per_job is
  'Blocks duplicate live applications to the same job. Rejected, hired and '
  'archived applications are outside the index so re-applying is permitted.';
