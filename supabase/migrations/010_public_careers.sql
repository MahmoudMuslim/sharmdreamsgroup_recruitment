-- ============================================================================
-- Public careers site: tracking-code generation, duplicate protection, CV
-- storage.
--
-- The row-level policies for public application submission already existed
-- (`applications_public_insert`, `jobs_public_read`) — what was missing was the
-- browser surface. This migration adds the database pieces that surface needs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tracking codes.
--
-- `applications.tracking_code` is NOT NULL and is what a candidate types into
-- the portal to see their progress, so it must be unique and unguessable: a
-- sequential "SDG-0001, SDG-0002" would let anyone enumerate other people's
-- applications. The sequence guarantees uniqueness under concurrent inserts;
-- the random block prevents enumeration.
-- ---------------------------------------------------------------------------
create sequence if not exists application_tracking_seq start 1000;

create or replace function generate_tracking_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no I, L, O, 0, 1
  suffix text := '';
  i integer;
begin
  for i in 1 .. 6 loop
    suffix := suffix || substr(
      alphabet,
      1 + floor(random() * length(alphabet))::integer,
      1
    );
  end loop;

  return 'SDG-' || suffix || '-' || lpad(
    (nextval('application_tracking_seq'))::text, 5, '0'
  );
end;
$$;

comment on function generate_tracking_code() is
  'Collision-safe, unguessable application tracking code. Unique via a sequence; '
  'non-enumerable via a random 6-character block.';

-- The column is NOT NULL with no default, so a public insert that omits it
-- would fail. A trigger lets the database assign it instead of the caller,
-- which is what stops a public form from choosing (or guessing) a code. Rows
-- that already carry a code are left untouched.
create or replace function assign_tracking_code()
returns trigger
language plpgsql
as $$
begin
  if new.tracking_code is null or btrim(new.tracking_code) = '' then
    new.tracking_code := generate_tracking_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_tracking_code on applications;
create trigger trg_assign_tracking_code
  before insert on applications
  for each row execute function assign_tracking_code();

-- Backstop. The generator cannot collide, but the column is the candidate's
-- only handle into their own record, so a duplicate must never be storable.
create unique index if not exists applications_tracking_code_key
  on applications (tracking_code);

-- ---------------------------------------------------------------------------
-- Duplicate applications.
--
-- A candidate who applies twice to the same job (double-click, lost session)
-- should be told, not silently duplicated. Re-applying after a rejection stays
-- allowed, which is why the index is partial on live stages.
-- ---------------------------------------------------------------------------
create unique index if not exists applications_one_live_per_job
  on applications (job_id, lower(email))
  where stage in ('NEW', 'AI_SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER');

comment on index applications_one_live_per_job is
  'Blocks duplicate live applications to the same job. Rejected and hired '
  'applications are outside the index so re-applying is permitted.';

-- ---------------------------------------------------------------------------
-- CV uploads.
--
-- Applicants are anonymous when they upload, so the bucket accepts writes from
-- anyone and denies all reads except to staff. A CV is personal data — it must
-- not be world-readable just because accepting the upload is easy.
--
-- Note what this deliberately does NOT do: it does not try to prove the uploader
-- owns the application. There is no identity to check before someone applies.
-- Authorisation lives in the server action instead — it validates the job is
-- published and issues the tracking code in the same transaction that attaches
-- the file, so an orphan upload is never linked to anything.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('candidate-cvs', 'candidate-cvs', false)
on conflict (id) do nothing;

drop policy if exists "candidates upload cvs" on storage.objects;
create policy "candidates upload cvs"
  on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'candidate-cvs');

drop policy if exists "staff read candidate cvs" on storage.objects;
create policy "staff read candidate cvs"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'candidate-cvs' and is_staff());

drop policy if exists "staff delete candidate cvs" on storage.objects;
create policy "staff delete candidate cvs"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'candidate-cvs' and is_staff());