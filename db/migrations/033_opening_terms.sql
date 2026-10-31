-- ============================================================================
-- An opening says how senior it is, and where the work is done.
--
-- The hiring spec gives a vacancy two facts `job_openings` cannot state today.
-- It has no seniority at all: a recruiter writing "Senior Analyst" has put the
-- level in the title, where nothing can filter on it, count it, or tell two
-- openings with the same title apart. And its employment_type check holds only
-- four values — FULL_TIME, PART_TIME, CONTRACT, INTERNSHIP — so the Remote and
-- Hybrid types the spec lists are refused by the database whichever form or
-- chat tries to write them.
--
-- Seniority is a column of its own, nullable on purpose. The openings already
-- on this database were created before anyone was asked the question, and a
-- default of MID would invent an answer for every one of them. NULL means "no
-- level was recorded", which the grid and the public card show by saying
-- nothing rather than by claiming a middle tier.
--
-- The check names four levels — JUNIOR, MID, SENIOR, LEAD — because those are
-- the spec's words, and a closed list is what lets the form offer a picker and
-- the assistant refuse a spelling it cannot store. The column is text with a
-- CHECK rather than a database enum, matching employment_type beside it: both
-- are edited in the same form, and a vocabulary that grows should not need a
-- type migration every time the spec adds a word.
--
-- The employment_type check is dropped and re-added, not altered in place: a
-- CHECK cannot be widened, and `drop constraint if exists` is what makes this
-- runnable both on a database that still has the four-value constraint and on
-- one where a half-applied attempt already replaced it. Remote and Hybrid join
-- the four existing values rather than living in a second column because the
-- spec lists them as job types and the public board's Job type facet reads
-- exactly this column — a second axis would hide those roles from the chips
-- applicants already use.
--
-- APPLIED to the local database on 2026-10-28, and the after-state was measured
-- rather than assumed: `experience_level` is a nullable text column carrying its
-- comment, `job_openings_experience_level_check` holds the four levels, and
-- `job_openings_employment_type_check` holds six values. No opening violated
-- either check, and the two rows on this database were both re-read afterwards
-- still `FULL_TIME` with no level — the proof wrote REMOTE and SENIOR inside a
-- transaction it rolled back, so nothing here was recorded by a test.
--
-- What a database that has not run this file is told: SUPERVISOR and a lowercase
-- `lead` were refused by the level check and WORK_FROM_HOME by the employment
-- check, which is the shape of every refusal the screens quote. The runtime
-- strings in `src/modules/jobs/domain/openingTerms.ts` still name this file, and
-- they must keep doing it: their door is a probe that failed, so they print only
-- where a read or write could not reach the column, and on such a database the
-- sentence is the whole of what the user learns.
-- ============================================================================

alter table public.job_openings
  add column if not exists experience_level text;

alter table public.job_openings
  drop constraint if exists job_openings_experience_level_check,
  add constraint job_openings_experience_level_check
    check (
      experience_level is null
      or experience_level = any (array['JUNIOR', 'MID', 'SENIOR', 'LEAD'])
    );

comment on column public.job_openings.experience_level is
  'How senior the role is: JUNIOR, MID, SENIOR or LEAD. NULL means no level '
  'was recorded — every opening created before the column existed — and is '
  'shown as silence, never defaulted to a middle tier.';

alter table public.job_openings
  drop constraint if exists job_openings_employment_type_check,
  add constraint job_openings_employment_type_check
    check (
      employment_type = any (
        array['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'REMOTE', 'HYBRID']
      )
    );

-- PostgREST caches its view of the schema, so neither the new column nor the
-- widened check is visible to a REST write until the API reloads. Without this
-- the form would offer Remote and the database would still refuse it.
notify pgrst, 'reload schema';
