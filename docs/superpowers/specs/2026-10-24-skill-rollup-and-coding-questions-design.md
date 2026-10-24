# Skill evidence roll-up and coding questions

**Date:** 2026-10-24
**Status:** Approved design — implementation plan not yet written
**Scope:** two assessment features, delivered as two independently verifiable slices

---

## Why these two

The portal can already mark a case study or a pitch against criteria the recruiter
wrote, and it can compare a requisition's required skills against the levels AI
screening read out of a CV. The two records never meet: a recruiter reading an
applicant sees "required 4 · shown 3", and a recruiter reading the same person's
test report sees five criteria per question, with no statement of which skill any
criterion was about. The evidence is on file; nobody can total it.

Separately, the portal has no way to ask a candidate to write code. Technical
hiring is the one place where a written case study is a poor substitute, and the
existing engine already has everything needed to review a code answer against
criteria — it simply has no question type to carry one.

Both features were selected from a competitor comparison; neither is a copy of a
competitor's execution. The design below is constrained by what this portal can
honestly claim: it reviews code, it does not run it, and a rubric percentage is
not a proficiency level.

---

## Feature 1 — Skill evidence roll-up

### The rule

A rubric criterion may name one skill from the existing `skills` catalogue. When a
response is graded, that tag is snapshotted with the criterion's marks. A per-skill
report is then arithmetic over snapshots already stored on the response — no new
table, no second source of truth, and no rewrite of a mark given under an older
rubric.

```
QuestionConfig.rubric[]            (authoring, jsonb)
  { label, weight, description?, skill_id?, skill_name? }
        │
        ▼  grading
ai_evaluation.criteria[]           (snapshot, jsonb)
  { label, weight, allowance, percent, marks, evidence?, skill_id?, skill_name? }
        │
        ▼  read time (pure)
SkillEvidenceLine[]
  { skill_id, skill_name, awarded, allowance, percent, contributions[] }
```

### Data model

`RubricCriterion` (`src/types/index.ts`) gains two optional fields:

- `skill_id?: string` — the catalogue row this criterion is evidence of.
- `skill_name?: string` — the catalogue spelling at authoring time.

Both are optional. An untagged rubric behaves exactly as it does today.

`RubricLine` gains the same two optional fields. `scoreRubric` copies them from the
criterion into the line; it computes nothing from them.

`readRubricDraft` (`src/modules/assessment/domain/rubric.ts`) preserves a
well-formed `skill_id` and does not accept a name from the browser. The write door
resolves the name against the catalogue and refuses an id that is unknown or
retired, naming the skill in the refusal. This keeps a client from labelling a
criterion as a skill the catalogue does not hold. The assistant's question writer
passes through the same door, so it cannot bypass the check.

`rubricCriteriaOf` preserves both fields when reading stored config, so a
hand-edited or imported row that carries a tag is still tagged.

### The aggregation

New pure module: `src/modules/assessment/domain/skillEvidence.ts`.

```ts
export interface SkillContribution {
  question_title: string;
  criterion_label: string;
  awarded: number;
  allowance: number;
  evidence: string | null;
}

export interface SkillEvidenceLine {
  skill_id: string;
  skill_name: string;
  awarded: number;
  allowance: number;
  percent: number;          // whole number 0–100
  contributions: SkillContribution[];
}

export function rollUpSkillEvidence(
  papers: readonly { title: string; criteria: readonly RubricLine[] }[]
): SkillEvidenceLine[];
```

Rules, each with a reason the report depends on:

- **Only tagged lines count.** An untagged criterion is evidence of something, but
  not of a catalogue skill. Guessing a skill from the label would invent the
  mapping the feature exists to record.
- **Group by `skill_id`, display a snapshot name.** The id survives a rename; the
  first non-empty snapshot name is what the report prints. Two spellings of one id
  cannot become two rows.
- **Marks are summed, never averaged.** Two questions each worth 10 for a skill
  produce 20 possible marks, not an average of two percentages. Averaging would
  let a one-mark question outweigh a ten-mark question.
- **Percent is `round(awarded / allowance × 100)`**, or 0 when allowance is 0.
  It is a share of the marks the questions actually offered, not of an assumed
  total.
- **Contributions keep every question and criterion**, so a total can always be
  opened up to the lines that produced it.
- **Sort by skill name**, then id, so two readers of the same paper see the same
  order.

The report never converts this percentage into a 1–5 level. A level is a claim
about proficiency on a scale the catalogue defines; a rubric share is a claim
about marks on questions the recruiter wrote. Printing one as the other would be
the same class of error as a scoring weight nobody chose.

### Where it is read

