-- ============================================================================
-- A question can ask what someone would do, not only whether they know.
--
-- `public.question_type` holds four values — EXCEL_MODEL, VIDEO_PITCH,
-- CASE_STUDY, MULTIPLE_CHOICE — and the hiring spec's assessment builder lists
-- a fifth shape beside them: the situational judgment test. It is not a quiz
-- with one right answer. It poses a workplace scene and asks which response the
-- candidate would make, and every option earns a share of the question's marks
-- according to how effective that response is. The quiz's boolean `is_correct`
-- cannot say that, so SJT options carry a 0-100 score instead.
--
-- The value joins the enum rather than turning the column into text with a
-- CHECK. Every existing reader — the suite editor, the runner, the grading
-- engine, the bank — switches on this type name, and a database enum is what
-- has kept a typo'd type from reaching a row since the first suite was written.
-- `add value if not exists` makes this file safe to re-run, and the value is
-- appended, so this changes no existing row.
--
-- The option scores live in `assessment_questions.config` jsonb beside the
-- option text, not in a new column: config is already the per-type payload, and
-- the runner's sanitizer already strips it down to `{label, text}` before a
-- candidate sees a question. The submit route scores the chosen option with the
-- same percentage, so this file has nothing else to declare.
--
-- This migration is NOT applied to any database yet. Nothing in the tree names
-- the value in a shared fixed select list: every door probes for it, and while
-- it is missing the database answers 22P02 ("invalid input value for enum") and
-- the door names this file. Applying it is the owner's decision.
-- ============================================================================

alter type public.question_type add value if not exists 'SITUATIONAL_JUDGMENT';

-- PostgREST caches its view of the schema, enum labels included. Without this
-- the form could offer the new type and a REST write would still be told the
-- value does not exist.
notify pgrst, 'reload schema';
