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
-- NOT APPLIED. This file is authored so the runner, the authoring drawer and
-- the proofs can agree on the label ahead of time. Every door that writes a
-- CODING row checks the enum first and refuses with a note naming this
-- migration. Apply it deliberately, with the same approval any other schema
-- change needs.

alter type public.question_type add value if not exists 'CODING';

-- PostgREST caches enum labels. Until this runs, a CODING write is rejected
-- with 22P02 and the UI reports the migration as missing rather than broken.
notify pgrst, 'reload schema';
