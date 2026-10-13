-- ============================================================================
-- LinkedIn sourcing pool.
--
-- Recruiters find people on LinkedIn themselves — there is no LinkedIn API for
-- searching other members — and load the profiles they collected here by
-- pasting URLs or importing a CSV. The pool is deliberately a separate table
-- from `applications`: a prospect has not applied, has no tracking code and
-- must never appear on the candidate pipeline until a recruiter converts them.
--
-- `application_id` is set at conversion time so the prospect record keeps a
-- pointer to the application it became, and the two stay traceable to each
-- other in both directions.
-- ============================================================================

create table if not exists sourced_prospects (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 160),
  headline text,
  company text,
  location text,
  email text,
  phone text,
  linkedin_url text,
  notes text,
  -- How the row got here, so an imported list stays distinguishable from a
  -- profile someone typed in by hand.
  origin text not null default 'LINKEDIN'
    check (origin in ('LINKEDIN', 'CSV', 'MANUAL')),
  -- Sourcing stages are their own ladder: the pipeline stages in
  -- `application_stage` describe people who applied, which is not this.
  stage text not null default 'NEW'
    check (stage in ('NEW', 'CONTACTED', 'REPLIED', 'INTERVIEW', 'CONVERTED', 'PASSED')),
  job_id uuid references job_openings (id) on delete set null,
  application_id uuid references applications (id) on delete set null,
  created_by uuid references user_profiles (id) on delete set null,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A LinkedIn profile URL identifies a person, so importing the same list twice
-- must not double the pool. Email is not unique: sourcing tools export
-- placeholders like "linkedin" where the address is behind a connection.
create unique index if not exists sourced_prospects_linkedin_key
  on sourced_prospects (lower(trim(linkedin_url)))
  where linkedin_url is not null and btrim(linkedin_url) <> '';

create index if not exists idx_sourced_prospects_stage on sourced_prospects (stage, created_at desc);
create index if not exists idx_sourced_prospects_job on sourced_prospects (job_id);

drop trigger if exists trg_sourced_prospects_updated on sourced_prospects;
create trigger trg_sourced_prospects_updated before update on sourced_prospects
  for each row execute function set_updated_at();

alter table sourced_prospects enable row level security;

drop policy if exists prospects_staff_read on sourced_prospects;
create policy prospects_staff_read on sourced_prospects
  for select using (is_staff());

drop policy if exists prospects_staff_write on sourced_prospects;
create policy prospects_staff_write on sourced_prospects
  for all using (has_permission('candidates.write'))
  with check (has_permission('candidates.write'));

comment on table sourced_prospects is
  'People a recruiter found off-pipeline (LinkedIn, an event, a referral) and '
  'loaded here to work on. Not applications: no tracking code, no candidate '
  'portal access until they are converted.';

-- ---------------------------------------------------------------------------
-- Outreach history.
--
-- `communication_logs` is already the single answer to "what have we told this
-- person, on which channel". `application_id` cannot carry a prospect, so the
-- table gains a second, nullable owner column rather than a parallel log table
-- the outbox would have to union.
-- ---------------------------------------------------------------------------

alter table communication_logs
  add column if not exists prospect_id uuid references sourced_prospects (id) on delete cascade;

create index if not exists idx_communication_logs_prospect
  on communication_logs (prospect_id, created_at desc)
  where prospect_id is not null;

-- ---------------------------------------------------------------------------
-- First-touch copy, editable in Settings → Access & comms → Templates.
-- ---------------------------------------------------------------------------

insert into notification_templates (key, channel, subject, body) values
  ('prospect_outreach_email', 'EMAIL',
   'A role at {{company_name}} — {{job_title}}',
   'Hello {{candidate_name}},

I came across your profile and your background looks like a strong match for {{job_title}} at {{company_name}}.

We are hiring for this role now. If you would like to hear more, reply to this email and I will send the details.

Best regards,
{{company_name}} Talent Team'),

  ('prospect_outreach_whatsapp', 'WHATSAPP', null,
   'Hi {{candidate_name}}, this is {{company_name}}. Your profile looked like a strong match for {{job_title}} — are you open to hearing more?')
on conflict (key, channel) do nothing;
