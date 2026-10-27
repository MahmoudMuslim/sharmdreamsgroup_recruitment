-- ============================================================================
-- 045_form_usage.sql
--
-- One read-only view: how many applications each form has actually been asked
-- on, counted from the snapshots those applications filed.
--
-- Requires 044_application_forms.sql applied first: it creates
--   application_forms and the applications.form_answers column this view reads.
--
-- STATUS: authored here, NOT applied. The /forms board already answers this
--   question without the view, by counting the newest 500 applications and
--   saying so. Applying this file is the owner's call; until then the board
--   reports that bounded read as its basis and calls a figure at the bound a
--   floor, not a total. Rehearse it on a throwaway database before it lands.
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
