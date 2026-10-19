-- ---------------------------------------------------------------------------
-- Where the working day actually went.
--
-- The portal already measures everything *about* the candidates — how many
-- applied, how long a stage took, what a panel scored — and nothing about the
-- people doing the work. A recruiter who spent the morning on four pitch
-- recordings and the afternoon on a panel has no record of it anywhere: the
-- stage timestamps say when a candidate moved, not who spent how long moving
-- them, and `interview_schedules.duration_minutes` is the booking, not the time
-- actually given.
--
-- So this is a ledger of worked time, written by the person who worked it. Each
-- row is one span — a start, an end, what it was for and who it belonged to.
--
-- The two timestamps are stored, not a duration. A duration would be a second
-- copy of an arithmetic fact that the database can always recompute, and it
-- would go stale the moment an entry is edited. It also lets a timer keep
-- counting while nobody is looking: a started row with no end *is* the running
-- timer, so closing the browser, signing out or losing the tab loses nothing,
-- and the elapsed time on reload is measured against the database clock rather
-- than whatever the laptop thinks the time is.
--
-- One running entry per person, enforced here rather than in the console. A
-- second Start would otherwise nest silently, and two overlapping spans make
-- every total in the portal wrong at once — the honest answer is that one
-- person tracks one thing at a time, and the unique index says so even when the
-- request arrives through two tabs.
--
-- `staff_id` points at `user_profiles`, the same row the change trail's actor
-- points at, so a person's hours and a person's changes key off one identity.
-- It cascades on delete: an account removed from the portal takes its timesheet
-- with it, because hours attributed to a person who no longer exists are not
-- reportable data. `application_id` and `job_id` only ever set null. Losing a
-- candidate record must not silently erase the hours someone logged against it;
-- an unlabelled span of time is still a span of time.
--
-- Reads follow the company wall, writes do not leave their owner. Every staff
-- member in a company can see that company's timesheet — hours are team data
-- here, in the same way the pipeline is — but a session may only insert, edit or
-- delete its own rows, which is the shape the RLS policies below encode rather
-- than anything the console has to remember to enforce. A super admin deleting
-- another person's entry is the one exception, and it is the same exception the
-- rest of the schema makes for account-level clean-up.
--
-- `time.track` is a new permission rather than a reuse of `candidates.read`,
-- because "may log hours" and "may see candidate records" are different grants
-- and Roles & permissions can only hand out what exists as a row. It is seeded
-- here, together with the grants the four working roles already carry, so a
-- rebuild from `schema.sql` has the vocabulary as well as the table.
-- ---------------------------------------------------------------------------

create table if not exists public.time_entries (
  id uuid default gen_random_uuid(),
  company_id uuid,
  staff_id uuid not null,
  category text not null,
  task text not null,
  job_id uuid,
  application_id uuid,
  note text,
  started_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint time_entries_pkey primary key (id),
  constraint time_entries_category_check
    check (category = any (array[
      'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'ONBOARDING',
      'SOURCING', 'ADMIN', 'OTHER'
    ])),
  constraint time_entries_task_check check (char_length(btrim(task)) between 1 and 160),
  constraint time_entries_note_check check (note is null or char_length(note) <= 500),
  -- A span that runs backwards is a hand-edited row, not a short day.
  constraint time_entries_span_check check (ended_at is null or ended_at > started_at),
  constraint time_entries_company_id_fkey
    foreign key (company_id) references tenants_and_companies (id) on delete set null,
  constraint time_entries_staff_id_fkey
    foreign key (staff_id) references user_profiles (id) on delete cascade,
  constraint time_entries_job_id_fkey
    foreign key (job_id) references job_openings (id) on delete set null,
  constraint time_entries_application_id_fkey
    foreign key (application_id) references applications (id) on delete set null
);

comment on table public.time_entries is
  'Worked time logged by staff: one row per span, with what it was spent on and '
  'which candidate or opening it belonged to. A row with no ended_at is the running timer.';

comment on column public.time_entries.task is
  'What the person was doing, in their own words, e.g. "Score the four sales pitch '
  'recordings". Free text so it can name the real work; the category is the part the '
  'reports can group.';

comment on column public.time_entries.started_at is
  'When the span began. Set by the database clock, never typed in as a duration, so a '
  'timer left running over the weekend reads as the 48 hours it is rather than as a guess.';

comment on column public.time_entries.ended_at is
  'When the span ended. Null means still running: the elapsed time is computed from '
  'started_at at read time, so the number is always the database''s, not the browser''s.';

comment on column public.time_entries.application_id is
  'The candidate the time went to, when there is one. Set null if the application '
  'disappears: hours are not the candidate''s property and must not vanish with them.';

-- Every screen of this table is a person's or a company's ledger, newest first.
create index if not exists time_entries_staff_started_idx
  on public.time_entries (staff_id, started_at desc);
create index if not exists time_entries_company_started_idx
  on public.time_entries (company_id, started_at desc);
create index if not exists time_entries_application_idx
  on public.time_entries (application_id);
