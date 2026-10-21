-- ============================================================================
-- Assessment integrity: event log, question randomisation, per-question timing
-- ============================================================================

alter table assessment_templates
  add column if not exists randomize_questions boolean not null default false,
  add column if not exists randomize_options boolean not null default false,
  add column if not exists block_copy_paste boolean not null default true;

alter table assessment_questions
  add column if not exists time_limit_minutes integer,
  add column if not exists shuffle_options boolean not null default false;

do $$
begin
  create type integrity_event_type as enum (
    'FOCUS_LOST',
    'TAB_HIDDEN',
    'PASTE_BLOCKED',
    'PASTE_DETECTED',
    'COPY_DETECTED',
    'FULLSCREEN_EXIT',
    'MULTI_DEVICE',
    'AI_PASTE_SUSPECTED'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type integrity_severity as enum ('INFO', 'WARN', 'CRITICAL');
exception when duplicate_object then null; end $$;

create table if not exists integrity_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references candidate_attempts (id) on delete cascade,
  question_id uuid references assessment_questions (id) on delete set null,
  event_type integrity_event_type not null,
  severity integrity_severity not null default 'INFO',
  -- Short, non-sensitive detail. Never stores full pasted content or keystrokes.
  detail text,
  session_fingerprint text,
  device_label text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_integrity_events_attempt
  on integrity_events (attempt_id, occurred_at);

alter table integrity_events enable row level security;

-- Candidates never read the log directly; the server aggregates it for staff.
drop policy if exists integrity_events_staff_read on integrity_events;
create policy integrity_events_staff_read on integrity_events
  for select using (is_staff());

-- Attempts gain a rolled-up integrity score so recruiters can sort/filter.
alter table candidate_attempts
  add column if not exists integrity_score integer,
  add column if not exists integrity_flags integer not null default 0,
  add column if not exists question_order uuid[],
  add column if not exists option_order jsonb;

create or replace function integrity_severity_weight(kind text)
returns integer language sql immutable as $$
  select case kind
    when 'CRITICAL' then 10
    when 'WARN' then 4
    else 1
  end;
$$;

-- Recomputes the rolled-up integrity score for one attempt.
create or replace function refresh_attempt_integrity(target_attempt uuid)
returns void language sql security definer set search_path = public as $$
  update candidate_attempts a
  set integrity_flags = coalesce(t.flags, 0),
      integrity_score = greatest(0, 100 - coalesce(t.penalty, 0))
  from (
    select
      count(*)::int as flags,
      coalesce(sum(case e.severity
        when 'CRITICAL' then 10
        when 'WARN' then 4
        else 1 end), 0)::int as penalty
    from integrity_events e
    where e.attempt_id = target_attempt
  ) t
  where a.id = target_attempt;
$$;