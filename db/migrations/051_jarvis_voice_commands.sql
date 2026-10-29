-- 051_jarvis_voice_commands.sql
-- JARVIS voice commands: phrases a person saves, and the action each one runs.
--
-- NOT APPLIED as of 2026-10-29. Applying this file needs its own named approval;
-- until it is applied the console and the presence say so and list nothing, which
-- is what scripts/prove-migration-claims.mjs checks the copy against.
--
-- A row is one person's (`scope = 'personal'`, an owner) or everybody's
-- (`scope = 'shared'`, no owner) — a CHECK says so, so a row cannot claim both and
-- a policy cannot be written against the wrong half. The same phrase may exist
-- once per person and once for the portal, which is what lets somebody add a
-- shared command to their own list and have theirs win.
--
-- The phrases are matched on folded tokens by `matchCommand` in
-- src/modules/assistant/domain/commands.ts, so the uniqueness index is over
-- `lower(btrim(trigger_phrase))` — a near miss in spelling is a different phrase,
-- but a near miss in case or padding is the same one.
--
-- `category` is a label, not a foreign key or an enum: one TEXT column carries both
-- the identity of a group and the words printed on its badge, so a category the
-- person invented stores its own name and the console's six defaults keep theirs.
-- The six are defaults, not a closed set — a second vocabulary held here would be a
-- second thing to keep in sync, and it would refuse names the portal's write door
-- accepts.

begin;

create table if not exists public.assistant_jarvis_commands (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('personal', 'shared')),
  owner_profile_id uuid references public.user_profiles (id) on delete cascade,
  trigger_phrase text not null
    constraint assistant_jarvis_commands_phrase_shape check (
      char_length(btrim(trigger_phrase)) between 2 and 64
      and trigger_phrase !~ '[\u0000-\u001F]'
    ),
  title text not null
    constraint assistant_jarvis_commands_title_shape check (
      char_length(btrim(title)) between 1 and 80
    ),
  category text not null
    -- One short label, whether it names one of the console's six defaults or a
    -- category the person invented. A closed set here would refuse names the portal's
    -- own write door accepts, and would be a second vocabulary to keep in sync. Width
    -- only, with headroom: the door refuses above 32 characters
    -- (COMMAND_LIMITS.categoryMax) and this allows 40, because a CHECK tighter than
    -- the code feeding it turns an accepted save into a REST error with no field the
    -- console can blame.
    constraint assistant_jarvis_commands_category_shape check (
      char_length(category) between 1 and 40
      and category !~ '[\u0000-\u001F]'
    ),
  action_type text not null
    constraint assistant_jarvis_commands_type_shape check (
      action_type in ('ask','open','tool','note')
    ),
  action_payload jsonb not null default '{}'::jsonb
    -- Four times the door's ceiling, deliberately. The console refuses a draft above
    -- 4096 characters of compact JSON; this column measures octet_length of jsonb's
    -- canonical text, which is longer twice over: it re-inserts a space after every
    -- comma and colon, and it counts UTF-8 bytes, so an `ask` prompt written in
    -- Arabic or Russian costs two or three octets per character. A ceiling equal to
    -- the door's would let the console accept a row the database then rejects — a
    -- save that fails with a message nobody can predict.
    constraint assistant_jarvis_commands_payload_size check (
      octet_length(action_payload::text) <= 16384
    ),
  notes text
    constraint assistant_jarvis_commands_notes_shape check (
      notes is null or char_length(notes) <= 500
    ),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A row is one person's, or everybody's, never both.
  constraint assistant_jarvis_commands_scope_owner check (
    (scope = 'personal' and owner_profile_id is not null)
    or (scope = 'shared' and owner_profile_id is null)
  )
);

-- Two partial indexes rather than one expression over a coalesced owner, so a
-- person's phrase and the portal's phrase are separate namespaces.
create unique index if not exists assistant_jarvis_commands_personal_phrase
  on public.assistant_jarvis_commands (owner_profile_id, lower(btrim(trigger_phrase)))
  where scope = 'personal';

create unique index if not exists assistant_jarvis_commands_shared_phrase
  on public.assistant_jarvis_commands (lower(btrim(trigger_phrase)))
  where scope = 'shared';

create index if not exists assistant_jarvis_commands_owner_scope
  on public.assistant_jarvis_commands (scope, owner_profile_id);

alter table public.assistant_jarvis_commands enable row level security;

