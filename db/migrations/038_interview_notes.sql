-- ============================================================================
-- What an interviewer actually heard, kept instead of lost.
--
-- The portal books a panel, moves it, records its outcome and stores four marks
-- against it. It stores nothing about what was said. There is no notes column on
-- `interview_schedules` and no notes table anywhere — the only `notes` column in
-- this schema belongs to `sourced_prospects`, and it is about a LinkedIn profile,
-- not an interview. So the one artefact a second-round interviewer most wants, the
-- first panel's account of the candidate, lives in whoever's notebook was open.
--
-- The worst case is already printed on the screen. The candidate page offers to
-- generate an interview guide from the CV's gaps and then tells the recruiter:
-- "The guide is not stored — copy what you need into your notes before closing
-- this panel." The software asks a person to leave the product to keep its own
-- output. That sentence is the bug this table fixes.
--
-- The ownership shape is `interview_scorecards`'s, on purpose. Every staff member
-- reads a panel's notes; only the author ever changes their own. The reason is the
-- same one 032 recorded: the person who sat the panel is often a hiring manager
-- with no candidate-editing grant, and what they heard is the thing the feature
-- exists to keep. Requiring `candidates.write` would make them dictate their
-- account to someone else. The action binds the author to the session's profile id
-- and the WITH CHECK below is the copy that holds when a request comes from
-- somewhere else.
--
-- One row per (panel, author) as the primary key, not a surrogate id. A panel has
-- exactly zero or one note per interviewer, so a second id would be a column
-- nothing queries and a second way to say the same thing — and the scorecard's
-- "you already have a row here, reopen it" refusal works because that pair is the
-- key. Three interviewers produce three first-hand accounts, kept apart, because
-- a single merged text erases the disagreement a panel of three exists to surface.
--
-- `body` carries both halves of the desk's output: the interviewer's own words and
-- the guide they chose to save, under a heading that says the model drafted it.
-- Provenance lives inside the text rather than in a `source` column because there
-- is only ever one author per row and the row cannot disagree with itself about who
-- typed it. Nothing writes this table from a model on its own: the heading is added
-- when a person clicks "save to my notes", and the same person can edit it away.
--
-- The 4000-character limit is the scorecard feedback's own figure, and it is stated
-- twice — in the domain module and here — because the two boxes exist to hold the
-- same account and "insert my notes" is only an offer if it always fits. The CHECK
-- is the wall behind the validator: a writer that forgets the rule produces an error
-- instead of a note nobody can read the end of.
--
-- `interview_id` cascades, as `interview_scorecards.interview_id` and
-- `candidate_skills.application_id` both do: an account of a panel that no longer
-- exists describes nothing, and deleting a panel that was cancelled by mistake
-- should not strand its notes under a row the agenda cannot show.
--
-- APPLIED on this local database. The date this file was run is not recorded
-- here; what is recorded is `interview_notes` read back from the catalog on
-- 2026-10-29 with row security on and its four policies (staff read, own add, own
-- change, own remove). `scripts/prove-migration-claims.mjs` asks the database for
-- that table and checks every sentence in the portal that states whether this one
-- has it, and `scripts/prove-interview-notes.mjs` holds the refusal copy — so on a
-- database where this file has never run the screen says "not stored yet", and a
-- stale claim about this one fails the same day it is written.
-- ============================================================================

create table if not exists public.interview_notes (
  interview_id uuid not null,
  author_profile_id uuid not null,
  body text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint interview_notes_pkey primary key (interview_id, author_profile_id),
  constraint interview_notes_body_check
    check (length(btrim(body)) > 0 and length(body) <= 4000),
  constraint interview_notes_interview_id_fkey
    foreign key (interview_id) references interview_schedules (id) on delete cascade,
  constraint interview_notes_author_profile_id_fkey
    foreign key (author_profile_id) references user_profiles (id) on delete cascade
);

comment on table public.interview_notes is
  'What one interviewer wrote about one panel, in their own words. Read by every '
  'staff member who can see the schedule; changed only by its author.';

comment on column public.interview_notes.body is
  'The account itself, up to 4000 characters — the same bound the scorecard '
  'feedback holds, so notes can be offered into that box without truncating. '
  'A guide saved from the model sits under a heading that says so.';

comment on column public.interview_notes.author_profile_id is
  'Whose account this is, never a name sent by the browser. Part of the key, so a '
  'panel holds one note per interviewer rather than one blended text.';

create index if not exists interview_notes_interview_idx
  on public.interview_notes (interview_id);
create index if not exists interview_notes_author_idx
  on public.interview_notes (author_profile_id);

drop trigger if exists trg_interview_notes_updated on public.interview_notes;
CREATE TRIGGER trg_interview_notes_updated BEFORE UPDATE ON public.interview_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table if exists public.interview_notes enable row level security;

/*
 * The panel's evidence is readable by every staff member — the same wall
 * `interview_schedules` and `interview_scorecards` stand on. One company's hiring
 * calendar is visible to that company's staff, and a note adds no wider reach.
 */
drop policy if exists "interview_notes_staff_read" on public.interview_notes;
create policy "interview_notes_staff_read" on public.interview_notes
  for SELECT
  to authenticated
  using (is_staff());

/*
 * Your own account, and only your own. Three policies rather than one `for ALL`
 * because clearing a note is a delete here, not an empty string: the row's whole
 * content is the text, so a recruiter who decides their note was wrong to keep
 * removes the row and the trail says who removed it.
 */
drop policy if exists "interview_notes_own_add" on public.interview_notes;
create policy "interview_notes_own_add" on public.interview_notes
  for INSERT
  to authenticated
  with check (
    is_staff()
    and author_profile_id = current_user_profile_id()
  );

drop policy if exists "interview_notes_own_change" on public.interview_notes;
create policy "interview_notes_own_change" on public.interview_notes
  for UPDATE
  to authenticated
  using (
    is_staff()
    and author_profile_id = current_user_profile_id()
  )
  with check (
    is_staff()
    and author_profile_id = current_user_profile_id()
  );

drop policy if exists "interview_notes_own_remove" on public.interview_notes;
create policy "interview_notes_own_remove" on public.interview_notes
  for DELETE
  to authenticated
  using (
    is_staff()
    and author_profile_id = current_user_profile_id()
  );

grant select, insert, update, delete on table public.interview_notes to authenticated;
grant select, insert, update, delete on table public.interview_notes to service_role;
revoke all on table public.interview_notes from anon;

-- PostgREST caches its view of the schema, so a REST write to the new table is
-- refused as an unknown resource until the API reloads. Without this the desk
-- would say "not stored yet" against a database that has the table.
notify pgrst, 'reload schema';
