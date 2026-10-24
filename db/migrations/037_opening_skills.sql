-- ============================================================================
-- What a requisition actually needs, as rows rather than as prose.
--
-- A job opening stores its requirement lines as `requirements jsonb` and has
-- nothing else to say about skills at all. Meanwhile the platform already holds
-- the other three edges of a skills graph: a `skills` catalogue, `skills`
-- required per role family with a 1..5 `required_level`, and `candidate_skills`
-- holding what one application demonstrated. The one pair that is missing is the
-- one every recruiter is asked about first — this opening, these skills, this
-- deep — so `ai_strengths` and `ai_gaps` are a model's free text about a
-- paragraph, and no screen can name which requirement a candidate fell short of.
--
-- The shape is `role_family_skills` renamed, deliberately. The same 1..5 level,
-- the same (parent, skill) composite key, the same cascade in both directions,
-- because a requisition's skill list is a role family's list narrowed to one
-- vacancy: the family says what a Finance manager needs across every posting,
-- the opening says what *this* one does. Reusing the shape means a recruiter who
-- has seen one picker has seen both, and a required level means one number
-- everywhere it appears.
--
-- There is no `weight` column, although the family table has one. A weight is a
-- scoring rule, and a scoring rule nobody has set is a number the software
-- invented; the four seed families all carry 1.00 or 1.50 because a seed script
-- typed them, not because a recruiter chose them. The portal can rank required
-- skills against demonstrated ones on the level alone and say which are missing,
-- which is the claim being asked for today. A weight can be added by a later
-- migration when a real ranking decision exists.
--
-- `source` distinguishes the two ways a row arrives. A recruiter typing a skill
-- is RECRUITER; accepting one the portal matched out of the requirement lines
-- against the catalogue is CATALOGUE_MATCH. Both are human decisions — the
-- second only writes when a person clicks the suggestion — so the column records
-- how the list was built without pretending a model edited the requisition. It
-- is a closed list with a CHECK rather than a free-text note for the same reason
-- the family key is composite: a value nothing reads is a value not worth
-- storing, and both spellings here are printed.
--
-- `opening_id` cascades, as `candidate_skills.application_id` does: a skill list
-- about a requisition that no longer exists describes nothing. `skill_id`
-- cascades too, matching the family and candidate links — retiring a catalogue
-- entry retires its appearances, which is why retiring one is a soft
-- `is_active = false` in the master-data console and a hard delete is not.
--
-- Reading is staff-only, and so is writing. `candidate_skills` sets the
-- precedent, and nothing here needs a wider wall: the public careers board
-- advertises a role, not the score it will apply. Adding a published-opening read
-- would be a policy with no consumer, which is the kind of row the
-- `security.require_oauth` cleanup removed.
--
-- This migration is NOT applied to any database yet. Applying it is the owner's
-- decision; `scripts/prove-migration-claims.mjs` asks the database for
-- `job_opening_skills` and checks every sentence in the portal that states
-- whether this one has it, and `scripts/prove-opening-skills.mjs` holds the
-- refusal copy — so an unapplied file says "not stored yet" on screen and a
-- stale claim fails the same day it is written.
-- ============================================================================

create table if not exists public.job_opening_skills (
  opening_id uuid not null,
  skill_id uuid not null,
  required_level integer default 3 not null,
  source text default 'RECRUITER'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint job_opening_skills_pkey primary key (opening_id, skill_id),
  constraint job_opening_skills_required_level_check
    check (required_level between 1 and 5),
  constraint job_opening_skills_source_check
    check (source = any (array['RECRUITER', 'CATALOGUE_MATCH'])),
  constraint job_opening_skills_opening_id_fkey
    foreign key (opening_id) references job_openings (id) on delete cascade,
  constraint job_opening_skills_skill_id_fkey
    foreign key (skill_id) references skills (id) on delete cascade
);

comment on table public.job_opening_skills is
  'The skills one requisition asks for, and how deep each is needed. The same '
  'shape as role_family_skills, narrowed from a whole family to one opening: '
  'a candidate''s demonstrated skills are compared against this list.';

comment on column public.job_opening_skills.required_level is
  '1 (nice to have) to 5 (essential), on the same scale role_family_skills '
  'uses, so one number means one thing wherever a required skill is shown.';

comment on column public.job_opening_skills.source is
  'RECRUITER when a person typed the skill, CATALOGUE_MATCH when they accepted '
  'one the portal found in the requirement lines. Both are written only by a '
  'human action; a model never edits a requisition on its own.';

create index if not exists job_opening_skills_opening_idx
  on public.job_opening_skills (opening_id);
create index if not exists job_opening_skills_skill_idx
  on public.job_opening_skills (skill_id);

drop trigger if exists trg_job_opening_skills_updated on public.job_opening_skills;
CREATE TRIGGER trg_job_opening_skills_updated BEFORE UPDATE ON public.job_opening_skills FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table if exists public.job_opening_skills enable row level security;

/*
 * Every staff member may read a requisition's skill list, which is exactly the
 * wall `job_openings` and `candidate_skills` already stand on: the list is part
 * of the opening the team can already see, and the applicant's side of the
 * comparison is staff-only for the same reason.
 */
drop policy if exists "job_opening_skills_staff_read" on public.job_opening_skills;
create policy "job_opening_skills_staff_read" on public.job_opening_skills
  for SELECT
  to authenticated
  using (is_staff());

/*
 * One policy for all three writes, like `candidate_skills_write`: a skill list
 * belongs to the opening, and the opening's own policy already decides who may
 * change it. The service role reaches the same rows for the same reason.
 */
drop policy if exists "job_opening_skills_staff_write" on public.job_opening_skills;
create policy "job_opening_skills_staff_write" on public.job_opening_skills
  for ALL
  to authenticated
  using (is_staff())
  with check (is_staff());

grant select, insert, update, delete on table public.job_opening_skills to authenticated;
grant select, insert, update, delete on table public.job_opening_skills to service_role;
revoke all on table public.job_opening_skills from anon;

-- PostgREST caches its view of the schema, so a REST write to the new table is
-- refused as an unknown resource until the API reloads. Without this the picker
-- would say "not stored yet" against a database that has the table.
notify pgrst, 'reload schema';