-- The person's own rows, and only theirs. A delete policy exists here and not on
-- `assistant_jarvis_prefs` because a command is content its author may take back,
-- while a prefs row is the record that a choice was made.
create policy assistant_jarvis_commands_personal_select on public.assistant_jarvis_commands
  for select to authenticated using (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  );

create policy assistant_jarvis_commands_personal_insert on public.assistant_jarvis_commands
  for insert to authenticated with check (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  );

create policy assistant_jarvis_commands_personal_update on public.assistant_jarvis_commands
  for update to authenticated using (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  ) with check (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  );

create policy assistant_jarvis_commands_personal_delete on public.assistant_jarvis_commands
  for delete to authenticated using (
    scope = 'personal' and (select current_user_profile_id()) = owner_profile_id and is_staff()
  );

-- Shared rows: everybody's to speak, and somebody's to write. Reading is open to
-- every staff member because a phrase a teammate published is a phrase the team
-- says; writing is behind a permission, because adding words the whole portal will
-- act on is a decision and not a default.
create policy assistant_jarvis_commands_shared_select on public.assistant_jarvis_commands
  for select to authenticated using (scope = 'shared' and is_staff());

create policy assistant_jarvis_commands_shared_insert on public.assistant_jarvis_commands
  for insert to authenticated with check (
    scope = 'shared' and is_staff() and has_permission('assistant.commands')
  );

create policy assistant_jarvis_commands_shared_update on public.assistant_jarvis_commands
  for update to authenticated using (
    scope = 'shared' and is_staff() and has_permission('assistant.commands')
  ) with check (
    scope = 'shared' and is_staff() and has_permission('assistant.commands')
  );

create policy assistant_jarvis_commands_shared_delete on public.assistant_jarvis_commands
  for delete to authenticated using (
    scope = 'shared' and is_staff() and has_permission('assistant.commands')
  );

grant select, insert, update, delete on public.assistant_jarvis_commands to authenticated;
grant all on public.assistant_jarvis_commands to service_role;
revoke all on public.assistant_jarvis_commands from anon;

insert into public.permissions (key, label, group_name, description)
values ('assistant.commands', 'Publish shared JARVIS commands', 'Assistant',
        'Add, edit and remove voice commands every recruiter can use')
on conflict (key) do nothing;

-- No SUBSIDIARY_HR_MANAGER row. `role_permissions.role_key` is `app_role`, which
-- does hold that value — but a person's own role is `user_profiles.role`, typed
-- `user_role`, whose four values exclude it. So a grant for it would be a matrix
-- entry no account can ever hold. RECRUITER is left to the matrix on purpose — a
-- recruiter can speak a shared command without being able to publish one.
insert into public.role_permissions (role_key, permission_key, granted)
values ('SUPER_ADMIN', 'assistant.commands', true),
       ('HIRING_MANAGER', 'assistant.commands', true)
on conflict (role_key, permission_key) do nothing;

-- Four starters, and not one of them a tool: a seeded write that a person did not
-- write is exactly the kind of thing that should wait for a click.
--
-- `on conflict do nothing` is not available here: the only unique indexes are
-- partial, and an inference clause cannot name one. The guard is per row instead,
-- so a database that has some of these starters receives only the rest.
insert into public.assistant_jarvis_commands (scope, trigger_phrase, title, category, action_type, action_payload, notes)
select v.scope, v.trigger_phrase, v.title, v.category, v.action_type, v.action_payload, v.notes
from (values
  ('shared', 'open candidates', 'Open candidates', 'navigation', 'open', '{"href":"/candidates"}'::jsonb,
   'The candidate list, exactly as the rail opens it.'),
  ('shared', 'open the pipeline', 'Open the pipeline', 'navigation', 'open', '{"href":"/jobs"}'::jsonb,
   'The openings grid with its demand columns.'),
  ('shared', 'today''s interviews', 'Today''s interviews', 'hiring', 'ask',
   '{"prompt":"What interviews are scheduled today?"}'::jsonb,
   'Asks the assistant rather than opening a page, because the answer is a count.'),
  ('shared', 'open the outbox', 'Open the outbox', 'communication', 'open', '{"href":"/whatsapp"}'::jsonb,
   'The messaging queue with its rails.')
) as v (scope, trigger_phrase, title, category, action_type, action_payload, notes)
where not exists (
  select 1 from public.assistant_jarvis_commands e
  where e.scope = v.scope and lower(btrim(e.trigger_phrase)) = lower(btrim(v.trigger_phrase))
);

create trigger assistant_jarvis_commands_set_updated_at
  before update on public.assistant_jarvis_commands
  for each row execute function set_updated_at();

notify pgrst, 'reload schema';

commit;
