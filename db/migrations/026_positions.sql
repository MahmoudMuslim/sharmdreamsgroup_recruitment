-- ============================================================================
-- A position definition: the vacancy copy an opening starts from.
--
-- The portal can open a role, but every opening starts from a blank form and a
-- recruiter retypes the same title, department, responsibilities, requirements
-- and salary band each time the group hires for a post it hires for every
-- season. Nothing records the post itself — only the requisition that was last
-- written against it — so two openings for the same job can disagree about the
-- pay band, and the second one is typed from memory.
--
-- A position is that missing definition: one row per post a company (or the
-- group, when `tenant_id` is null) hires for, carrying the words an opening
-- should inherit. It is deliberately *not* a requisition: it has no location,
-- employment type or status, because those belong to the particular opening and
-- change between intakes. Opening a role from a position copies its title,
-- department, responsibilities (into the opening's description), requirements
-- and salary band — and records which position it came from, so the copy can be
-- traced without claiming the opening is still the position.
--
-- The link is `on delete set null`, like every other historical link in this
-- schema: retiring a position must not take the openings that were written from
-- it. `position_id` is nullable because every opening that exists today predates
-- this table and because a one-off role may have no definition to inherit from.
--
-- `department` is stored as the department's name, matching what `job_openings`
-- stores and for the same reason: the write door resolves it against the live
-- `departments` list before it lands, so the two never disagree about what a
-- department is called. The salary columns keep the `_usd` names their siblings
-- on `job_openings` carry — the amount is in `salary_currency`, not dollars —
-- so the inheritance path can copy them across without a renaming layer.
--
-- The unique indexes make the list addressable by the words a recruiter reads:
-- one title per company, and one group-wide title. The application refuses a
-- second row that reads alike before it gets here, because that is also how a
-- job filing resolves, but the database is the last line against a script.
--
-- Applied to the local self-hosted database on 2026-10-23 and proven against it:
-- the positions console, the create-from-position door on /jobs and the
-- assistant's inheritance path all read this table. The application still treats
-- a missing table as "not created yet" and says so — `positionsAvailable` is the
-- one flag for that — so a database where this has not been run keeps its jobs
-- and settings screens working, with only the position doors shut.
-- ============================================================================

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants_and_companies (id) on delete cascade,
  title text not null,
  department text not null,
  grade text,
  responsibilities text,
  requirements text[] not null default '{}',
  min_salary_usd numeric(12, 2),
  max_salary_usd numeric(12, 2),
  salary_currency text not null default 'USD',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint positions_title_check check (char_length(btrim(title)) between 1 and 160),
  constraint positions_department_check check (char_length(btrim(department)) between 1 and 120),
  constraint positions_grade_check check (grade is null or char_length(btrim(grade)) <= 40),
  constraint positions_responsibilities_check
    check (responsibilities is null or char_length(responsibilities) <= 4000),
  constraint positions_requirements_check
    check (array_length(requirements, 1) is null or array_length(requirements, 1) <= 30),
  constraint positions_salary_check check (
    (min_salary_usd is null or min_salary_usd >= 0)
    and (max_salary_usd is null or max_salary_usd >= 0)
    and (min_salary_usd is null or max_salary_usd is null or max_salary_usd >= min_salary_usd)
  ),
  constraint positions_currency_check check (salary_currency ~ '^[A-Z]{3}$')
);

comment on table public.positions is
  'A post a company or the group hires for: the title, department, grade, '
  'responsibilities, requirements and salary band a new job opening inherits. '
  'Not a requisition — location, employment type and status belong to the opening.';

comment on column public.positions.tenant_id is
  'The company that owns this definition. NULL is group-wide, offered to an '
  'opening at any company, the same scope departments and locations use.';

comment on column public.positions.title is
  'The post as a recruiter names it. Copied into job_openings.title when an opening starts here.';

comment on column public.positions.department is
  'The department name as the departments list spells it. Resolved against that '
  'list on write, and copied into job_openings.department.';

comment on column public.positions.grade is
  'The internal grade or band label, e.g. "G7" or "Manager". Not copied to the '
  'opening: seniority is a property of the post, not of one intake.';

comment on column public.positions.responsibilities is
  'What the post owns, in prose. Copied into job_openings.description.';

comment on column public.positions.requirements is
  'One requirement per line. Copied into job_openings.requirements.';

comment on column public.positions.min_salary_usd is
  'Minimum salary in salary_currency. Column name matches job_openings and is '
  'retained for compatibility; it does not mean US dollars.';

comment on column public.positions.max_salary_usd is
  'Maximum salary in salary_currency. Column name matches job_openings and is '
  'retained for compatibility; it does not mean US dollars.';

comment on column public.positions.salary_currency is
  'ISO 4217 code the salary band is denominated in, resolved against the currencies list on write.';

-- One title per scope, compared case-insensitively. Two partial indexes rather
-- than one because a group-wide row has a NULL tenant and NULLs are distinct in
-- a composite unique index.
create unique index if not exists positions_global_title_uniq
  on public.positions (lower(btrim(title))) where tenant_id is null;
create unique index if not exists positions_tenant_title_uniq
  on public.positions (tenant_id, lower(btrim(title))) where tenant_id is not null;
create index if not exists idx_positions_tenant on public.positions (tenant_id);
create index if not exists idx_positions_active on public.positions (is_active, sort_order);

drop trigger if exists trg_positions_updated on public.positions;
create trigger trg_positions_updated before update on public.positions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- The opening remembers which definition it was written from.
-- ---------------------------------------------------------------------------
alter table public.job_openings
  add column if not exists position_id uuid references public.positions (id) on delete set null;

comment on column public.job_openings.position_id is
  'The position definition this opening was created from, when there was one. '
  'Set null if that position is deleted; the opening keeps the copy it inherited.';

create index if not exists idx_job_openings_position on public.job_openings (position_id);

-- ---------------------------------------------------------------------------
-- RLS — the same two rules every master-data list follows: any staff member may
-- read a live row (and staff may read retired ones), and only the platform
-- settings permission may write.
-- ---------------------------------------------------------------------------
alter table public.positions enable row level security;

drop policy if exists positions_read on public.positions;
create policy positions_read on public.positions
  for select using (is_active or is_staff());

drop policy if exists positions_write on public.positions;
create policy positions_write on public.positions
  for all using (has_permission('settings.manage_platform'))
  with check (has_permission('settings.manage_platform'));

grant select, insert, update, delete on table public.positions to authenticated;
grant select, insert, update, delete on table public.positions to service_role;
revoke all on table public.positions from anon;

-- PostgREST caches its view of the schema, so the new table and column are
-- invisible to the REST reads until the API reloads. Without this the Settings
-- console lists an empty vocabulary and the drawer offers no positions even
-- though both exist.
notify pgrst, 'reload schema';
