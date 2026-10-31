-- ============================================================================
-- A setting the database holds and no screen shows is a switch nobody owns.
--
-- `security.require_oauth` arrived with the first seed (db/migrations/001_
-- settings_rbac.sql), described as "Force single sign-on for all staff". Nothing
-- has ever read it: no action, no route, no policy and no guard names the key,
-- and the Settings console draws its controls from `SETTINGS_SCHEMA`, in which
-- the key does not appear. So the row is a promise the software does not keep —
-- and a promise in a table is the dangerous kind, because the next person to
-- audit access reads the row, believes single sign-on is a switch this portal
-- has, and looks for the enforcement that was never wired.
--
-- The alternative — enforcing it — would be inventing a feature. This portal
-- signs staff in with its own password-backed tokens (src/lib/auth), there is no
-- identity provider configured anywhere in the stack, and nobody has asked for
-- one. A row cannot be left in place simply because deleting it feels like
-- admitting the seed was wrong.
--
-- Deleting is also the smaller change than leaving it: the row is never written
-- (the console cannot reach a key outside its schema, and `saveSettings` filters
-- the payload down to that schema), and the settings change trail holds no row
-- for it, so nothing here forgets a value anybody set.
--
-- This migration was authored to take the promise out of the table. The live
-- application is the owner's decision.
--
-- APPLIED. The owner approved this file and it ran on the local database on
-- 2026-10-28: `DELETE 1`, `app_settings` went 26 rows to 25, and the three keys
-- still under `security.` are the ones the console shows
-- (`mask_scores_for_reviewers`, `password_min_length`, `session_timeout_minutes`).
-- The settings audit trail holds no row for the retired key, exactly as reasoned
-- above, so nothing here forgets a value anybody set. `db/schema.sql` no longer
-- seeds it either — the row is a `insert … on conflict (id) do nothing`, so
-- leaving that line in place would re-create a deleted setting on any database
-- rebuilt from the schema of record.
--
-- `scripts/prove-settings-keys.mjs` carried this key on a named waiting list
-- while the file sat unapplied; the apply emptied that list, and the list is
-- still checked for being real and stale, so a second unread row fails the gate
-- the day it is added.
-- ============================================================================

delete from public.app_settings
 where scope = 'GLOBAL' and company_id is null and key = 'security.require_oauth';

-- PostgREST caches its view of the schema, not its rows, so this is only to keep
-- the habit of notifying after a data-shape change; the read is a plain SELECT.
notify pgrst, 'reload schema';