**Attempt report** — `src/app/(admin)/assessments/IssuedLinksBoard.tsx`.
`getAttemptAnswers` already returns every response's `ai_evaluation.criteria` and
the question title. The drawer computes the roll-up with the pure function and
renders a "Skill evidence" block above the per-question verdicts: skill name,
awarded of allowance, percentage, and an expandable list of contributing
questions. No additional query.

Masking follows the block beside it: when `security.mask_scores_for_reviewers`
withholds marks from this reviewer, the skill names and the count of contributing
questions are still shown, and every number reads "Hidden". Which skills a paper
tested is not a score.

**Expanded applicant** — `src/app/(admin)/jobs/JobApplicantsDrawer.tsx`.
The drawer's existing expanded-submission read gains one bounded read of the
application's graded responses (at most 500), their attempt ids, and the question
titles needed to label contributions. It aggregates with the same function and
prints one line per skill beneath the existing CV line:

```
Financial modelling · required 4 · shown 3 · test evidence 82% (2 questions)
```

A required skill with test evidence but no CV row is not promoted to "meets": the
`meets` / `below` / `no_evidence` verdict remains a statement about the CV level.
The test line is additive and separately labelled.

The read is scoped to one application, only when its submission is expanded, so
the applicant list pays nothing for it. If the 500-response bound is reached, the
line says the total covers the responses it read rather than silently presenting
a partial figure as whole. The percentage follows the same
`security.mask_scores_for_reviewers` rule as the attempt report: a reviewer whose
scores are withheld sees the skill and the question count, and every number reads
"Hidden".

### Authoring

`RubricFieldset` in `src/app/(admin)/assessments/QuestionEditorDrawer.tsx` gains a
per-criterion skill select: active catalogue skills by name, plus an explicit
"Not tied to a skill" option. The assessments page gains a bounded read of the
active catalogue and passes it to the editor. An empty catalogue is not an error:
the select says tagging is unavailable and every rubric still saves untagged.

The assistant's authoring tools accept the same tag on a criterion. The Guide
copy for `/assessments` describes the tag, the roll-up, and the rule that an
untagged criterion contributes to no skill.

### Honesty and limits

- Work graded before a criterion carried a tag has no tagged line and contributes
  nothing. The block says what it covers ("from 4 tagged criteria on 2 questions")
  rather than implying the whole application lacks evidence.
- Editing a tag later does not reinterpret a past mark. Regrading creates a new
  snapshot.
- The roll-up never writes `candidate_skills`. That table holds what screening read
  from a CV, one row per (application, skill); writing an assessment percentage
  into its `proficiency` would overwrite that evidence and store a 0–100 number in
  a 1–5 column.
- No migration is required for this feature. The tag lives in the two existing
  jsonb payloads.

---

## Feature 2 — Coding question type

### The rule

A coding question asks the candidate to write code in a named language. The answer
is stored as text. It is reviewed by the AI against the author's rubric — or, with
no rubric, against a code-specific reading — and by a recruiter. It is never
compiled or executed by the portal.

**Why no execution.** Running a candidate's code is a security boundary, not a
feature toggle. It needs an isolated runner, CPU and memory limits, a filesystem
and network policy, a timeout and a story for what happens when the sandbox is
unavailable. None of that exists in this stack, and a half-built runner that
executes untrusted code on the application host would be worse than no runner.
The copy therefore says "reviewed, not run" everywhere the question appears.

### Migration 039 (authored, NOT applied)

`db/migrations/039_coding_questions.sql`:

```sql
alter type public.question_type add value if not exists 'CODING';
notify pgrst, 'reload schema';
```

The file follows `034_situational_judgment.sql`: the value joins the enum rather
than turning the column into text with a CHECK, because every reader switches on
the type name and the enum is what has kept a typo out of a row. `if not exists`
makes it safe to re-run. The file is authored only; applying it is the owner's
decision.

### Types and config

`QuestionType` gains `"CODING"`. `QuestionConfig` gains:

- `language?: string` — one of a closed list in a new domain module
  (`src/modules/assessment/domain/coding.ts`): JavaScript, TypeScript, Python,
  Java, C#, Go, SQL, PHP, Ruby, C++. The list is a domain constant so the editor,
  the AI draft validator and the assistant cannot drift apart.
- `starter_code?: string` — optional; the runner pre-fills it and the candidate
  writes over it. It is not part of the mark.

`CODING` joins `RUBRIC_TYPES` in `src/modules/assessment/domain/rubric.ts`, so the
marking-scheme panel appears, the rubric is graded the same way, and criteria can
carry skill tags — which is how a coding question feeds Feature 1.

### Availability

`src/modules/assessment/application/questionTypeAvailability.ts` gains a `coding`
probe beside `situational`, using the same head-count filter that makes Postgres
answer 22P02 while the enum label is missing. The returned note names
`db/migrations/039_coding_questions.sql`.

