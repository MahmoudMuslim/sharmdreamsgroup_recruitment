-- ============================================================================
-- 046_assistant_voice_autonomy.sql
--
-- One word per person: what a spoken confirmation is allowed to do.
--
-- STATUS: authored here, NOT applied. Until it is applied the reader falls
--   back to `confirm`, and the voice console says so naming this file. `code`
--   and `open` are not offered while the table is absent, because a level that
--   cannot be stored cannot be enforced.
--
-- Why a row and not a cookie: a browser could otherwise upgrade itself from
--   "click" to "hands-free" by editing its own storage. The level is read by the
--   server when a card is minted, so the browser never gets a vote.
--
-- Why no audio anywhere: this table stores one word per person and nothing else.
--   Audio is never written to a table, a bucket or a log; only transcript text
--   reaches `assistant_messages`, and only when the person sends the turn.
--
-- SECURITY: two fences, and they answer different questions. The policies say
--   "this is your row"; the `with check` clauses also say "and you may choose
--   this value", by calling `has_permission('settings.manage_platform')` — the
--   same helper the settings console's own write policies use. So a raw REST
--   write cannot store `open` without the grant, and a demoted account cannot
--   keep one by writing its own row. The reader applies the same rule on the
--   way out, demoting a stored `open` to `confirm`.
--
-- See docs/superpowers/specs/2026-10-27-assistant-voice-design.md §Data model.
-- ============================================================================

create table if not exists public.assistant_voice_autonomy (
  profile_id uuid primary key references public.user_profiles (id) on delete cascade,
  mode text not null default 'confirm'
    check (mode in ('confirm', 'code', 'open')),
  updated_at timestamptz not null default now()
);

comment on table public.assistant_voice_autonomy is
  'One word per person: how far a spoken confirmation may go. Read on the server '
  'when an approval card is minted, so the browser never chooses the level.';

comment on column public.assistant_voice_autonomy.mode is
  'confirm waits for a click, code waits for its four-character code, open is '
  'hands-free. The check above refuses a fourth word; the write policies refuse '
  'open without settings.manage_platform.';

comment on column public.assistant_voice_autonomy.updated_at is
  'When the word last moved. Written explicitly by the upsert and restamped by '
  'set_updated_at() on update, so the column is never decorative.';

drop trigger if exists trg_assistant_voice_autonomy_updated on public.assistant_voice_autonomy;
CREATE TRIGGER trg_assistant_voice_autonomy_updated BEFORE UPDATE ON public.assistant_voice_autonomy FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table public.assistant_voice_autonomy enable row level security;

-- Own row only. `current_user_profile_id()` is 020's security-definer helper, so
-- a policy does not read `user_profiles` from inside itself.
drop policy if exists assistant_voice_autonomy_own_read on public.assistant_voice_autonomy;
create policy assistant_voice_autonomy_own_read on public.assistant_voice_autonomy
  for select to authenticated
  using ((select current_user_profile_id()) = profile_id and is_staff());

drop policy if exists assistant_voice_autonomy_own_insert on public.assistant_voice_autonomy;
create policy assistant_voice_autonomy_own_insert on public.assistant_voice_autonomy
  for insert to authenticated
  with check (
    (select current_user_profile_id()) = profile_id
    and is_staff()
    and (mode <> 'open' or has_permission('settings.manage_platform'))
  );

drop policy if exists assistant_voice_autonomy_own_update on public.assistant_voice_autonomy;
create policy assistant_voice_autonomy_own_update on public.assistant_voice_autonomy
  for update to authenticated
  using ((select current_user_profile_id()) = profile_id and is_staff())
  with check (
    (select current_user_profile_id()) = profile_id
    and is_staff()
    and (mode <> 'open' or has_permission('settings.manage_platform'))
  );

-- No delete policy and no delete grant: a person clears a setting by choosing
-- another word, not by deleting the row.

grant select, insert, update on table public.assistant_voice_autonomy to authenticated;
grant all on table public.assistant_voice_autonomy to service_role;
revoke all on table public.assistant_voice_autonomy from anon;

-- PostgREST caches its view of the schema, so a REST read of the new table is
-- refused as an unknown resource until the API reloads.
notify pgrst, 'reload schema';
-- Next file: 047.
