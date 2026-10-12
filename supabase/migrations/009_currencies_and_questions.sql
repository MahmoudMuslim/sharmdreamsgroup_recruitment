-- ============================================================================
-- Currencies, salary currency on jobs, and per-question assessment limits.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Currencies as master data so recruiters pick from a controlled list.
-- ---------------------------------------------------------------------------
create table if not exists currencies (
  id uuid primary key default gen_random_uuid(),
  -- ISO 4217 code, e.g. EGP, USD, AED.
  code text not null unique,
  symbol text not null,
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_currencies_updated on currencies;
create trigger trg_currencies_updated before update on currencies
  for each row execute function set_updated_at();

insert into currencies (code, symbol, label, sort_order) values
  ('EGP', 'EGP', 'Egyptian Pound',    10),
  ('USD', '$',   'US Dollar',          20),
  ('EUR', '€',   'Euro',               30),
  ('GBP', '£',   'British Pound',      40),
  ('AED', 'AED', 'UAE Dirham',         50),
  ('SAR', 'SAR', 'Saudi Riyal',        60),
  ('QAR', 'QAR', 'Qatari Riyal',       70),
  ('KWD', 'KWD', 'Kuwaiti Dinar',      80),
  ('JOD', 'JOD', 'Jordanian Dinar',    90),
  ('MAD', 'MAD', 'Moroccan Dirham',   100),
  ('RUB', '₽',   'Russian Ruble',     110),
  ('CHF', 'CHF', 'Swiss Franc',       120),
  ('TRY', '₺',   'Turkish Lira',       130)
on conflict (code) do update set label = excluded.label, symbol = excluded.symbol;

-- ---------------------------------------------------------------------------
-- Job salaries are no longer implicitly USD.
-- ---------------------------------------------------------------------------
alter table job_openings
  add column if not exists salary_currency text not null default 'USD';

comment on column job_openings.min_salary_usd is
  'Minimum salary in salary_currency. Column name retained for compatibility.';
comment on column job_openings.salary_currency is
  'ISO 4217 code the min/max salary values are denominated in.';

-- ---------------------------------------------------------------------------
-- Per-question time limits are surfaced by the candidate runner.
-- ---------------------------------------------------------------------------
alter table assessment_questions
  add column if not exists instructions text;

comment on column assessment_questions.time_limit_minutes is
  'Optional per-question limit. Null means the attempt-level limit applies.';

-- Templates must be readable by staff for the question editor to load its
-- suite context. Candidate-facing reads go through attempt tokens, not RLS.
alter table assessment_templates enable row level security;
drop policy if exists assessment_templates_staff_read on assessment_templates;
create policy assessment_templates_staff_read on assessment_templates
  for select using (is_staff());