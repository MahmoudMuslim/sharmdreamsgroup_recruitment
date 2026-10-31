-- ============================================================================
-- 044_application_forms.sql
--
-- One migration for the application form builder. Five tables
-- (application_forms, application_form_fields, job_application_forms,
--  application_form_files, and the applications.form_answers column),
-- one CREATE OR REPLACE of erase_candidate_data, one anon `files` insert
-- policy for candidate-photos, and one seeded PUBLISHED global form.
--
-- Requires 041_privacy.sql applied first: this file replaces a function 041
--   defines, and CREATE OR REPLACE preserves that function's owner and ACLs.
-- Requires 043_person_profile_spine.sql applied first: the candidate-photos
--   bucket and its files policies are that slice's, and a `person:` binding
--   writes into tables only 043 creates.
--
-- STATUS: APPLIED on this local database. The date this file was run is not
--   recorded here; what is recorded is the catalog re-read on 2026-10-29 — the
--   four tables (`application_forms`, `application_form_fields`,
--   `job_application_forms`, `application_form_files`), `applications.form_answers`,
--   `erase_candidate_data(uuid)` in place from the REPLACE, and the seeded
--   PUBLISHED global form as 1 row of the 8 the board now lists. The
--   candidate-photos bucket is 043's, and on this self-hosted stack it is a name in
--   `src/lib/config.ts` plus its `files` policies, not a `storage.buckets` row.
--   Applying this file takes the owner's explicit per-file approval and a
--   throwaway rehearsal with 041 and 043 pre-applied, which is the order the local
--   stack has them in.
--
-- See docs/superpowers/specs/2026-10-25-application-form-builder-design.md §1.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1.1 application_forms — the container
--
-- No company column, exactly as application_gate_questions (018) has none: the
-- write policy is has_permission('jobs.manage'), and that function takes only a
-- permission name. Forms are platform-global authoring.
-- ----------------------------------------------------------------------------

create table if not exists public.application_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  -- True: asked on every open role. False: only where it is assigned.
  is_global boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  -- Bumped by every layout save and by publish. Recorded in each snapshot.
  version integer not null default 1 check (version > 0),
  global_position integer not null default 0,
  -- Retirement, never deletion: applications still carry this form's answers.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- §1.2 application_form_fields — the whole layout, flat
--
-- There is no sections table. The step divider is the section_heading field
-- type, and this flat ordered list is the layout: a step is the heading plus
-- the fields that follow it until the next heading. Two position sequences in
-- two tables would have to agree; one cannot disagree with itself.
-- ----------------------------------------------------------------------------

create table if not exists public.application_form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.application_forms (id) on delete cascade,
  -- Generated once, never rewritten on rename. This is the snapshot's join key.
  key text not null check (char_length(key) between 3 and 60),
  -- The 21 names are the spec's §3 table, in that table's order. One list,
  -- two places; the proof asserts FIELD_TYPES names these exactly.
  type text not null check (type in (
    'short_text','long_text','email','phone','url','number','percentage','currency',
    'date','time','datetime','duration','select','radio','multi_select','checkbox',
    'file','photo','address','geolocation','section_heading')),
  label text not null check (char_length(btrim(label)) between 1 and 200),
  help_text text,
  placeholder text,
  required boolean not null default false,
  -- Per-type settings: options, min/max, accept kinds, address components.
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  -- The canonical destination this field writes. Null for ordinary fields.
  -- The seven bare keys are columns on applications. A `person:<key>` binding
  -- is the spine's registry key and lands in a person table through its
  -- writer, never through this table.
  system_key text check (
    system_key in ('name','email','phone','about','cv','photo','linkedin')
    or system_key ~ '^person:[a-z][a-z0-9_]{2,59}$'),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Half of decision 3: the database guarantees a key is unique inside a form.
  -- Uniqueness across a resolved layout spans rows of several forms and cannot
  -- be a constraint; resolveLayout's violations own that half.
  unique (form_id, key)
);
create index if not exists idx_form_fields_form on public.application_form_fields (form_id, position);
create index if not exists idx_form_fields_system on public.application_form_fields (system_key)
  where system_key is not null;

-- ----------------------------------------------------------------------------
-- §1.3 job_application_forms — the assignment
--
-- form_id is checked non-global by the action, not by the database: a global
-- form is asked everywhere by definition, so assigning it to one role would
-- silently mean "only this role", the opposite of the flag. The pair being the
-- primary key makes a double-assign impossible.
-- ----------------------------------------------------------------------------

