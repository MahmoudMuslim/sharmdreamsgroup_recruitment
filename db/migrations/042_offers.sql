-- ============================================================================
-- An offer with a deadline, and the candidate's answer to it.
--
-- Until now "offered" was a stage and a letter: a recruiter moved an applicant
-- to OFFER, the stage writer mailed the offer letter, and whether the person
-- accepted lived in somebody's inbox. There was no row that could say which
-- terms were offered, by when, or what the candidate answered — and the only
-- way to record a hire was for a recruiter to move the stage by hand, which
-- cannot distinguish "they said yes" from "we assume they did".
--
-- `application_offers` is that row. One row per offer, one open offer per
-- application (the partial unique index below), and a state that moves once:
--
--   SENT ──► ACCEPTED     the candidate's word, written by the public door
--        ├─► DECLINED     the candidate's word, written by the public door
--        └─► WITHDRAWN    the company taking it back
--
-- ACCEPTED does not hire anybody. The stage stays OFFER until a recruiter clicks
-- Confirm hire, which goes through the same stage writer every other move uses
-- and stamps `hired_at`. That separation is deliberate: a mailed page records a
-- person's answer, and creating an employment record stays a decision the
-- company makes on its own screen.
--
-- The deadline is per offer (`expires_at`), defaulting to seven days in the
-- domain module. Expiry never decides for anybody: a late click is refused with
-- a sentence, it does not become a decline, and nothing sweeps an unanswered
-- offer into a rejection. The page can still be read after the deadline so the
-- candidate sees that it expired.
--
-- No free-text column lives here. The terms are the offer letter the email
-- carried; a free-text decision note would be one more place a person's own
-- words sit with no screen that reads them, and erasure would have to chase it.
-- What the candidate chose is a closed enum and a timestamp, which is the fact
-- the desk actually needs.
--
-- Row-level security: every staff member reads the book; a staff member may
-- withdraw an offer, and the WITH CHECK limits a staff write to that one state.
-- ACCEPTED and DECLINED are written by the public action with the service role,
-- because the holder has no session — the signed link is the credential. Anon is
-- granted nothing at all, so no direct REST call can answer an offer in somebody
-- else's name.
--
-- NOT APPLIED. This file is authored so the drawer, the public page and the proof
-- can name it; running it is the owner's decision. The drawer says so rather than
-- pretending it stored an offer. Issuing still needs the email relay, and the
-- stage move to OFFER still works without this table.
-- ============================================================================

create table if not exists public.application_offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  state text not null default 'SENT',
  expires_at timestamp with time zone not null,
  issued_at timestamp with time zone default now() not null,
  issued_by uuid,
  decided_at timestamp with time zone,
  constraint application_offers_state_check
    check (state in ('SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')),
  constraint application_offers_decided_check
    check ((state = 'SENT') = (decided_at is null)),
  constraint application_offers_application_fkey
    foreign key (application_id) references applications (id) on delete cascade,
  constraint application_offers_issued_by_fkey
    foreign key (issued_by) references user_profiles (id) on delete set null
);

comment on table public.application_offers is
  'One offer to one applicant, its deadline and the answer. The letter is the '
  'email body; this row is what makes the answer countable and auditable.';

comment on column public.application_offers.expires_at is
  'The last instant an answer counts. Expiry refuses a late answer; it never '
  'turns an unanswered offer into a decline or a rejection.';

comment on column public.application_offers.state is
  'SENT until the candidate answers or the company withdraws it. ACCEPTED and '
  'DECLINED are the candidate''s word; WITHDRAWN is ours. None of them hires.';

comment on column public.application_offers.decided_at is
  'When the answer or withdrawal was written. Null exactly while state = SENT, '
  'enforced by the check above so a decided row always carries its time.';

/*
 * One open offer at a time.
 *
 * A second SENT row for the same application would give the candidate two live
 * links with different deadlines, and the desk no single answer to act on. The
 * partial index leaves answered and withdrawn rows alone, so a declined offer
 * can be followed by a new one with new terms.
 */
create unique index if not exists application_offers_one_open_idx
  on public.application_offers (application_id)
  where state = 'SENT';

create index if not exists application_offers_application_idx
  on public.application_offers (application_id, issued_at desc);

alter table if exists public.application_offers enable row level security;

/*
 * The desk reads the book. Every staff member sees it: an offer is part of the
 * hiring record the pipeline already shows, and hiding it from a hiring manager
 * would hide the answer they are waiting on.
 */
drop policy if exists "application_offers_staff_read" on public.application_offers;
create policy "application_offers_staff_read" on public.application_offers
  for SELECT
  to authenticated
  using (is_staff());

/*
 * Issuing is the desk's. The issuer is bound to the session's own profile id,
 * never a name sent by the browser, so the row cannot claim somebody else sent
 * it. The action checks `candidates.write` as well; this is the copy that holds
 * for a request that bypasses the action.
 */
drop policy if exists "application_offers_staff_insert" on public.application_offers;
create policy "application_offers_staff_insert" on public.application_offers
  for INSERT
  to authenticated
  with check (
    is_staff()
    and issued_by = current_user_profile_id()
  );

/*
 * A staff write may only take an open offer back.
 *
 * `USING` sees the old row and `WITH CHECK` the new one, so a direct REST call
 * cannot record the candidate's answer — or reopen a decided offer — even if it
 * holds a staff session. ACCEPTED and DECLINED belong to the public door, which
 * writes with the service role and checks the signed link first.
 */
drop policy if exists "application_offers_staff_update" on public.application_offers;
create policy "application_offers_staff_update" on public.application_offers
  for UPDATE
  to authenticated
  using (
    is_staff()
    and state = 'SENT'
  )
  with check (
    is_staff()
    and state = 'WITHDRAWN'
  );

grant select, insert, update on table public.application_offers to authenticated;
grant select, insert, update, delete on table public.application_offers to service_role;
revoke all on table public.application_offers from anon;

-- PostgREST caches its view of the schema, so a REST write to the new table is
-- refused as an unknown resource until the API reloads. Without this the drawer
-- would say "not issued yet" against a database that has the table.
notify pgrst, 'reload schema';
