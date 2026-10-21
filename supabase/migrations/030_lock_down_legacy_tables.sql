-- 030_lock_down_legacy_tables.sql
-- `jobs` and `applicants` are the original tables from migration 001; the portal
-- has read `job_openings` and the application/`user_profiles` chain for a long
-- time now. Both were left with `using (true)` policies and full grants to anon,
-- so an unauthenticated request could read and write them through the REST API.
-- Nothing in src/ touches either name. Lock them to service_role rather than
-- dropping them: a drop is irreversible and the rows may still be interesting.

drop policy if exists "Allow authenticated insert applicants" on public.applicants;
drop policy if exists "Allow authenticated update applicants" on public.applicants;
drop policy if exists "Allow public read applicants" on public.applicants;
drop policy if exists "Allow authenticated insert jobs" on public.jobs;
drop policy if exists "Allow authenticated update jobs" on public.jobs;
drop policy if exists "Allow public read jobs" on public.jobs;

revoke all on table public.applicants from anon, authenticated;
revoke all on table public.jobs from anon, authenticated;
