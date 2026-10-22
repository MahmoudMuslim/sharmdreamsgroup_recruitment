-- ============================================================================
-- A suite can send the candidate on to a second test, based on the first result.
--
-- The hiring spec asks for a two-stage assessment: a candidate who lands in a
-- band on the first suite — "scored above 70 but below 90, send them the
-- technical model" — is issued the next suite automatically, without a recruiter
-- watching the grading queue. Today the only door that issues an attempt is
-- `assignTemplate`, a person clicking Assign after reading the score, so the
-- second stage exists only as long as somebody remembers to open the screen.
--
-- The rule lives on the *source* suite because that is where the recruiter
-- thinks about it: "what happens when someone finishes this test?". Three
-- columns, written together or not at all:
--
--   follow_up_template_id  the suite to issue (the same row cannot name itself)
--   follow_up_min_percent  the bottom of the band, inclusive
--   follow_up_max_percent  the top of the band, inclusive
--
-- The band is a percentage of the source suite's marks, not a raw score: 70% of
-- a 40-mark paper and 70% of a 100-mark paper are the same judgement, and the
-- author should not have to redo the arithmetic when a question's points change.
--
-- All three null is the normal state and stays valid — most suites have no
-- second stage. Anything in between is refused, because a target with no band
-- would route every candidate, and a band with no target would silently drop
-- the rule a recruiter thought they had written. `0 <= min <= max <= 100`,
-- both included, so 0–100 routes everyone and 85–85 routes an exact score.
--
-- `candidate_attempts.follow_up_of_attempt_id` records which paper caused this
-- issuance. It is what the trail, the report and the candidate's history read
-- to explain where a test they never asked for came from. The partial unique
-- index is the idempotency guard: a re-grade, a cron sweep and a hand-marked
-- last answer can each cross the attempt into GRADED, and all three may run the
-- router; the second insert must be refused by the database rather than
-- produce a duplicate link. `on delete set null` keeps the issued attempt when
-- its source is ever removed — the candidate's paper does not become orphaned
-- history because another row went away.
--
-- This migration is NOT applied to any database yet. Every reader probes for
-- these columns and, while they are missing, says so in the words that name
-- this file — the suite editor hides the rule, `getTemplates` keeps answering
-- without it, and the router quietly does nothing. Applying it is the owner's
-- decision.
-- ============================================================================

alter table public.assessment_templates
  add column if not exists follow_up_template_id uuid,
  add column if not exists follow_up_min_percent smallint,
  add column if not exists follow_up_max_percent smallint;

alter table public.candidate_attempts
  add column if not exists follow_up_of_attempt_id uuid;

-- --------------------------------------------------------------------------
-- The three template columns are one rule, not three settings.
-- --------------------------------------------------------------------------

do $$ begin
  alter table public.assessment_templates
    add constraint assessment_templates_follow_up_template_id_fkey
    foreign key (follow_up_template_id)
    references public.assessment_templates(id)
    on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assessment_templates
    add constraint assessment_templates_follow_up_complete_check
    check (
      (follow_up_template_id is null
        and follow_up_min_percent is null
        and follow_up_max_percent is null)
      or
      (follow_up_template_id is not null
        and follow_up_min_percent is not null
        and follow_up_max_percent is not null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assessment_templates
    add constraint assessment_templates_follow_up_min_check
    check (follow_up_min_percent is null or follow_up_min_percent between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assessment_templates
    add constraint assessment_templates_follow_up_max_check
    check (follow_up_max_percent is null or follow_up_max_percent between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assessment_templates
    add constraint assessment_templates_follow_up_band_check
    check (
      follow_up_min_percent is null
      or follow_up_max_percent is null
      or follow_up_min_percent <= follow_up_max_percent
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.assessment_templates
    add constraint assessment_templates_follow_up_not_self_check
    check (follow_up_template_id is null or follow_up_template_id <> id);
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- The issued attempt remembers the paper that caused it.
-- --------------------------------------------------------------------------

do $$ begin
  alter table public.candidate_attempts
    add constraint candidate_attempts_follow_up_of_attempt_id_fkey
    foreign key (follow_up_of_attempt_id)
    references public.candidate_attempts(id)
    on delete set null;
exception when duplicate_object then null; end $$;

-- One follow-up per source attempt. The router checks before inserting, but the
-- check and the insert are two statements: two grading paths crossing the same
-- attempt at once would both see "none yet". The index is the rule the check
-- only tries to predict.
create unique index if not exists candidate_attempts_follow_up_once
  on public.candidate_attempts (follow_up_of_attempt_id)
  where follow_up_of_attempt_id is not null;

comment on column public.assessment_templates.follow_up_template_id is
  'Suite issued automatically when a candidate finishes this one inside the percent band. Null means no second stage.';
comment on column public.assessment_templates.follow_up_min_percent is
  'Bottom of the follow-up band, inclusive, as a percentage of this suite''s marks.';
comment on column public.assessment_templates.follow_up_max_percent is
  'Top of the follow-up band, inclusive, as a percentage of this suite''s marks.';
comment on column public.candidate_attempts.follow_up_of_attempt_id is
  'The graded attempt whose rule issued this one. Null for every attempt a person assigned.';

-- PostgREST caches its view of the schema, columns included. Without this the
-- editor could save a rule the REST layer still believes does not exist.
notify pgrst, 'reload schema';
