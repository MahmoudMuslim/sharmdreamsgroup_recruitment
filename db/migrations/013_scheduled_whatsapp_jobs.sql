-- ============================================================================
-- Timed WhatsApp dispatcher queue (master spec, section 7).
--
-- Stage-change alerts are enqueued here by the candidate pipeline actions and
-- drained by /api/cron/whatsapp (and by a best-effort immediate pass after a
-- stage move). Rows stay PENDING until sent, or until MAX_ATTEMPTS in the
-- dispatcher marks them FAILED.
-- ============================================================================

create table if not exists scheduled_whatsapp_jobs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications (id) on delete cascade,
  recipient_phone text not null,
  scheduled_for timestamptz not null default now(),
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED')),
  attempts integer not null default 0,
  error_log text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- The dispatcher only ever scans due PENDING rows, so the index covers
-- exactly that (partial index keeps SENT/FAILED history out of the tree).
create index if not exists idx_scheduled_whatsapp_jobs_due
  on scheduled_whatsapp_jobs (scheduled_for)
  where status = 'PENDING';

create index if not exists idx_scheduled_whatsapp_jobs_application
  on scheduled_whatsapp_jobs (application_id);

alter table scheduled_whatsapp_jobs enable row level security;

-- Staff can read the queue (admins); writes happen through the service role
-- inside the dispatcher, which bypasses RLS by design.
drop policy if exists whatsapp_jobs_staff_read on scheduled_whatsapp_jobs;
create policy whatsapp_jobs_staff_read on scheduled_whatsapp_jobs
  for select using (is_staff());
