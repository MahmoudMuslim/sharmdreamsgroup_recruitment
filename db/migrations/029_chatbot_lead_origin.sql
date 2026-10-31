-- ============================================================================
-- A careers-assistant lead needs its own source.
--
-- The public chatbot files visitors who ask to be remembered into
-- `sourced_prospects`, the pool recruiters already work, so the conversation
-- lands where the outreach happens and nothing new has to be learned. But the
-- pool's `origin` check only knows where a *recruiter* found a person —
-- LinkedIn links, a CSV, or typed by hand. A visitor who arrived on their own
-- and left details to the assistant is none of those, and "MANUAL" would tell
-- the next reader that a recruiter added the row they did not add.
--
-- So the source gets a value of its own. Additive only: every existing row
-- keeps its origin, no data is rewritten and nothing else on the table moves.
-- ============================================================================

alter table sourced_prospects drop constraint if exists sourced_prospects_origin_check;

alter table sourced_prospects
  add constraint sourced_prospects_origin_check
  check (origin in ('LINKEDIN', 'CSV', 'MANUAL', 'CHATBOT'));
