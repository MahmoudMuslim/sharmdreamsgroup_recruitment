-- 039_coding_questions.sql
--
-- A sixth question type: CODING.
--
-- The candidate is given a prompt (and optionally a language and a starter
-- snippet) and writes source code into a plain text answer box. Nothing in this
-- platform compiles, runs or tests that code. The stack has no sandbox, and a
-- reviewer reading the submission is the only thing that ever evaluates it. The
-- type exists so a code answer has its own shape, its own cap (20,000
-- characters) and its own review surface instead of being smuggled into a case
-- study.
--
-- APPLIED on this local database. The date this file was run is not recorded
-- here; what is recorded is `CODING` read back out of pg_enum on 2026-10-29. The
-- runner, the authoring drawer and the proofs agreed on the label ahead of the
-- apply, and every door that writes a CODING row still checks the enum first and
-- refuses with a note naming this migration. That note is the condition a
-- database without the label gets, not this database's state.

alter type public.question_type add value if not exists 'CODING';

-- PostgREST caches enum labels. Until this runs, a CODING write is rejected
-- with 22P02 and the UI reports the migration as missing rather than broken.
notify pgrst, 'reload schema';
