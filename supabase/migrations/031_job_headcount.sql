-- ============================================================================
-- A vacancy states how many people it is trying to hire.
--
-- `job_openings` records a role but never says how many of it the group is
-- hiring for. Every demand question the portal can answer today is a count of
-- applications — how many people applied, how many are still in the funnel, how
-- many were hired — and a count with no target beside it cannot say whether a
-- role is under-staffed, full, or oversubscribed. A recruiter reading "4 hired"
-- has no way to know whether that filled the requisition or left six seats open.
--
-- So the target is a column on the opening itself, not a derived figure. Nothing
-- in the data tells you how many people a role WANTED — that is a decision made
-- when the requisition opens, and only the person who opened it knows it. A NULL
-- therefore means "no target was recorded", and a demand read shows the pipeline
-- and the hires without a "still to fill" figure rather than inventing one or
-- treating a blank as a zero.
--
-- The ceiling is generous on purpose. A single hire is the common case, and a
-- group-wide graduate intake is the outlier this column is there to hold; 1000
-- is far above either without being unbounded, and it turns an obvious fat-finger
-- ("I meant 10") into a rejected write rather than a requisition the reports then
-- average against. Zero is refused: an opening nobody is hiring for is a draft or
-- a closed role, not a vacancy with a headcount of none.
--
-- This migration is NOT applied to any database yet. The read that shows the
-- demand counts (in pipeline / hired) needs nothing here and works today; the
-- `needed` figure it pairs them with is read from this column and simply shows
-- "not recorded" until this ALTER runs. The live application is the owner's
-- decision, so only the file and the schema of record change.
-- ============================================================================

alter table public.job_openings
  add column if not exists positions_needed integer;

alter table public.job_openings
  drop constraint if exists job_openings_positions_needed_sane,
  add constraint job_openings_positions_needed_sane
    check (positions_needed is null or (positions_needed between 1 and 1000));

comment on column public.job_openings.positions_needed is
  'How many people this opening is hiring for. A target set when the requisition opens, never derived from applications; NULL means no target was recorded, which a demand read shows as such rather than as zero or a full role.';

-- PostgREST caches its view of the schema, so the new column is invisible to the
-- REST read until the API reloads. Without this the recruiter records a headcount
-- and the grid still reports "not recorded".
notify pgrst, 'reload schema';
