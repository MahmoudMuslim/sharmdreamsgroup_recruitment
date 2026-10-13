-- Email and in-app notifications.
--
-- `communication_logs` already holds the history row every outbound WhatsApp
-- message writes, so it is the natural home for the two new channels as well:
--
--   * EMAIL needs the subject line the candidate was actually sent, so the
--     outbox can re-send a failed message from its own row instead of
--     re-rendering a template that may have been edited since.
--   * IN_APP notices are opened in the candidate portal, which needs one bit of
--     state beyond `delivered`: whether anyone has read the notice yet.
--
-- Both columns are nullable and no existing row is touched, so the WhatsApp
-- path keeps working exactly as it did.

alter table communication_logs add column if not exists subject text;
alter table communication_logs add column if not exists read_at timestamptz;

-- The portal's only new query shape: unread notices for one application, newest
-- first. Partial so the index stays tiny next to the WhatsApp history.
create index if not exists idx_communication_logs_unread
  on communication_logs (application_id, created_at desc)
  where channel = 'IN_APP' and read_at is null;
