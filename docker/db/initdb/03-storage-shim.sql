-- Stand-in for Supabase Storage, so supabase/schema.sql's eight storage.objects
-- policies and its four bucket inserts apply unchanged. Replaceable by design:
-- Plan 2 swaps this for a `files` table over a /data/uploads volume (spec §7).

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  owner uuid,
  name text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as
$$ select string_to_array(name, '/') $$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Deliberately no `create publication supabase_realtime` here, unlike the
-- throwaway stub. schema.sql's two realtime DO-blocks catch undefined_object,
-- so with no publication they are no-ops; standing one up here would hide that.
