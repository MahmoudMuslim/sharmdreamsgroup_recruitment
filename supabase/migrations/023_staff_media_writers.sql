-- ---------------------------------------------------------------------------
-- Staff writers for the two buckets nothing ever filled.
--
-- `resumes` and `candidate-audio` shipped with size and MIME limits and staff
-- read + delete policies, but no code path in the portal uploaded an object
-- into either. The File Manager therefore listed two empty buckets and
-- explained the gap in its own copy. Recruiters do hold files that never came
-- through the career site — a CV a candidate mailed, a voice note taken during
-- a phone screen — and those belong on the candidate record.
--
-- A stored object is only findable later if a row names it, so this adds
-- `application_attachments`: one row per uploaded object, pointing at the
-- application it is evidence for. Without it, /files could upload a file and
-- then never say whose it was, and a delete would leave a dead pointer behind.
--
-- Staff objects land under `applications/<application id>/`, the same shape the
-- career site already uses for CVs, so both buckets group by opening. The
-- `public/` prefix stays whatever anon uploads are confined to today.
-- ---------------------------------------------------------------------------

create table if not exists public.application_attachments (
  id uuid default gen_random_uuid(),
  application_id uuid not null,
  bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  bytes integer,
  uploaded_by uuid,
  created_at timestamp with time zone default now(),
  constraint application_attachments_pkey primary key (id),
  constraint application_attachments_bucket_check
    check (bucket in ('resumes', 'candidate-audio')),
  constraint application_attachments_storage_path_key unique (storage_path),
  constraint application_attachments_application_id_fkey
    foreign key (application_id) references applications (id) on delete cascade,
  constraint application_attachments_uploaded_by_fkey
    foreign key (uploaded_by) references user_profiles (id) on delete set null
);

comment on table public.application_attachments is
  'Files a recruiter attached to a candidate record after the application landed: '
  'extra CVs in resumes, voice notes in candidate-audio. One row per stored object.';

comment on column public.application_attachments.bucket is
  'Which private bucket holds the object. Only the two this table was written for; '
  'CVs and video pitches keep their own columns on their own tables.';

comment on column public.application_attachments.storage_path is
  'Exact storage key, applications/<application id>/<uuid>-<filename>. Unique, so '
  'two rows can never claim one object and a delete can find the row from the key.';

comment on column public.application_attachments.file_name is
  'The name the uploader chose, kept so the console can show it after the random '
  'storage prefix has been stripped.';

-- Postgres does not index a foreign key's child side, and every read of a
-- candidate record asks by application.
create index if not exists application_attachments_application_id_idx
  on application_attachments (application_id);

-- Table-level access: staff sessions only. Unlike the rest of the schema this
-- table is deliberately not granted to `anon` — nothing public reads it, and a
-- resume path is not something a browser should be able to enumerate.
grant select, insert, delete on table public.application_attachments to authenticated;
grant select, insert, delete on table public.application_attachments to service_role;
revoke all on table public.application_attachments from anon;

alter table if exists public.application_attachments enable row level security;

/*
 * Reads follow the same tenant wall as `applications_staff_read`: a recruiter
 * sees an attachment exactly when they can see the application it hangs off.
 * `is_staff()` alone would let any staff member read another tenant's candidate
 * files, which is looser than the record those files describe.
 */
drop policy if exists "attachments_staff_read" on public.application_attachments;
create policy "attachments_staff_read" on public.application_attachments
  for select to authenticated
  using (
    is_staff()
    and (
      is_super_admin()
      or user_tenant_id() is null
      or exists (
        select 1
        from applications ap
        join job_openings jo on jo.id = ap.job_id
        where ap.id = application_attachments.application_id
          and jo.tenant_id = user_tenant_id()
      )
    )
  );

drop policy if exists "attachments_staff_add" on public.application_attachments;
create policy "attachments_staff_add" on public.application_attachments
  for insert to authenticated
  with check (
    is_staff()
    and has_permission('candidates.write'::text)
    and exists (
      select 1
      from applications ap
      where ap.id = application_attachments.application_id
    )
  );

/*
 * Delete is a write on the candidate record, so it needs candidates.write — not
 * the platform permission the File Manager gates its storage deletes behind.
 * There is deliberately no UPDATE policy: an object's key, size and type are
 * decided when it is stored, so a wrong one is removed and uploaded again rather
 * than edited in place. Supabase's default privileges do hand the table-level
 * UPDATE right to `authenticated`, but with no policy RLS refuses the write,
 * which is what the local proof checks.
 */
drop policy if exists "attachments_staff_remove" on public.application_attachments;
create policy "attachments_staff_remove" on public.application_attachments
  for delete to authenticated
  using (
    is_staff()
    and has_permission('candidates.write'::text)
  );

-- ---------------------------------------------------------------------------
-- The storage side of the same door: staff may put an object into these two
-- buckets, under the applications/ prefix only. SELECT and DELETE for these
-- buckets already exist; INSERT is what was missing.
-- ---------------------------------------------------------------------------
drop policy if exists "staff upload candidate media" on storage.objects;

create policy "staff upload candidate media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('resumes', 'candidate-audio')
    and is_staff()
    and has_permission('candidates.write'::text)
    and (storage.foldername(name))[1] = 'applications'
  );
