-- ============================================================================
-- User invites: allow re-inviting someone whose previous invite was revoked,
-- expired, or already accepted.
-- ============================================================================

-- A plain UNIQUE(email) meant a single invite could ever exist per address, so
-- once an invite was revoked the address was permanently un-invitable.
alter table user_invites drop constraint if exists user_invites_email_key;

-- Only a PENDING invite should block a new one. Everything else is history.
create unique index if not exists user_invites_pending_email_uniq
  on user_invites (lower(email))
  where status = 'PENDING';

-- Guard against unlower()ed duplicates sneaking past the partial index.
create or replace function normalise_invite_email()
returns trigger language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists trg_user_invites_email on user_invites;
create trigger trg_user_invites_email
  before insert or update of email on user_invites
  for each row execute function normalise_invite_email();