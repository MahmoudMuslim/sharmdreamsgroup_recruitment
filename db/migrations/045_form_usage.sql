-- ============================================================================
-- 045_form_usage.sql
--
-- One read-only view: how many applications each form has actually been asked
-- on, counted from the snapshots those applications filed.
--
-- Requires 044_application_forms.sql applied first: it creates
--   application_forms and the applications.form_answers column this view reads.
--
-- STATUS: APPLIED to the local database on 2026-10-28, under the owner naming
--   this file, and the after-state was measured rather than assumed: eight rows
--   (one per form — three carry 2, 1 and 1, five read 0), a sum of 4 applications
--   counted, form_id uuid / applications bigint / latest_at timestamptz, the view
--   not updatable, security_invoker=true in pg_class.reloptions, select granted to
--   authenticated and service_role with no grant to anon, and the comment in
--   place. The security_invoker claim was driven, not read: rehearsed first inside
--   begin … rollback, which left nothing behind, and then over the gateway with
--   minted tokens — the super admin gets the 8 rows and the sum of 4, a recruiter
--   whose tenant filed none of them gets the same 8 form rows with every figure 0,
--   a candidate gets only the 4 published forms and no figure above 0, and anon is
--   refused 42501 permission denied, which is the revoke honoured and the proof
--   PostgREST reloaded its schema cache. So every figure is the reader's own, not
--   the database's, and the /forms board now reports basis "view". The bounded
--   fallback in `src/modules/form-builder/application/formActions.ts` is kept for a
--   database where this file has never run: it counts the newest 500 applications
--   and calls a figure at that bound a floor, not a total.
--
-- Why a view and not a column: usage is a count of what was filed, and the
-- snapshot is written once and never rewritten. A stored counter would have to
-- be maintained by every submit path and could disagree with the snapshots it
-- claims to summarise.
--
-- See docs/superpowers/specs/2026-10-25-application-form-builder-design.md §6.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- form_usage — one row per form, with the applications that named it
--
-- The snapshot's forms array records the id, name and version of every form
-- that contributed a question, so a form is used exactly when an application's
-- snapshot names it. That is a use, not a plan: job_application_forms says
-- which openings a form is assigned to, and a form may be assigned everywhere
-- and filed against nowhere.
--
-- `security_invoker = true` is load-bearing. The view must count only the
-- applications the calling staff member may already read, so RLS on
-- applications stays in force; without it the view would run as its owner and
-- hand every caller the whole database's figures.
--
-- The left join keeps a form with no application in the result at 0, so a
-- missing key and a zero mean the same thing to the reader.
-- ----------------------------------------------------------------------------

create or replace view public.form_usage
with (security_invoker = true)
as
select
  f.id as form_id,
  count(distinct a.id)::bigint as applications,
  max(a.created_at) as latest_at
from public.application_forms f
left join public.applications a
  on a.form_answers is not null
 and exists (
   select 1
   from jsonb_array_elements(a.form_answers -> 'forms') as entry
   where entry ->> 'id' = f.id::text
 )
group by f.id;

comment on view public.form_usage is
  'One row per application form: how many applications filed a snapshot naming it, '
  'and the newest such application. Counts what was asked, never what a form is '
  'assigned to. security_invoker keeps the caller''s RLS on applications in force.';

grant select on table public.form_usage to authenticated;
grant select on table public.form_usage to service_role;
revoke all on table public.form_usage from anon;

-- The REST client discovers a new view only after PostgREST reloads its schema
-- cache; without this the first read after applying would report the view absent.
notify pgrst, 'reload schema';
