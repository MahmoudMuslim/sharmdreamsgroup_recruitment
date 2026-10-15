-- ---------------------------------------------------------------------------
-- Who changed what, when — including the changes no human made.
--
-- The portal already keeps two partial ledgers. `settings_audit_log` records
-- configuration and team changes but has one column for the actor, and several
-- of its writers leave it null, so a settings change cannot be traced to the
-- person who saved it. `credential_audit_log` records provider secret rotation
-- and nothing else. Neither knows the difference between a recruiter moving a
-- candidate and the screening engine moving that candidate because its AI
-- threshold was crossed — which is the question an audit trail exists to answer.
--
-- This is the one ledger for every write in the portal: hiring records, jobs,
-- assessments, interviews, onboarding, sourcing, files, messages, configuration
-- and team access. It is deliberately not a Postgres trigger. A trigger can say
-- which row moved and which JWT moved it, but it cannot say *why*: the screening
-- engine, the grader, the WhatsApp dispatcher and the assistant all write with
-- the service role, so `auth.uid()` is null for every one of them and a human
-- click is indistinguishable from a cron sweep. The actor columns here are
-- stamped by the code that made the change, which is the only place that knows
-- whether it was a person, a model, a candidate or a scheduler.
--
-- `actor_kind` separates the four callers; `actor_id` names the human account
-- responsible for the change (null for a scheduler run, the AI's own row when
-- no person asked for it). A change the assistant made on a recruiter's
-- instruction records the AI as the kind and the recruiter as the actor —
-- "the model did it, at this person's request" is the honest reading, and both
-- halves are filterable.
--
-- `summary` is the sentence a human reads in the console, so it is written by
-- the code that knows what happened rather than derived from a row image.
-- `detail` carries the before/after fields that were actually touched, and it is
-- built by the writer, not by the database: secrets, CV text and message bodies
-- never enter it. A trail that hoards every column value is a second copy of
-- the sensitive data it is supposed to police.
--
-- Deletes are kept as rows, not cascaded away: `entity_id` is plain text with no
-- foreign key precisely so that archiving or removing a record leaves its change
-- history standing. `company_id` does cascade to null, because a dissolved
-- company should not keep a trail that points at it.
--
-- Reads are gated by the same permission that already guards the settings
-- ledger, so the platform's configuration owners see the whole trail. Writes go
-- through the service-role client, which is why there is no INSERT policy: a
-- caller with an authenticated session cannot forge a trail row through the
-- Data API.
-- ---------------------------------------------------------------------------

create table if not exists public.activity_log (
  id uuid default gen_random_uuid(),
  company_id uuid,
  actor_id uuid,
  actor_kind text not null,
  actor_label text not null,
  via text not null,
  area text not null,
  action text not null,
  entity text not null,
  entity_id text,
  summary text not null,
  detail jsonb,
  created_at timestamp with time zone default now() not null,
  constraint activity_log_pkey primary key (id),
  constraint activity_log_actor_kind_check
    check (actor_kind = any (array['STAFF', 'AI', 'CANDIDATE', 'SYSTEM'])),
  constraint activity_log_actor_label_check check (char_length(actor_label) <= 160),
  constraint activity_log_summary_check check (char_length(summary) between 1 and 400),
  constraint activity_log_entity_id_check check (char_length(entity_id) <= 64),
  constraint activity_log_company_id_fkey
    foreign key (company_id) references tenants_and_companies (id) on delete set null,
  constraint activity_log_actor_id_fkey
    foreign key (actor_id) references user_profiles (id) on delete set null
);

-- The console reads newest-first, by area, by actor and by the record it is
-- attached to; a candidate dossier asks the last of these with no other filter.
create index if not exists idx_activity_created on public.activity_log using btree (created_at desc);
create index if not exists idx_activity_area_created on public.activity_log using btree (area, created_at desc);
create index if not exists idx_activity_actor_created on public.activity_log using btree (actor_id, created_at desc);
create index if not exists idx_activity_kind_created on public.activity_log using btree (actor_kind, created_at desc);
create index if not exists idx_activity_entity on public.activity_log using btree (entity, entity_id, created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists "activity_staff_read" on public.activity_log;
create policy "activity_staff_read" on public.activity_log
  for SELECT
  to public
  using (has_permission('settings.manage_platform'::text));

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.activity_log to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.activity_log to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.activity_log to postgres;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.activity_log to service_role;
