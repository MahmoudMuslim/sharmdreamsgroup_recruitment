-- ============================================================================
-- Consent, requests and retention: the candidate's own say over their record.
--
-- The portal keeps an application, a stage, a score and a trail for every person
-- who applies. Nothing so far records that the person agreed to any of it, gives
-- them a door to ask what is held or to have it removed, or ever lets a stale
-- record go. This migration is the three facts that answer those:
--
--   * a consent history — `candidate_consents` is append-only, one row per answer,
--     because a withdrawal is a second answer rather than an edit of the first.
--     Processing consent is required by the application; the talent pool is
--     optional and carries its own window;
--   * a request book — `privacy_requests` holds an access or erasure request from
--     the moment it is filed through to the moment it is executed or declined.
--     Filing is anonymous: the public page writes the row with the service role,
--     and the request never becomes a way to read the application back;
--   * a retention view — `application_retention` answers when a record's window
--     ran out and what is still open on it. It is a view rather than a sweep so
--     the console and the cron read the same arithmetic, and `security_invoker`
--     keeps the caller's own RLS in force.
--
-- Erasure is `erase_candidate_data(uuid)` and it anonymises rather than deletes.
-- The application row, its stage, its score and its dates are the company's record
-- that somebody was judged and are kept; the name, address, phone, CV text, the
-- candidate's written answers, recordings, transcripts and the notes staff wrote
-- about them are cleared. The row is marked with `erased_at` so no screen mistakes
-- it for a live application, and the erased address is built from the row id on
-- the reserved `.invalid` domain, so it is unique and can never be delivered to.
--
-- The function refuses what the domain module refuses: a hired application (that
-- record is employment history, not a lead), and a record with an assessment or
-- an interview still open (erasing under a live evaluation destroys the paper
-- being graded). Those refusals are here as well as in the action because the
-- function is callable on its own, and a guard that exists only in the caller is
-- one direct call away from being no guard at all.
--
-- The sweep ships OFF (`privacy.retention_enabled` defaults to false). A
-- destructive timer that starts on installation, before anybody has read the
-- console, is not a default anybody chose.
--
-- NOT APPLIED. This file is authored so the screens, the cron route and the proof
-- can name it; running it is the owner's decision. The apply form enforces
-- processing consent in code and treats the stamps as best-effort, so a database
-- without this migration still accepts applications — it just cannot prove later
-- that the consent was recorded.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The application's own consent stamps
--
-- The history lives in `candidate_consents`; these two stamps are the latest
-- answer denormalised onto the row the candidate portal and the pipeline already
-- read, because every screen that shows a candidate would otherwise have to join
-- a history and pick the newest. They are written by the same action that writes
-- the history, so they cannot disagree by more than the transaction they share.
-- ----------------------------------------------------------------------------

alter table public.applications
  add column if not exists processing_consent_at timestamp with time zone;
alter table public.applications
  add column if not exists talent_pool_consent_at timestamp with time zone;
alter table public.applications
  add column if not exists notice_version text;
alter table public.applications
  add column if not exists erased_at timestamp with time zone;
alter table public.applications
  add column if not exists retention_warned_at timestamp with time zone;

comment on column public.applications.processing_consent_at is
  'When the applicant agreed to their details being processed for this application. '
  'Null on rows written before consent was asked; those are not retroactively '
  'refused, and the retention sweep treats them like any other stale row.';
comment on column public.applications.talent_pool_consent_at is
  'When the applicant agreed to be kept for future roles. Null means no grant — '
  'either the pool was declined or the question was never asked. Its retention '
  'window runs from this instant.';
comment on column public.applications.notice_version is
  'Which published notice the consent was given against, so a later reworded '
  'notice cannot be read back as if the candidate had agreed to it.';
comment on column public.applications.erased_at is
  'Set by erase_candidate_data(). A non-null value means the person is gone and '
  'only the judgment remains; no screen may print this row as a live candidate.';
comment on column public.applications.retention_warned_at is
  'When the warning letter was sent. The sweep sends one and does not erase on the '
  'same pass, so the candidate has the stated window to come back.';

/*
 * A warning letter is our act, not the candidate's activity.
 *
 * `applications` carries a BEFORE UPDATE trigger that stamps `updated_at`, and the
 * retention view reads that column as the record's own last write. Stamping
 * `retention_warned_at` through the ordinary path would therefore restart the
 * window at the moment we warned: the record would sit permanently one window
 * from erasure and the sweep would warn it forever without ever acting. This
 * function keeps `updated_at` where it was when the warning stamp is the only
 * change; every real write still stamps it.
 *
 * `to_jsonb` compares the whole row, so a write that alters anything else — an
 * erasure, a contact edit, a stage move — takes the ordinary branch.
 */
