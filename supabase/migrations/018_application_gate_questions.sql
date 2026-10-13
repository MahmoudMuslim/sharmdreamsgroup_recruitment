-- ============================================================================
-- Viability gate questions.
--
-- Recruiters want a few blunt questions on the public "Apply for this role"
-- form before they spend an AI call and their own time on a CV: work
-- eligibility, shift acceptance, a licence, minimum experience. These carry no
-- points at all — they are not a test, they are a yes/no filter the candidate
-- answers about themselves — so they live in their own table rather than in
-- `assessment_questions`, whose rows are scored, belong to a suite, and are
-- only ever shown after a recruiter sends an assessment link.
--
-- A failing answer rejects the application at submission time, which is why
-- `applications` gains a column to hold what was actually answered: a
-- rejection a recruiter cannot explain is not reviewable.
-- ============================================================================

create table if not exists application_gate_questions (
  id uuid primary key default gen_random_uuid(),
  -- Null means the question is asked for every published role; a job id scopes
  -- it to that one opening.
  job_id uuid references job_openings (id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 3 and 400),
  help_text text check (help_text is null or char_length(btrim(help_text)) <= 400),
  -- [{"label": "Yes", "passes": true}, {"label": "No", "passes": false}]
  -- `passes` is whether that answer keeps the application in the running.
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  position integer not null default 0,
  -- Turning a question off must not delete it: applications already carry its
  -- answer text, and a recruiter needs to see what was asked.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gate_questions_scope
  on application_gate_questions (job_id, position);
create index if not exists idx_gate_questions_active
  on application_gate_questions (is_active);

drop trigger if exists trg_gate_questions_updated on application_gate_questions;
create trigger trg_gate_questions_updated before update on application_gate_questions
  for each row execute function set_updated_at();

alter table application_gate_questions enable row level security;

-- The careers form is public, so an anonymous visitor must be able to read the
-- questions that are switched on — and nothing else. Inactive rows, and every
-- row's `passes` flags, stay out of reach: the server scores the answers.
drop policy if exists gate_questions_public_read on application_gate_questions;
create policy gate_questions_public_read on application_gate_questions
  for select using (is_staff() or is_active);

drop policy if exists gate_questions_manager_write on application_gate_questions;
create policy gate_questions_manager_write on application_gate_questions
  for all
  using (has_permission('jobs.manage'))
  with check (has_permission('jobs.manage'));

comment on table application_gate_questions is
  'No-points viability questions shown on the public application form. An answer '
  'marked as not passing rejects the application at submission time.';

-- ---------------------------------------------------------------------------
-- What the candidate actually answered, kept on the application.
-- ---------------------------------------------------------------------------
alter table applications
  add column if not exists gate_answers jsonb;

comment on column applications.gate_answers is
  '[{question, answer, passed}] as answered on the careers form. Stored even when '
  'every answer passed, so a later rejection can be read in context.';