create index if not exists time_entries_job_idx
  on public.time_entries (job_id);

-- One timer per person. Partial so it says nothing about finished spans: only
-- the running row is unique, and a day can hold as many completed entries as
-- the person wants.
drop index if exists public.time_entries_one_running_idx;
create unique index time_entries_one_running_idx
  on public.time_entries (staff_id)
  where ended_at is null;

drop trigger if exists trg_time_entries_updated on public.time_entries;
CREATE TRIGGER trg_time_entries_updated BEFORE UPDATE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table if exists public.time_entries enable row level security;

/*
 * The whole company's ledger is readable by the whole company. `is_staff()`
 * alone would let a recruiter in one subsidiary read another's hours, so the
 * company wall is the same one `applications_staff_read` builds: super admins
 * see everything, a member of the group sees their own company, and a staff
 * account with no company at all is not walled by one.
 */
drop policy if exists "time_entries_company_read" on public.time_entries;
create policy "time_entries_company_read" on public.time_entries
  for SELECT
  to authenticated
  using (
    is_staff()
    and (
      is_super_admin()
      or user_tenant_id() is null
      or company_id is null
      or company_id = user_tenant_id()
    )
  );

/*
 * Your own rows, and only your own. `current_user_profile_id()` is what makes
 * that mean the same thing as `staff_id` here: `auth.uid()` is the account, the
 * ledger keys off the profile, and the two are only the same person through
 * `user_profiles.auth_user_id`.
 *
 * The same permission gates INSERT, UPDATE and DELETE because starting, editing
 * and removing one's own hours are the same ability; there is no separate
 * "someone else's entry" write path, so an UPDATE policy that lets the row move
 * to another person would be a way to hand your hours to a colleague. `WITH
 * CHECK` refuses it.
 */
drop policy if exists "time_entries_own_add" on public.time_entries;
create policy "time_entries_own_add" on public.time_entries
  FOR INSERT
  to authenticated
  with check (
    is_staff()
    and has_permission('time.track'::text)
    and staff_id = current_user_profile_id()
  );

drop policy if exists "time_entries_own_change" on public.time_entries;
create policy "time_entries_own_change" on public.time_entries
  FOR UPDATE
  to authenticated
  using (
    is_staff()
    and has_permission('time.track'::text)
    and staff_id = current_user_profile_id()
  )
  with check (
    is_staff()
    and has_permission('time.track'::text)
    and staff_id = current_user_profile_id()
  );

drop policy if exists "time_entries_own_remove" on public.time_entries;
create policy "time_entries_own_remove" on public.time_entries
  FOR DELETE
  to authenticated
  using (
    is_staff()
    and has_permission('time.track'::text)
    and (staff_id = current_user_profile_id() or is_super_admin())
  );

grant select, insert, update, delete on table public.time_entries to authenticated;
grant select, insert, update, delete on table public.time_entries to service_role;
revoke all on table public.time_entries from anon;

-- ---------------------------------------------------------------------------
-- Stopping a timer stamps the end with the database clock.
--
-- The web server could send its own `now()` instead, and that is exactly the
-- problem: the start it is compared against was written by the database, so a
-- host whose clock runs a few seconds behind would produce an `ended_at` earlier
-- than the `started_at` it belongs to, the span check would refuse the update,
-- and the person would be unable to stop the timer they are holding. Reading one
-- clock for both ends removes the whole class.
--
-- `SECURITY INVOKER` on purpose: the caller's own session evaluates the UPDATE
-- policy above, so this cannot stop anyone else's row, and it is not a
-- privilege-escalating function sitting in the exposed schema. It returns the
-- instant it wrote, so the caller reads back the truth rather than assuming it.
-- ---------------------------------------------------------------------------
create or replace function public.stop_time_entry(entry_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  update public.time_entries
     set ended_at = now()
   where id = entry_id
     and ended_at is null
  returning ended_at;
$function$;

comment on function public.stop_time_entry(uuid) is
  'Ends a running entry with the database clock. Refuses a row that is already '
  'finished, and refuses another person''s row through the same UPDATE policy the console uses.';

revoke all on function public.stop_time_entry(uuid) from public;
grant execute on function public.stop_time_entry(uuid) to authenticated;
grant execute on function public.stop_time_entry(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The vocabulary this table needs: `time.track`, granted to the four roles that
-- do hiring work. Granted here rather than left for the matrix to be edited
-- later, because a permission nobody holds looks identical to a feature that
-- was never built.
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, group_name, description)
values ('time.track', 'Track time', 'Time', 'Start, stop and edit your own logged hours')
on conflict (key) do nothing;

insert into public.role_permissions (role_key, permission_key, granted)
values
  ('SUPER_ADMIN', 'time.track', true),
  ('SUBSIDIARY_HR_MANAGER', 'time.track', true),
  ('RECRUITER', 'time.track', true),
  ('HIRING_MANAGER', 'time.track', true)
on conflict (role_key, permission_key) do nothing;
