-- ============================================================================
-- Saved assistant conversations.
--
-- The assistant's transcript used to live in the panel's component state, which
-- meant a refresh threw away an answer that had just read five screens and
-- changed two records. Recruiting questions are rarely answered in one turn: the
-- follow-up comes the next morning, and by then the numbers the assistant quoted
-- have to be looked up all over again — with no record of what was asked.
--
-- `assistant_sessions` holds one conversation per recruiter question thread,
-- titled from its first message, and `assistant_messages` holds the turns exactly
-- as they were shown: the tool steps an answer took (so a saved answer still
-- says which records it touched and links to them), which model and provider
-- served it, and the attached document's extracted text, because "and his Python
-- experience?" is only answerable once the CV it refers to is still there.
--
-- `allow_destructive` is deliberately NOT stored. It is a per-look permission,
-- so restoring a conversation must not quietly re-enable deleting records.
--
-- SECURITY
--   RLS is the only gate here: a session and its messages are readable and
--   writable by the staff member who owns them, and by nobody else — including
--   other admins. The owner is a user_profiles row, checked through
--   `current_user_profile_id()`, a security-definer helper in the shape of the
--   ones this schema already uses, so the policy does not have to read
--   user_profiles from inside itself.
-- ============================================================================

create or replace function current_user_profile_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from user_profiles where auth_user_id = auth.uid();
$$;

create table if not exists assistant_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references user_profiles (id) on delete cascade,
  title text not null default 'New conversation',
  -- Which engine the recruiter last chose for this thread. A preference, not a
  -- record of what answered — each message stores the provider that served it.
  engine text check (engine in ('auto', 'qoder', 'gateway')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assistant_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references assistant_sessions (id) on delete cascade,
  -- Repeated from the session so a message policy never has to reach across
  -- tables, which is what would otherwise make RLS recursive here.
  owner_id uuid not null references user_profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- The tool calls behind an answer: [{ tool, label, ok, detail, link }].
  steps jsonb not null default '[]'::jsonb,
  model text,
  provider text,
  -- Set when the preferred engine failed and the other one answered.
  note text,
  attachment_name text,
  attachment_text text,
  created_at timestamptz not null default now()
);

create index if not exists idx_assistant_sessions_owner_updated
  on assistant_sessions (owner_id, updated_at desc);

create index if not exists idx_assistant_messages_session_created
  on assistant_messages (session_id, created_at);

drop trigger if exists trg_assistant_sessions_updated on assistant_sessions;
create trigger trg_assistant_sessions_updated before update on assistant_sessions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: each recruiter sees their own conversations only.
-- ---------------------------------------------------------------------------
alter table assistant_sessions enable row level security;
alter table assistant_messages enable row level security;

drop policy if exists assistant_sessions_owner_read on assistant_sessions;
create policy assistant_sessions_owner_read on assistant_sessions
  for select to authenticated
  using ((select current_user_profile_id()) = owner_id and is_staff());

drop policy if exists assistant_sessions_owner_insert on assistant_sessions;
create policy assistant_sessions_owner_insert on assistant_sessions
  for insert to authenticated
  with check ((select current_user_profile_id()) = owner_id and is_staff());

drop policy if exists assistant_sessions_owner_update on assistant_sessions;
create policy assistant_sessions_owner_update on assistant_sessions
  for update to authenticated
  using ((select current_user_profile_id()) = owner_id)
  with check ((select current_user_profile_id()) = owner_id);

drop policy if exists assistant_sessions_owner_delete on assistant_sessions;
create policy assistant_sessions_owner_delete on assistant_sessions
  for delete to authenticated
  using ((select current_user_profile_id()) = owner_id);

drop policy if exists assistant_messages_owner_read on assistant_messages;
create policy assistant_messages_owner_read on assistant_messages
  for select to authenticated
  using ((select current_user_profile_id()) = owner_id and is_staff());

drop policy if exists assistant_messages_owner_insert on assistant_messages;
create policy assistant_messages_owner_insert on assistant_messages
  for insert to authenticated
  with check ((select current_user_profile_id()) = owner_id and is_staff());

drop policy if exists assistant_messages_owner_delete on assistant_messages;
create policy assistant_messages_owner_delete on assistant_messages
  for delete to authenticated
  using ((select current_user_profile_id()) = owner_id);

comment on table assistant_sessions is
  'One saved assistant conversation per staff member. RLS: owner only.';

comment on column assistant_messages.steps is
  'The tool calls the answer was built from, as shown in the chat: which records '
  'were read or changed and the link to each. Part of the answer, not a log.';

comment on column assistant_messages.attachment_text is
  'Extracted text of the document attached to that turn, clipped to what the model '
  'was allowed to read. Without it a restored thread cannot answer a follow-up '
  'about the CV it was given.';