create or replace function public.touch_application()
returns trigger
language plpgsql
as $$
begin
  if new.retention_warned_at is distinct from old.retention_warned_at
     and (to_jsonb(new) - 'retention_warned_at' - 'updated_at')
       = (to_jsonb(old) - 'retention_warned_at' - 'updated_at')
  then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

comment on function public.touch_application() is
  'The applications updated_at trigger, except that stamping retention_warned_at '
  'alone does not move updated_at — a warning is not candidate activity.';

drop trigger if exists trg_applications_updated_at on public.applications;
create trigger trg_applications_updated_at
  before update on public.applications
  for each row execute function public.touch_application();

-- ----------------------------------------------------------------------------
-- The history
-- ----------------------------------------------------------------------------

create table if not exists public.candidate_consents (
  id uuid default gen_random_uuid(),
  application_id uuid not null,
  purpose text not null,
  granted boolean not null,
  notice_version text not null,
  recorded_at timestamp with time zone default now() not null,
  constraint candidate_consents_pkey primary key (id),
  constraint candidate_consents_purpose_check
    check (purpose in ('processing', 'talent_pool')),
  constraint candidate_consents_application_id_fkey
    foreign key (application_id) references applications (id) on delete cascade
);

comment on table public.candidate_consents is
  'Append-only consent history: one row per answer, never an edit. A withdrawal is '
  'a later row with granted = false, and the newest row by recorded_at is the '
  'answer in force.';

comment on column public.candidate_consents.notice_version is
  'The notice the answer was given against. Present on every row so the history '
  'still explains itself after the wording changes.';

create index if not exists candidate_consents_application_idx
  on public.candidate_consents (application_id, purpose, recorded_at desc);

alter table if exists public.candidate_consents enable row level security;

drop policy if exists "candidate_consents_staff_read" on public.candidate_consents;
create policy "candidate_consents_staff_read" on public.candidate_consents
  for SELECT
  to authenticated
  using (is_staff());

grant select on table public.candidate_consents to authenticated;
grant select, insert, update, delete on table public.candidate_consents to service_role;
revoke all on table public.candidate_consents from anon;

-- ----------------------------------------------------------------------------
-- The request book
-- ----------------------------------------------------------------------------

create table if not exists public.privacy_requests (
  id uuid default gen_random_uuid(),
  kind text not null,
  email text not null,
  note text,
  state text default 'RECEIVED'::text not null,
  application_id uuid,
  verified_by uuid,
  verified_at timestamp with time zone,
  decided_by uuid,
  decided_at timestamp with time zone,
  executed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint privacy_requests_pkey primary key (id),
  constraint privacy_requests_kind_check
    check (kind in ('access', 'erasure')),
  constraint privacy_requests_state_check
    check (state in ('RECEIVED', 'VERIFIED', 'APPROVED', 'EXECUTED', 'DECLINED')),
  constraint privacy_requests_email_check
    check (length(btrim(email)) > 3 and position('@' in email) > 1),
  constraint privacy_requests_note_check
    check (note is null or length(note) <= 400),
  constraint privacy_requests_application_id_fkey
    foreign key (application_id) references applications (id) on delete set null,
  constraint privacy_requests_verified_by_fkey
    foreign key (verified_by) references user_profiles (id) on delete set null,
  constraint privacy_requests_decided_by_fkey
    foreign key (decided_by) references user_profiles (id) on delete set null
);

comment on table public.privacy_requests is
  'One person''s ask to see or erase what is held. Filed anonymously, verified and '
  'decided by staff, executed once. The email is folded by the action, not by the '
  'column, so the desk can show what was typed.';

comment on column public.privacy_requests.application_id is
  'The record the request was matched to when it was verified. Null until then; '
  'an access request that matches nothing is declined rather than answered.';

create index if not exists privacy_requests_state_idx
  on public.privacy_requests (state, created_at desc);
create index if not exists privacy_requests_email_idx
  on public.privacy_requests (lower(email));
create index if not exists privacy_requests_application_idx
  on public.privacy_requests (application_id);

