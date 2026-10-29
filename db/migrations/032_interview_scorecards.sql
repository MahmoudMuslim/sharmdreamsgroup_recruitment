-- ---------------------------------------------------------------------------
-- What the panel actually thought, and which round it sat.
--
-- Today an interview has one outcome — COMPLETED, NO_SHOW or CANCELLED — and a
-- free-text none. The portal can say a panel happened and cannot say whether the
-- interviewer would hire the person. The hiring spec asks for the opposite: a
-- scorecard with four rating criteria (technical, communication, problem
-- solving, culture) and a written judgement, plus rounds so a candidate can sit
-- Screening, Technical, Hiring Manager and Culture Fit panels without four
-- bookings that look identical.
--
-- Two shapes are possible for the ratings: columns on `interview_schedules`, or
-- a separate scorecard per interviewer. The second is the only honest one. A
-- panel can have more than one interviewer, each holds their own opinion, and a
-- row on the schedule has exactly one `interviewer_profile_id` — so putting the
-- ratings there would silently say one person's view is the panel's, and a
-- second interviewer's opinion would overwrite the first's. One row per
-- (interview, author) keeps every opinion with the person who formed it.
--
-- The four ratings are 1..5, stored as smallint rather than a single average.
-- Averaging at write time would throw away the disagreement the panel exists to
-- discover; the portal can average at read time and still show that one
-- interviewer scored technical 5 and another 2. The feedback is optional: a
-- scorecard with numbers and no words is still a judgement, and forcing a
-- sentence would produce a sentence of filler.
--
-- `round` is nullable on purpose. Historical panels were never assigned one, and
-- a default of SCREENING would relabel panels that may have been technical
-- interviews — a claim the data does not support. Null means "no round was
-- recorded", which is the truth for every panel booked before this migration,
-- and the agenda shows the round only when there is one.
--
-- The scorecards are evidence about the interviewer's thinking, not about the
-- candidate's worth: every staff member may read them (the same wall
-- `interview_schedules` already uses), but a session may only write its own,
-- keyed by `current_user_profile_id()`. An author who leaves the portal keeps
-- their words — the foreign key sets null rather than cascading, because a
-- scorecard is part of the interview's history and deleting the account must not
-- rewrite what the panel considered. The interview itself cascades: a schedule
-- row that disappears takes its scorecards, which have no meaning without it.
--
-- APPLIED on this local database. The date this file was run is not recorded
-- here; what is recorded is the catalog re-read on 2026-10-29, which found
-- `interview_scorecards` with row security on and its three policies (staff read,
-- own add, own change), `interview_schedules.round` beside the
-- `interview_schedules_round_check` constraint, and the
-- `trg_interview_scorecards_updated` trigger. The rounds column is read through
-- its own probe and the scorecard table through another because both were written
-- against a database that might not have them: on a database where this file has
-- never run, the agenda and the booking form say the migration's name instead of
-- pretending a panel was never scored. That is the condition those probes answer,
-- not this database's state.
-- ---------------------------------------------------------------------------

alter table public.interview_schedules
  add column if not exists round text;

alter table public.interview_schedules
  drop constraint if exists interview_schedules_round_check,
  add constraint interview_schedules_round_check
    check (
      round is null
      or round = any (array['SCREENING', 'TECHNICAL', 'HIRING_MANAGER', 'CULTURE_FIT'])
    );

comment on column public.interview_schedules.round is
  'Which round of the process this panel is, or NULL when none was recorded. '
  'Nullable rather than defaulted: panels booked before the rework were never '
  'asked, and labelling them SCREENING would invent an answer.';

create table if not exists public.interview_scorecards (
  id uuid default gen_random_uuid(),
  interview_id uuid not null,
  author_profile_id uuid,
  technical smallint not null,
  communication smallint not null,
  problem_solving smallint not null,
  culture smallint not null,
  feedback text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint interview_scorecards_pkey primary key (id),
  constraint interview_scorecards_ratings_check
    check (
      technical between 1 and 5
      and communication between 1 and 5
      and problem_solving between 1 and 5
      and culture between 1 and 5
    ),
  constraint interview_scorecards_feedback_check
    check (feedback is null or char_length(feedback) <= 4000),
  -- One opinion per person per panel: a second save is an edit, not a second row.
  constraint interview_scorecards_one_per_author
    unique (interview_id, author_profile_id),
  constraint interview_scorecards_interview_id_fkey
    foreign key (interview_id) references interview_schedules (id) on delete cascade,
  constraint interview_scorecards_author_profile_id_fkey
    foreign key (author_profile_id) references user_profiles (id) on delete set null
);

comment on table public.interview_scorecards is
  'One interviewer''s judgement of one panel: four 1..5 ratings and an optional '
  'written note. One row per (interview, author), so a panel of three keeps three '
  'opinions rather than one overwritten average.';

comment on column public.interview_scorecards.technical is
  'Technical rating, 1 (weak) to 5 (exceptional). Stored per criterion so the '
  'portal can show a disagreement the panel exists to find.';

comment on column public.interview_scorecards.feedback is
  'The interviewer''s own words, optional. Null or blank means the ratings stood '
  'alone; the console never substitutes a generated sentence.';

comment on column public.interview_scorecards.author_profile_id is
  'Who formed this opinion. Null only after that account is deleted — the words '
  'stay on the interview''s history, but they no longer belong to a live person.';

create index if not exists interview_scorecards_interview_idx
  on public.interview_scorecards (interview_id);
create index if not exists interview_scorecards_author_idx
  on public.interview_scorecards (author_profile_id);

drop trigger if exists trg_interview_scorecards_updated on public.interview_scorecards;
CREATE TRIGGER trg_interview_scorecards_updated BEFORE UPDATE ON public.interview_scorecards FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table if exists public.interview_scorecards enable row level security;

/*
 * The panel's evidence is readable by every staff member, which is the same
 * wall `interview_schedules` itself uses — one company's hiring calendar is
 * visible to that company's staff through the application read, and scorecards
 * add no wider reach.
 */
drop policy if exists "interview_scorecards_staff_read" on public.interview_scorecards;
create policy "interview_scorecards_staff_read" on public.interview_scorecards
  for SELECT
  to authenticated
  using (is_staff());

/*
 * Your own opinion, and only your own. The WITH CHECK is what stops a write
 * naming a colleague as the author; the console already sends the session's
 * profile id, and this is the copy that holds when a request arrives from
 * somewhere else.
 */
drop policy if exists "interview_scorecards_own_add" on public.interview_scorecards;
create policy "interview_scorecards_own_add" on public.interview_scorecards
  for INSERT
  to authenticated
  with check (
    is_staff()
    and author_profile_id = current_user_profile_id()
  );

drop policy if exists "interview_scorecards_own_change" on public.interview_scorecards;
create policy "interview_scorecards_own_change" on public.interview_scorecards
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

grant select, insert, update on table public.interview_scorecards to authenticated;
grant select, insert, update, delete on table public.interview_scorecards to service_role;
revoke all on table public.interview_scorecards from anon;

-- PostgREST caches its view of the schema, so neither the new column nor the
-- new table is visible to REST until the API reloads. Without this the agenda
-- would keep reporting "not stored yet" against a database that has both.
notify pgrst, 'reload schema';