While the probe says no:

- the editor does not offer CODING;
- AI suite drafting does not offer it;
- the assistant refuses a CODING write with the file name;
- no screen claims a coding question exists or can be saved.

The Guide states the same condition, and `scripts/prove-migration-claims.mjs`
asks the database for the label so a stale sentence fails the day it is written.

### Authoring

The question editor offers CODING with:
- a required language select (no silent default; an unset language refuses the save);
- an optional starter-code textarea;
- the existing marking-scheme fieldset, now with optional skill tags.

AI drafting (`aiAuthoring.ts`) adds CODING to `TYPE_WORDS` and to the JSON
contract, including `language` and `starter_code`. Draft normalisation refuses a
CODING draft with an unknown or missing language rather than labelling it
JavaScript by default. The drafted question's cautions say it has not been run and
that the recruiter should read the starter code before issuing it.

Every type list behind drafting and authoring is filtered by the availability
probe. A write that reaches the database while 039 is missing is translated from
22P02 to the 039 sentence, the way situational judgment writes are today.

### The candidate runner

New `CodingRunner` in the assessment presentation layer, rendered from the
`AssessmentRunner` type switch. It is a monospace `<textarea>` with:

- spellcheck and autocapitalisation off;
- Tab keeps its normal meaning and moves focus, so the editor cannot become a
  keyboard trap; indentation is typed or pasted as ordinary whitespace;
- the language and starter code shown beside the editor;
- a visible character count and the cap;
- copy stating the code is reviewed by a person and the AI, and is not run.

No editor dependency is added. A code editor is not worth a new bundle and a new
supply-chain surface for a free-text answer; the accessible, dependency-free
control is the one that can be proven in every browser the portal supports.

State:
- `useAssessmentStore` gains `codeAnswersMap: Record<string, string>`.
- The draft payload gains `code_answers_map`; the draft route persists it to
  `candidate_responses.answer_text`.
- The submit route persists it the same way and only for CODING questions.
- Reload splits stored `answer_text` by question type: CODING rows hydrate the
  code map; other rows continue to hydrate the case-study map. A coding answer
  never appears in the case-study box.
- "Answered" for a coding question means trimmed text is non-empty, mirroring the
  case-study rule.
- The submit review lists an unanswered coding question like any other.

**Cap.** A submitted code answer is capped at 20,000 characters. The cap exists
because the text becomes a model prompt; a multi-megabyte paste would be a failed
grading call and a bill nobody agreed to. The runner shows the count and refuses
submission when any code answer is over the cap, naming the question. Drafts still
save so nothing is lost, and the answer can be trimmed before submitting.

### The storage boundary

The attempt payload's config allow-list (`src/app/api/attempt/[token]/route.ts`)
adds `language` and `starter_code` only. The rubric, the criteria weights, the
skill tags and anything the author form grows next stay behind the server. This is
the same allow-list that already keeps a rubric off a sitting candidate's paper.

### Grading

`gradeAttempt` dispatches CODING when `answer_text` is non-empty:

1. **With a rubric** — `gradeByRubric`, material being the code fenced with its
   language identifier, context naming the language. Marks are computed by
   `scoreRubric` exactly as for a case study; the model never returns a total.
2. **Without a rubric** — a new `evaluateCodeSubmission` in the screening engine.
   Its prompt asks for correctness by reading, edge cases, complexity, readability
   and fit to the question; it explicitly forbids claiming the code compiles,
   runs, or passes tests. It returns the same score/rationale/strengths/
   improvements shape as the other single-pass evaluations and rides the
   `case_reasoning` capability — code review is complex analysis, and inventing a
   capability would mean a new routing row and a settings console promise for a
   chain that would be configured the same way.

A refused model reply parks the response for manual review through the existing
path. Nothing about CODING bypasses `scoreRubric`'s arithmetic or the manual-grade
door.

### Review surfaces

- **IssuedLinksBoard**: the answer body renders as a `<pre>` with preserved
  whitespace and horizontal scroll, with the language named. The rubric lines and
  the skill evidence block are unchanged.
- **ComparisonDrawer**: `comparison.ts` carries the question type, and a coding
  answer renders preformatted so two candidates' code can be read side by side.
- **Candidate dossier / report**: the existing per-question verdict and feedback
  apply unchanged; the code itself is the answer body.

No code answer is rendered as HTML. It is text in a preformatted element, so the
question author cannot inject markup through candidate code and the candidate
cannot inject markup through the question.

### Assistant parity

- Question authoring tools accept CODING only while the probe says yes; otherwise
  the refusal names 039.
- Tool descriptions state that a coding answer is reviewed, not executed, and that
  the language must come from the domain list.
