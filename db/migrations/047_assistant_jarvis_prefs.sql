-- ============================================================================
-- 047_assistant_jarvis_prefs.sql
--
-- One row per person: how far the assistant's presence may reach.
--
-- STATUS: authored here, NOT applied. Until it is applied the reader returns
--   defaults with `problem: "absent"` — everything off — and the JARVIS panel
--   says so, naming this file. Nothing is silently assumed on.
--
-- Why a row and not localStorage: `ambient` arms a microphone on every admin
--   screen, and `watching` decides what the portal says out loud. Both are
--   safety-relevant, so neither may be upgraded by the browser that would
--   benefit: the value is read by the server, and every change is written to
--   the activity trail with the person who made it.
--
-- Why `ambient_consent_at`: arming is preceded by a screen that names what the
--   browser does with the audio (Chrome streams it to Google's speech service,
--   independently of this portal). This column is when that was last accepted,
--   so the explanation can be shown again rather than assumed remembered. It is
--   a timestamp, not a copy of the screen.
--
-- Why no audio columns anywhere: this is preferences, not conversations. Audio
--   is never written to a table, a bucket or a log; only the transcript of a
--   turn the person sent reaches `assistant_messages`, exactly as if typed.
--
-- SECURITY: own row only, staff only. `current_user_profile_id()` is 020's
--   security-definer helper, so a policy does not read `user_profiles` from
--   inside itself. There is no policy by which one account can read or write
--   another's row — an administrator cannot arm somebody else's microphone.
--
-- See docs/superpowers/specs/2026-10-28-jarvis-presence-design.md §Privacy.
-- ============================================================================

create table if not exists public.assistant_jarvis_prefs (
  profile_id uuid primary key references public.user_profiles (id) on delete cascade,
  -- The ambient wake word on any admin screen. Off unless the person armed it.
  ambient boolean not null default false,
  -- When the audio explanation was last accepted. Null means never.
  ambient_consent_at timestamptz,
  -- The spoken briefing, and the hour of the group's day it belongs to.
  briefing boolean not null default false,
  briefing_hour smallint not null default 8
    check (briefing_hour between 0 and 23),
  -- The threshold watcher, and which queues it is allowed to speak about.
  watching boolean not null default false,
  watch_queues text[] not null default '{}',
  -- Speech is suppressed inside this window; a queue that crosses still badges.
  quiet_from text not null default '18:00'
    check (quiet_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_to text not null default '08:00'
    check (quiet_to ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  updated_at timestamptz not null default now()
);

comment on table public.assistant_jarvis_prefs is
  'One row per person: whether the assistant may listen in the background, speak '
  'on its own, and which queues may make it do so. Read on the server so the '
  'browser never widens its own reach.';

comment on column public.assistant_jarvis_prefs.ambient is
  'Arms the browser wake-word recogniser on any admin screen. Off by default and '
  'only ever set by the account it belongs to.';

comment on column public.assistant_jarvis_prefs.watch_queues is
  'The attention-feed queue ids this person agreed to be interrupted by. An empty '
  'array with watching = true speaks about nothing, which is a valid choice.';

comment on column public.assistant_jarvis_prefs.quiet_from is
  'Start of the window speech is suppressed in, as the group wall clock. A window '
  'that wraps midnight (18:00 to 08:00) is the ordinary case, not an edge case.';

drop trigger if exists trg_assistant_jarvis_prefs_updated on public.assistant_jarvis_prefs;
CREATE TRIGGER trg_assistant_jarvis_prefs_updated BEFORE UPDATE ON public.assistant_jarvis_prefs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table public.assistant_jarvis_prefs enable row level security;

drop policy if exists assistant_jarvis_prefs_own_read on public.assistant_jarvis_prefs;
create policy assistant_jarvis_prefs_own_read on public.assistant_jarvis_prefs
  for select to authenticated
  using ((select current_user_profile_id()) = profile_id and is_staff());

drop policy if exists assistant_jarvis_prefs_own_insert on public.assistant_jarvis_prefs;
create policy assistant_jarvis_prefs_own_insert on public.assistant_jarvis_prefs
  for insert to authenticated
  with check ((select current_user_profile_id()) = profile_id and is_staff());

drop policy if exists assistant_jarvis_prefs_own_update on public.assistant_jarvis_prefs;
create policy assistant_jarvis_prefs_own_update on public.assistant_jarvis_prefs
  for update to authenticated
  using ((select current_user_profile_id()) = profile_id and is_staff())
  with check ((select current_user_profile_id()) = profile_id and is_staff());

-- No delete policy and no delete grant: a person turns a thing off by setting it
-- false, not by deleting the row that records they chose.

grant select, insert, update on table public.assistant_jarvis_prefs to authenticated;
grant all on table public.assistant_jarvis_prefs to service_role;
revoke all on table public.assistant_jarvis_prefs from anon;

-- PostgREST caches its view of the schema, so a REST read of the new table is
-- refused as an unknown resource until the API reloads.
notify pgrst, 'reload schema';
-- Next file: 048.