create table if not exists public.job_application_forms (
  job_id uuid not null references public.job_openings (id) on delete cascade,
  form_id uuid not null references public.application_forms (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (job_id, form_id)
);

-- ----------------------------------------------------------------------------
-- §1.4 application_form_files — the byte ledger erasure reads
--
-- Every file or photo field writes a row here and nothing else. No storage key
-- ever goes into a jsonb. Three readers name it where they live: collectPaths
-- on erasure, the File Manager's owner lookup and row-unlinking, and the
-- retention pass that clears rows nobody claimed.
-- ----------------------------------------------------------------------------

create table if not exists public.application_form_files (
  id uuid primary key default gen_random_uuid(),
  -- Null between the upload and the submit. The retention sweep clears these.
  application_id uuid references public.applications (id) on delete cascade,
  job_id uuid not null references public.job_openings (id) on delete cascade,
  field_key text not null,
  bucket text not null,
  storage_path text not null,
  mime text,
  bytes integer check (bytes is null or bytes >= 0),
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_form_files_application on public.application_form_files (application_id);
create index if not exists idx_form_files_orphans on public.application_form_files (uploaded_at)
  where application_id is null;

-- ----------------------------------------------------------------------------
-- §1.5 applications.form_answers — the snapshot
--
-- An object, not a bare array, because the snapshot has to name the forms and
-- their versions alongside the answers — that is what makes "edits go live"
-- safe. File fields contribute a filename; the bytes stay in §1.4.
-- ----------------------------------------------------------------------------

alter table public.applications
  add column if not exists form_answers jsonb;

comment on column public.applications.form_answers is
  'What the candidate actually answered, as the form asked it: {fields:[{key,label,
  type,value,systemKey}], forms:[{id,name,version}], resolvedAt}. Written once at
  submit and never rewritten, so an application renders the questions it was filed
  against even after the form is edited, retired, or deleted.';

-- ----------------------------------------------------------------------------
-- §1.6 RLS — the shape 018 uses, because the same two callers exist: an
-- anonymous applicant who must read the layout, and a recruiter with
-- jobs.manage. The public read the code actually takes is service-role plus
-- the route's projection; these policies are what a stolen anon key would see.
-- ----------------------------------------------------------------------------

alter table public.application_forms enable row level security;

drop policy if exists application_forms_public_read on public.application_forms;
create policy application_forms_public_read on public.application_forms
  for select using (is_staff() or (status = 'PUBLISHED' and archived_at is null));

drop policy if exists application_forms_manager_write on public.application_forms;
create policy application_forms_manager_write on public.application_forms
  for all
  using (is_staff() and has_permission('jobs.manage'))
  with check (is_staff() and has_permission('jobs.manage'));

alter table public.application_form_fields enable row level security;

-- Visibility lives on the parent, so the anon read is an existence check
-- rather than a row flag: deactivating a form must not deactivate its fields'
-- rows one by one.
drop policy if exists application_form_fields_public_read on public.application_form_fields;
create policy application_form_fields_public_read on public.application_form_fields
  for select using (
    is_staff()
    or exists (
      select 1 from public.application_forms f
       where f.id = form_id
         and f.status = 'PUBLISHED'
         and f.archived_at is null
    )
  );

drop policy if exists application_form_fields_manager_write on public.application_form_fields;
create policy application_form_fields_manager_write on public.application_form_fields
  for all
  using (is_staff() and has_permission('jobs.manage'))
  with check (is_staff() and has_permission('jobs.manage'));

alter table public.job_application_forms enable row level security;

-- A stranger has no reason to read assignments; this policy is defence in
-- depth, not the access path.
drop policy if exists job_application_forms_public_read on public.job_application_forms;
create policy job_application_forms_public_read on public.job_application_forms
  for select using (
    is_staff()
    or exists (
      select 1 from public.application_forms f
       where f.id = form_id
         and f.status = 'PUBLISHED'
         and f.archived_at is null
    )
  );

drop policy if exists job_application_forms_manager_write on public.job_application_forms;
create policy job_application_forms_manager_write on public.job_application_forms
  for all
  using (is_staff() and has_permission('jobs.manage'))
  with check (is_staff() and has_permission('jobs.manage'));

alter table public.application_form_files enable row level security;

-- Bytes and paths are never anonymous-readable. The erasure engine reaches
-- this table with the service role, exactly as it already reaches
-- application_attachments.
drop policy if exists application_form_files_staff_read on public.application_form_files;
create policy application_form_files_staff_read on public.application_form_files
  for select using (is_staff());

-- No insert or update policy: the upload route and the submit action write
-- this table with the service role. A delete is the File Manager's unlink,
-- which runs on the staff session.
drop policy if exists application_form_files_manager_delete on public.application_form_files;
create policy application_form_files_manager_delete on public.application_form_files
  for delete to authenticated
  using (is_staff() and has_permission('jobs.manage'));