- Reads of questions, reports and comparisons carry the type generically; their
  descriptions name coding where they enumerate types.

### Guide

`/assessments` in `pageGuide.ts` gains:
- the CODING type, its language and starter code, and the review-without-running
  rule;
- the 039 condition, stated as absent until the file is applied;
- the rubric skill tag and the per-skill roll-up, including the rule that the
  percentage is not a proficiency level;
- the fields where a coding answer is read and the cap.

The Guide's pinned figures are updated by `prove-guide-figures.mjs` if they count
rubric types or question types.

---

## Delivery plan

Two slices, each gate-green before the next begins.

**Slice 1 — skill evidence roll-up (no migration)**
1. Domain: `skillEvidence.ts`, tag fields on the rubric types, snapshot copy in
   `scoreRubric`, tag preservation in `rubricCriteriaOf`, write-door resolution of
   the skill name.
2. Authoring: skill select, catalogue read, assistant authoring argument.
3. Reads: attempt-report block, expanded-applicant line, masking.
4. Copy and proofs.

**Slice 2 — coding question type (039 authored, unapplied)**
1. Migration 039 and the enum probe.
2. Types/config/domain list, authoring editor, AI drafting, assistant gate.
3. Runner, store, draft/submit/reload, cap.
4. Grading (rubric and fallback), review rendering, comparison.
5. Guide, live scope if needed, proofs, claims gate.

Applying 039 is a separate, owner-approved step. Until then the code can land and
every screen says the type is not available on this database.

---

## Testing

Test-first, fixture-based, no live writes, 039 unapplied.

**Slice 1**
- `prove-skill-evidence.mjs`: tag validation (well-formed id kept, browser name
  ignored, unknown/retired id refused), snapshot copy, aggregation (summed marks,
  rounded percent, duplicate skill within one question, untagged lines excluded,
  stable ordering, zero allowance), masking, and the applicant read's coverage
  sentence.
- Extend `prove-scoring-rubric.mjs` and `prove-rubric-review-ui.mjs` for the tag on
  the line and the block's rendering.
- Extend `prove-opening-skills*.mjs` for the new drawer line and the rule that it
  does not change the meets/below verdict.
- Extend `prove-guide-figures.mjs` for the pinned copy.

**Slice 2**
- `prove-coding-question.mjs`: enum probe refusal copy, language validation,
  starter code optional, sanitizer allow-list (rubric absent, language present),
  draft/submit map separation, reload split, answered flag, cap refusal, grading
  dispatch for both rubric and fallback, preformatted review rendering, assistant
  gate.
- Extend `prove-migration-claims.mjs` for 039's polarity.
- Extend `prove-guide-figures.mjs` for the coding copy.
- Run `tsc --noEmit`, `npm run lint`, and the full standalone proof set.

---

## Out of scope

- Executing, compiling or testing candidate code, in any form.
- Writing skill evidence into `candidate_skills` or converting rubric percentages
  to 1–5 levels.
- A new skill vocabulary, synonyms or automatic skill matching from criterion
  labels.
- Changes to the candidate portal pages; the assessment runner is the surface
  being extended.
- Applying 039, or backfilling tags on already-graded responses.
- A dedicated per-skill report page; the attempt report and the expanded applicant
  are the two surfaces.

---

## Acceptance criteria

1. A rubric criterion can be tagged with one active catalogue skill; saving is
   refused for an unknown or retired id, and the refusal names it.
2. A graded response snapshots the skill id and name with the criterion's marks.
3. An attempt report with tagged criteria shows one row per skill with awarded
   marks, allowance, percentage and contributing questions; untagged papers show
   no block.
4. A masked reviewer sees skill names and contribution counts but no numbers.
5. An expanded applicant shows the test-evidence line beside the requisition's
   required level and the CV level, without changing the meets/below verdict.
6. No migration is added by Slice 1.
7. Migration 039 is authored, unapplied, and every screen that would offer a
   coding question says it is unavailable until the file is applied.
8. With 039 applied (in a rehearsal), a CODING question can be authored with a
   language, optional starter code and optional rubric; the candidate sees a
   monospace editor with the language and starter code but no rubric; the answer
   survives a reload and a submit; an over-cap answer is refused with the
   question named.
9. A coding answer is graded per criterion when a rubric exists and by the
   code-review fallback otherwise; a person can still grade or override it through
   the existing manual door.
10. The report and the comparison render code as preformatted text, never as
    markup.
11. The assistant can write a coding question only when the enum exists, and its
    descriptions say the code is reviewed, not run.
12. The Guide states both features, the roll-up's limits, the cap, and 039's
    applied state.
13. Typecheck, lint and every proof pass with 039 unapplied.
