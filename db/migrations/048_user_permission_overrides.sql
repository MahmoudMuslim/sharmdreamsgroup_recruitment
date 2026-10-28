-- ============================================================================
-- 048_user_permission_overrides.sql
--
-- One line per person and permission: what the role grants, this changes for
-- one account.
--
-- STATUS: authored here, NOT applied. Until it is applied the grant resolver
--   finds no table, reads the role's grants alone and reports `applied: false`;
--   the Team console says so in the member panel, naming this file. No account
--   is quietly wider or narrower than its role while the file waits.
--
-- REHEARSED, not against a scratch schema but against a clone of the live
--   applied one (pg_dump --schema-only, then the four real profiles and the real
--   permission catalogue), so the fences below were tested by the same rows the
--   portal will write: a manager's own colleague row was accepted, a self row and
--   both directions of a Super Admin row were refused by RLS, an invented
--   permission key was refused by the foreign key, a 241-character note by the
--   check, and a row with no decision by the not-null; the writer's update
--   restamped `updated_at` and its delete cleared the override; a recruiter
--   without `settings.manage_roles` was refused the write and allowed the read, a
--   candidate saw no rows and could not write, and anon was refused at the grant
--   before it ever reached a policy. The throwaway database was dropped.
--
-- Why a portal needs this at all: `role_permissions` is global — one row for
--   `RECRUITER` answers for every recruiter — so a company that wants one
--   recruiter to read the outbox and not the payroll-shaped reports has to
--   invent a role for that one person, and then the second such person invents
--   a third. A row here says "this permission, this person, this way" and
--   leaves the role meaning what it means for everyone else.
--
-- Why a row per permission and not a jsonb column on `user_profiles`: the key
--   is a foreign key into `permissions`, so a permission that is renamed or
--   never existed is refused here at the door rather than arriving as a JSON
--   field nobody notices is stale. It is also what the change trail can name —
--   a row, a key, a before and an after — which a merged blob cannot show.
--
-- Why `granted` has no default: an override is a decision, and a row that did
--   not record which way it decided is a maybe the resolver cannot enforce. A
--   false here takes away what the role grants; a true gives what it does not.
--   Anything else is the absence of a row.
--
-- SECURITY: three fences, and each answers a different question.
--   1. `settings.manage_roles` — the same helper the role matrix's own write
--      policy uses (001), so nobody can reach one person's permissions who
--      could not already rewrite the role's for everyone.
--   2. Not your own row. The matrix has no equivalent fence, because changing a
--      role's grants changes your own too and the portal accepts that as the
--      nature of the job; a per-account override is narrower, more plausibly
--      deniable, and looks like nothing happened to anyone else. So an account
--      with `settings.manage_roles` may widen a colleague but not itself.
--   3. Not a Super Admin's row. The matrix locks that row in the UI because the
--      seed grants it everything and the label "Unrestricted access" is a
--      promise; `granted = false` against it would take the promise away one
--      permission at a time, and `true` would be decoration. Both are refused.
--
--   The fences are policies, not a form. A raw REST write is refused by the
--   same three tests, because RLS is the only gate here — which is why the
--   target's role is looked up through a security-definer helper instead of
--   being trusted from the payload, and why the writer's own profile id comes
--   from 020's `current_user_profile_id()` rather than from the request body.
--
-- Not tenant-scoped, on purpose: the role matrix is not tenant-scoped either,
--   and an override can never be broader than a grant its holder may already
--   rewrite for a whole role. Scoping one and not the other would make the
--   narrower door the odd one out.
--
-- The read side is `callerGrants()` in src/modules/settings/infrastructure/
--   permissions.ts: it merges a role's grants with the rows this file makes
--   possible, and while the table is absent it says so rather than pretending an
--   empty override set is a decided one.
-- ============================================================================

create table if not exists public.user_permission_overrides (
  profile_id uuid not null references public.user_profiles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  granted boolean not null,
  note text check (note is null or char_length(note) <= 240),
  updated_by uuid references public.user_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, permission_key)
);

comment on table public.user_permission_overrides is
  'Per-account permission overrides. The role grants the floor; a row here adds '
  'or takes one named permission for one person, and the resolver merges the two.';