-- ----------------------------------------------------------------------------
-- §4 The anon `files` insert policy for candidate-photos.
--
-- One of the three things 044 adds to the spine's bucket; the other two live in
-- the TypeScript layer (ownersFor and unlinkReference). 043's staff policy
-- enforces the persons/ prefix. This one enforces applications/, which is what
-- the public form writes and what the orphan pass can find. One bucket, two
-- prefixes, two honest clauses.
-- ----------------------------------------------------------------------------

drop policy if exists "candidates upload photos" on public.files;
create policy "candidates upload photos" on public.files
  for insert to anon
  with check (
    bucket = 'candidate-photos'
    and split_part(path, '/', 1) = 'applications'
  );

-- ----------------------------------------------------------------------------
-- §8 Erasure reaches the form's answers and its bytes' ledger.
--
-- CREATE OR REPLACE keeps 041's owner and ACLs, so its revokes still hold; no
-- new revoke is issued here. The function does NOT null applications.person_id
-- and touches no person_* table: erasing an application is not erasing a human.
-- The spine decides whether the profile goes when the last live application
-- linked to it is erased.
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

  -- The form's byte ledger. The caller has already removed the objects; the
  -- rows that named them go with the record.
  delete from public.application_form_files
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
         form_answers = null,
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

-- ----------------------------------------------------------------------------
-- §1.7 Seed — "Personal details", the first published global form.
--
-- One do block so the migration is re-runnable: the check is name + is_global,
-- and the fields are inserted only when the container was. Version 1,
-- global_position 0.
--
-- cv and about are both present and neither is individually required: the
-- submit path keeps today's rule (`actions.ts:396`), "attach a CV or paste its
-- text", so a candidate who does one of the two is complete. A layout that
-- offers only one of them must mark that one required; identityIssues owns
-- that rule, not this seed.
-- ----------------------------------------------------------------------------

do $$
declare
  v_form_id uuid;
begin
  if not exists (
    select 1 from public.application_forms
     where name = 'Personal details'
       and is_global
  ) then
    insert into public.application_forms
      (name, description, is_global, status, version, global_position)
    values
      ('Personal details',
       'The identity fields every application must collect.',
       true, 'PUBLISHED', 1, 0)
    returning id into v_form_id;

    insert into public.application_form_fields
      (form_id, key, type, label, help_text, required, config, system_key, position)
    values
      (v_form_id, 'personal_details_heading', 'section_heading',
       'Personal details', 'Tell us who you are and how to reach you.',
       false, '{}'::jsonb, null, 0),
      (v_form_id, 'applicant_name', 'short_text',
       'Full name', null, true, '{}'::jsonb, 'name', 1),
      (v_form_id, 'applicant_email', 'email',
       'Email', null, true, '{}'::jsonb, 'email', 2),
      (v_form_id, 'applicant_phone', 'phone',
       'Phone', null, false, '{}'::jsonb, 'phone', 3),
      (v_form_id, 'applicant_cv', 'file',
       'CV', 'PDF or Word document.', false,
       '{"kinds":["pdf","doc"]}'::jsonb, 'cv', 4),
      (v_form_id, 'applicant_about', 'long_text',
       'About you', 'Paste your CV text or tell us about your experience.',
       false, '{}'::jsonb, 'about', 5),
      (v_form_id, 'applicant_linkedin', 'url',
       'LinkedIn', null, false, '{}'::jsonb, 'linkedin', 6);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants. service_role is the submit path's door and the erasure engine's;
-- authenticated is the authoring console and the File Manager; anon reads
-- only what the read policies publish.
-- ----------------------------------------------------------------------------

grant select on table
  public.application_forms,
  public.application_form_fields,
  public.job_application_forms,
  public.application_form_files
  to authenticated;
grant insert, update, delete on table
  public.application_forms,
  public.application_form_fields,
  public.job_application_forms
  to authenticated;
grant delete on table public.application_form_files to authenticated;

grant all on table
  public.application_forms,
  public.application_form_fields,
  public.job_application_forms,
  public.application_form_files
  to service_role;

revoke all on table
  public.application_forms,
  public.application_form_fields,
  public.job_application_forms,
  public.application_form_files
  from anon;

-- The read policies are the boundary a stolen anon key meets; without a grant
-- there would be no boundary to meet. application_form_files is omitted on
-- purpose: paths and bytes are never anonymous-readable.
grant select on table
  public.application_forms,
  public.application_form_fields,
  public.job_application_forms
  to anon;

-- PostgREST caches its view of the schema, so a REST read of the new tables is
-- refused as an unknown resource until the API reloads.
notify pgrst, 'reload schema';
-- Next file: 045.