drop trigger if exists trg_privacy_requests_updated on public.privacy_requests;
CREATE TRIGGER trg_privacy_requests_updated BEFORE UPDATE ON public.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * Two role tests, named rather than inlined, because they appear in several
 * policies and because 041 must not depend on 040: `is_recruiter()` lives there,
 * and a database that has applied this file alone would otherwise fail to create
 * the policies below.
 */
create or replace function public.is_privacy_reader()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from user_profiles
    where auth_user_id = auth.uid()
      and role::text in ('SUPER_ADMIN', 'RECRUITER')
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from user_profiles
    where auth_user_id = auth.uid()
      and role::text = 'SUPER_ADMIN'
  );
$$;

alter table if exists public.privacy_requests enable row level security;

/*
 * Reading the desk is a recruiter's or the owner's. A hiring manager does not
 * see it: the row names an address and what a person asked for, and answering
 * that is not part of running a pipeline.
 */
drop policy if exists "privacy_requests_desk_read" on public.privacy_requests;
create policy "privacy_requests_desk_read" on public.privacy_requests
  for SELECT
  to authenticated
  using (is_privacy_reader());

/*
 * Verifying is a recruiter's step; approving, declining and executing are the
 * owner's. The action checks the same roles, and this WITH CHECK is the copy that
 * holds for a request that bypasses it. A hiring manager can read a request but
 * not move it.
 *
 * `USING` sees the old row and `WITH CHECK` the new one, so the role that may
 * write is decided by where the request is going: a reader may leave it at
 * VERIFIED, and only the owner may write any other state. Without the second
 * clause a recruiter's own session could approve and execute by hand, which is
 * exactly the step the action reserves.
 */
drop policy if exists "privacy_requests_desk_update" on public.privacy_requests;
create policy "privacy_requests_desk_update" on public.privacy_requests
  for UPDATE
  to authenticated
  using (is_privacy_reader())
  with check (
    is_privacy_reader()
    and state <> 'RECEIVED'
    and (state = 'VERIFIED' or is_owner())
  );

/*
 * Filing is anonymous and goes through the server action, so it uses the service
 * role. Anon is granted nothing: a direct REST insert could otherwise file
 * requests in anybody's name.
 */
grant select, update on table public.privacy_requests to authenticated;
grant select, insert, update, delete on table public.privacy_requests to service_role;
revoke all on table public.privacy_requests from anon;

-- ----------------------------------------------------------------------------
-- When a record's window ran out
-- ----------------------------------------------------------------------------

/*
 * Last activity is the newest of: the application's own last write, its latest
 * consent answer, its latest submitted paper, and its latest interview row.
 * `updated_at` alone would let a background write keep a dead record alive, while
 * ignoring consents would let a fresh pool grant fall straight into the twelve-
 * month window it replaced.
 *
 * Open work is counted rather than guessed: an assessment is open in exactly the
 * two statuses the runner leaves before submission, and an interview is open
 * while it is SCHEDULED.
 */
create or replace view public.application_retention
with (security_invoker = true)
as
select
  a.id as application_id,
  a.stage::text as stage,
  a.created_at,
  a.archived_at,
  a.erased_at,
  a.retention_warned_at,
  greatest(
    a.updated_at,
    a.created_at,
    coalesce((select max(c.recorded_at) from candidate_consents c where c.application_id = a.id), a.created_at),
    coalesce((select max(t.submitted_at) from candidate_attempts t where t.application_id = a.id), a.created_at),
    coalesce((select max(s.created_at) from interview_schedules s where s.application_id = a.id), a.created_at)
  ) as last_activity_at,
  (select max(c.recorded_at) from candidate_consents c
    where c.application_id = a.id and c.purpose = 'talent_pool' and c.granted) as pool_granted_at,
  (select count(*) from candidate_attempts t
    where t.application_id = a.id and t.status in ('NOT_STARTED', 'IN_PROGRESS')) as open_assessments,
  (select count(*) from interview_schedules s
    where s.application_id = a.id and s.status = 'SCHEDULED') as open_interviews
from applications a;

comment on view public.application_retention is
  'One row per application: its newest activity, its talent-pool grant if any, and '
  'what is still open. Read by the retention console and the daily sweep so both '
  'compute the same window. security_invoker keeps the caller''s RLS in force.';

grant select on table public.application_retention to authenticated;
grant select on table public.application_retention to service_role;
revoke all on table public.application_retention from anon;

-- ----------------------------------------------------------------------------
-- Erasure
-- ----------------------------------------------------------------------------