comment on column public.user_permission_overrides.granted is
  'The decision, with no default: true gives what the role withholds, false takes '
  'what it grants. The absence of a row is the role standing as seeded.';

comment on column public.user_permission_overrides.permission_key is
  'A key from the permissions catalogue. The foreign key is what makes a renamed '
  'or invented permission fail at the door rather than sit unread in a field.';

comment on column public.user_permission_overrides.note is
  'Why, in the person''s words, up to 240 characters. Optional, capped, and cut '
  'to the same ceiling the change trail gives a detail value — a reason that '
  'needs a paragraph is a conversation, not a grant.';

comment on column public.user_permission_overrides.updated_by is
  'Which member last moved this line, or null when a departed member did. Set to '
  'null rather than cascading: a grant that outlives the person who wrote it is '
  'still a grant somebody is relying on, and the row must not vanish with them.';

comment on column public.user_permission_overrides.updated_at is
  'When the decision last moved. Written explicitly by the upsert and restamped '
  'by set_updated_at() on update, so the column is never decorative.';

-- The Super Admin lock, kept in the database so a raw write cannot step around
-- the console that already refuses it. A security-definer function reads
-- `user_profiles` for one answer and returns one boolean, which is the shape
-- this schema already uses for policy helpers (001's has_permission(), 020's
-- current_user_profile_id()).
create or replace function profile_is_super_admin(profile uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from user_profiles
    where id = profile and role::text = 'SUPER_ADMIN'
  );
$$;

revoke all on function public.profile_is_super_admin(uuid) from public;
grant execute on function public.profile_is_super_admin(uuid) to authenticated, service_role;

drop trigger if exists trg_user_permission_overrides_updated on public.user_permission_overrides;
CREATE TRIGGER trg_user_permission_overrides_updated BEFORE UPDATE ON public.user_permission_overrides FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table public.user_permission_overrides enable row level security;

-- Readable by any staff member, exactly like the role matrix: the Team console
-- shows an account what its own permissions cost it, and a manager comparing
-- two members needs to see both rows. Not readable by anon — an outsider
-- learning which recruiter can export payroll is learning about people.
drop policy if exists user_permission_overrides_staff_read on public.user_permission_overrides;
create policy user_permission_overrides_staff_read on public.user_permission_overrides
  for select to authenticated
  using (is_staff());

drop policy if exists user_permission_overrides_write on public.user_permission_overrides;
create policy user_permission_overrides_write on public.user_permission_overrides
  for insert to authenticated
  with check (
    has_permission('settings.manage_roles')
    and profile_id <> (select current_user_profile_id())
    and not profile_is_super_admin(profile_id)
  );

-- `using` carries the same three tests as `with check`, so an account cannot
-- find a colleague's row by editing it either: the row is not in its view until
-- the gate, the self fence and the Super Admin fence all pass.
drop policy if exists user_permission_overrides_update on public.user_permission_overrides;
create policy user_permission_overrides_update on public.user_permission_overrides
  for update to authenticated
  using (
    has_permission('settings.manage_roles')
    and profile_id <> (select current_user_profile_id())
    and not profile_is_super_admin(profile_id)
  )
  with check (
    has_permission('settings.manage_roles')
    and profile_id <> (select current_user_profile_id())
    and not profile_is_super_admin(profile_id)
  );

-- Deleting is how an override is cleared — back to whatever the role says — so
-- unlike 046's autonomy table this one has a delete policy, under the same
-- three fences.
drop policy if exists user_permission_overrides_delete on public.user_permission_overrides;
create policy user_permission_overrides_delete on public.user_permission_overrides
  for delete to authenticated
  using (
    has_permission('settings.manage_roles')
    and profile_id <> (select current_user_profile_id())
    and not profile_is_super_admin(profile_id)
  );

grant select, insert, update, delete on table public.user_permission_overrides to authenticated;
grant all on table public.user_permission_overrides to service_role;
revoke all on table public.user_permission_overrides from anon;

-- PostgREST caches its view of the schema, so a REST read of the new table is
-- refused as an unknown resource until the API reloads.
notify pgrst, 'reload schema';
-- Next file: 049.