/*
 * Anonymise one application, in one transaction.
 *
 * Storage objects are removed by the caller before this runs, because the file
 * store is outside the database; every path column is cleared here so a stale
 * reference cannot be read back as if the object still existed. The function is
 * idempotent: an already-erased row is blanked again to the same values, and the
 * storage delete the caller already did is a no-op.
 */
create or replace function public.erase_candidate_data(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage text;
  v_erased_at timestamp with time zone := now();
  v_erased_email text;
begin
  select stage::text into v_stage
    from applications
   where id = p_application_id
     for update;

  if not found then
    raise exception 'application % does not exist', p_application_id
      using errcode = 'P0002';
  end if;

  if v_stage = 'HIRED' then
    raise exception 'a hired application is employment history and is not erased'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from candidate_attempts
     where application_id = p_application_id
       and status in ('NOT_STARTED', 'IN_PROGRESS')
  ) then
    raise exception 'an assessment is still open on this application'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from interview_schedules
     where application_id = p_application_id
       and status = 'SCHEDULED'
  ) then
    raise exception 'an interview is still scheduled on this application'
      using errcode = 'P0001';
  end if;

  -- Built from the row id, on the reserved `.invalid` domain: unique, stable and
  -- undeliverable. The original address is not read into a variable at all.
  v_erased_email := 'erased+' || substr(replace(p_application_id::text, '-', ''), 1, 8) || '@erased.invalid';

  update candidate_responses r
     set answer_text = null,
         spreadsheet_state = null,
         transcript = null,
         video_path = null,
         ai_evaluation = null
    from candidate_attempts a
   where a.id = r.attempt_id
     and a.application_id = p_application_id;

  update integrity_events e
     set detail = null,
         device_label = null,
         session_fingerprint = null
    from candidate_attempts a
   where a.id = e.attempt_id
     and a.application_id = p_application_id;

  delete from interview_notes n
   using interview_schedules s
   where s.id = n.interview_id
     and s.application_id = p_application_id;

  update interview_scorecards c
     set feedback = null
    from interview_schedules s
   where s.id = c.interview_id
     and s.application_id = p_application_id;

  update communication_logs
     set recipient = v_erased_email,
         body = 'Erased at the candidate''s request.',
         subject = null
   where application_id = p_application_id;

  delete from application_attachments
   where application_id = p_application_id;

  update privacy_requests
     set email = v_erased_email,
         note = null,
         state = 'EXECUTED',
         executed_at = coalesce(executed_at, v_erased_at)
   where application_id = p_application_id
     and kind = 'erasure'
     and state <> 'DECLINED';

  /*
   * A referral credits one staff member for one person, and it copies the name
   * and address. 040 may not have been applied on this database, so the statement
   * is resolved at run time rather than failing this migration at creation.
   */
  if to_regclass('public.referrals') is not null then
    execute
      'update public.referrals
          set full_name = $1, email = $2, note = null
        where application_id = $3'
      using 'Erased candidate', v_erased_email, p_application_id;
  end if;

  update applications
     set full_name = 'Erased candidate',
         email = v_erased_email,
         phone = null,
         cv_text = null,
         cv_file_path = null,
         ai_screening_summary = null,
         ai_strengths = null,
         ai_gaps = null,
         ai_soft_skills = null,
         ai_feedback = null,
         diversity_flags = null,
         rejection_reason = null,
         gate_answers = null,
         erased_at = coalesce(erased_at, v_erased_at),
         retention_warned_at = null,
         updated_at = v_erased_at
   where id = p_application_id;

  return jsonb_build_object(
    'application_id', p_application_id,
    'erased_at', v_erased_at
  );
end;
$$;

comment on function public.erase_candidate_data(uuid) is
  'Anonymises one application: clears the person and their writing, keeps the row, '
  'stage, score and dates, and stamps erased_at. Refuses a hired record and a '
  'record with an open assessment or interview. Caller removes storage objects '
  'first; every path column is cleared here.';

revoke all on function public.erase_candidate_data(uuid) from public;
revoke all on function public.erase_candidate_data(uuid) from anon;
revoke all on function public.erase_candidate_data(uuid) from authenticated;
grant execute on function public.erase_candidate_data(uuid) to service_role;

grant execute on function public.is_privacy_reader() to authenticated;
grant execute on function public.is_privacy_reader() to service_role;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_owner() to service_role;

-- PostgREST caches its schema, so the desk would read a missing table and the
-- cron would call a missing function until this notification is sent.
notify pgrst, 'reload schema';

-- Next file: 042.
