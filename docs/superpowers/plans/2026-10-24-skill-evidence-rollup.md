# Skill Evidence Roll-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a rubric criterion name one catalogue skill, snapshot that tag with the mark it earned, and report the marks each skill collected across a paper and across an applicant's tests — without a migration and without writing `candidate_skills`.

**Architecture:** The tag rides in the two jsonb payloads that already exist: `assessment_questions.config.rubric` at authoring and `candidate_responses.ai_evaluation.criteria` at grading. `scoreRubric` copies the tag onto each `RubricLine`; a new pure domain module groups tagged lines by `skill_id`, sums marks, and returns one line per skill with every contributing question kept. Two read surfaces consume it: the assessment answers drawer (from the paper already loaded) and the expanded applicant (from one bounded read of that application's graded responses). The write door resolves the tag's id against the `skills` catalogue and stores the catalogue's own spelling, so a client cannot label a criterion with a skill the catalogue does not hold.

**Tech Stack:** Next.js 16 app router, React 19, TypeScript 5, Tailwind 4, self-hosted PostgREST/Postgres, Node 24 test runner with direct `.ts` imports, hand-rolled transpile/render harnesses for client components.

**Spec:** [docs/superpowers/specs/2026-10-24-skill-rollup-and-coding-questions-design.md](../../specs/2026-10-24-skill-rollup-and-coding-questions-design.md) — Feature 1 and acceptance criteria 1–6.

## Global Constraints

- **No migration, no new table, no new column.** Slice 1 touches only TypeScript and jsonb payloads. Migrations 032, 034, 035, 037 and 038 remain authored-but-unapplied; do not apply any of them.
- **Never write `candidate_skills`.** That table holds what AI screening read from a CV, one row per (application, skill), proficiency 1–5. An assessment percentage must never be stored in `proficiency`.
- **Never convert a rubric percentage to a 1–5 level.** A percentage is a share of marks the questions offered; a level is a proficiency claim. No surface may print one as the other.
- **Masking follows `security.mask_scores_for_reviewers`.** When marks are withheld, skill names and contribution counts still print; every mark, allowance and percentage reads "Hidden". Grouping and counts are not scores.
- **Only tagged criteria count.** Never infer a skill from a criterion's label.
- **Sums, not averages.** Two 10-mark criteria for one skill are 20 possible marks, not the mean of two percentages.
- **A historical mark is never reinterpreted.** The snapshot on the response is the only input. Editing a tag later affects future grading only.
- **`rubricMetadata` has no second source of truth.** Do not add a skills table join to the grading path; the snapshot is read as stored.
- **Boundaries:** `src/modules/jobs/application/openingSkillsRead.ts` starts with `import "server-only"`, so the new pure modules must not import it. Only server actions may import it.
- **Proof style:** `node --test`, `node:assert/strict`, fixtures only, no live writes, no provider calls.
- **Gates (run from the repo root):**
  - `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
  - `npm run lint; echo "lint exit=$?"`
- **Commits:** conventional lowercase subject plus a body that says why. Do not commit until the task's own steps pass.

---

### Task 1: Carry the tag through the rubric types and the snapshot

**Files:**
- Modify: `src/types/index.ts:184-215`
- Modify: `src/modules/assessment/domain/rubric.ts:68-72, 104-160, 170-184, 260-332`
- Modify: `src/modules/assessment/domain/attemptAnswers.ts:54-62, 175-197`
- Test: `scripts/prove-scoring-rubric.mjs` (append after the existing rubric-domain tests)

**Interfaces:**
- Consumes: existing `RubricCriterion`, `RubricLine`, `RubricDraftRow`, `scoreRubric`, `rubricCriteriaOf`, `readRubricDraft`, `awardedCriteriaOf`.
- Produces:
  - `RubricCriterion.skill_id?: string`, `RubricCriterion.skill_name?: string`
  - `RubricLine.skill_id?: string`, `RubricLine.skill_name?: string`
  - `AnswerCriterion.skill_id: string | null`, `AnswerCriterion.skill_name: string | null`
  - `readRubricDraft` keeps a browser-supplied `skill_id` and ignores `skill_name`.
  - `rubricCriteriaOf` keeps both stored fields.
  - `scoreRubric` copies both fields onto the line.

- [ ] **Step 1: Write the failing test**

Append to [scripts/prove-scoring-rubric.mjs](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/prove-scoring-rubric.mjs):

```js
test("a rubric criterion keeps its skill tag through authoring and the snapshot", () => {
  const read = readRubricDraft([
    {
      label: "Diagnoses the cause",
      weight: 60,
      skill_id: "skill-finance",
      // A browser or a chat model may send a name; the write door owns it.
      skill_name: "Forged name",
    },
    { label: "Protects the guest", weight: 40 },
  ]);
  assert.equal(read.ok, true);
  assert.equal(read.criteria[0].skill_id, "skill-finance");
  assert.equal("skill_name" in read.criteria[0], false);

  const scored = scoreRubric(20, read.criteria, [
    { criterion: "Diagnoses the cause", percent: 50, evidence: "names occupancy first" },
    { criterion: "Protects the guest", percent: 100 },
  ]);
  assert.equal(scored.ok, true);
  assert.equal(scored.lines[0].skill_id, "skill-finance");
  assert.equal(scored.lines[0].marks, 6);

  const readBack = attemptAnswersDomain.awardedCriteriaOf(
    { criteria: scored.lines },
    false
  );
  assert.equal(readBack[0].skill_id, "skill-finance");
  assert.equal(readBack[0].skill_name, null);
  const withheld = attemptAnswersDomain.awardedCriteriaOf(
    { criteria: scored.lines },
    true
  );
  assert.equal(withheld[0].skill_id, "skill-finance");
  assert.equal(withheld[0].marks, null);
});

test("a stored rubric keeps the catalogue's own spelling of the skill", () => {
  const criteria = rubricCriteriaOf({
    rubric: [
      {
        label: "Models the downside",
        weight: 100,
        skill_id: "skill-finance",
        skill_name: "Financial modelling",
      },
    ],
  });
  assert.equal(criteria[0].skill_id, "skill-finance");
  assert.equal(criteria[0].skill_name, "Financial modelling");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/prove-scoring-rubric.mjs`
Expected: the two new tests FAIL — `undefined !== "skill-finance"` and `"skill_name" in read.criteria[0]` is true.

- [ ] **Step 3: Add the fields to the shared types**

In [src/types/index.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/types/index.ts) change `RubricCriterion` (line 184) and `RubricLine` (line 201) to:

```ts
export interface RubricCriterion {
  label: string;
  weight: number;
  description?: string;
  /** The `skills` catalogue row this criterion is evidence of. */
  skill_id?: string;
  /** The catalogue spelling at authoring time, so a later rename does not relabel a mark. */
  skill_name?: string;
}

export interface RubricLine {
  label: string;
  weight: number;
  allowance: number;
  percent: number;
  marks: number;
  evidence: string | null;
  description?: string;
  skill_id?: string;
  skill_name?: string;
}
```

- [ ] **Step 4: Read and preserve the tag in the rubric domain**

In [src/modules/assessment/domain/rubric.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/assessment/domain/rubric.ts):

1. Extend `RubricDraftRow` (line 68):

```ts
export interface RubricDraftRow {
  label?: unknown;
  weight?: unknown;
  description?: unknown;
  skill_id?: unknown;
  /** Read only from stored config; a browser's name is ignored. */
  skill_name?: unknown;
}
```

2. In `readRubricDraft`, replace the two-line push at 138–140 with:

```ts
    const description = text(row.description);
    const skillId = text(row.skill_id);
    criteria.push({
      label,
      weight,
      ...(description ? { description } : {}),
      ...(skillId ? { skill_id: skillId } : {}),
    });
```

3. In `rubricCriteriaOf`, replace the push at 181 with:

```ts
    const description = text(row.description);
    const skillId = text(row.skill_id);
    const skillName = text(row.skill_name);
    criteria.push({
      label,
      weight,
      ...(description ? { description } : {}),
      ...(skillId ? { skill_id: skillId } : {}),
      ...(skillId && skillName ? { skill_name: skillName } : {}),
    });
```

4. In `scoreRubric`, replace the line object at 315–323 with:

```ts
    return {
      label: criterion.label,
      weight: criterion.weight,
      allowance,
      percent: band.percent,
      marks: Math.round((allowance * band.percent) / RUBRIC_WEIGHT_TOTAL),
      evidence: band.evidence,
      ...(criterion.description ? { description: criterion.description } : {}),
      ...(criterion.skill_id ? { skill_id: criterion.skill_id } : {}),
      ...(criterion.skill_name ? { skill_name: criterion.skill_name } : {}),
    };
```

- [ ] **Step 5: Read the tag off the stored snapshot**

In [src/modules/assessment/domain/attemptAnswers.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/assessment/domain/attemptAnswers.ts):

1. Add to `AnswerCriterion` after `description` (line 61):

```ts
  /** The catalogue row this criterion was evidence of, or null when untagged. */
  skill_id: string | null;
  /** The catalogue spelling stored with the mark, or null when untagged. */
  skill_name: string | null;
```

2. In `awardedCriteriaOf`, add to the pushed object after `description` (line 193):

```ts
      skill_id: prose(record.skill_id),
      skill_name: prose(record.skill_name),
```

`maskCriterionMarks` spreads the line, so the tag survives masking without an edit.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test scripts/prove-scoring-rubric.mjs`
Expected: PASS, including the two new tests.

- [ ] **Step 7: Typecheck the touched surface**

Run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Expected: `tsc exit=0`. A `RubricCriterion` constructed from a literal elsewhere must not fail: `skill_id` and `skill_name` are optional.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/modules/assessment/domain/rubric.ts src/modules/assessment/domain/attemptAnswers.ts scripts/prove-scoring-rubric.mjs
git commit -m "feat(assessments): carry a rubric criterion's skill tag into its mark

The tag lives in the two jsonb payloads that already exist, so a paper
graded under a tagged criterion can be totalled per skill without a new
table, and a later rename cannot relabel a mark already given."
```

---

### Task 2: Roll the snapshots up into one line per skill

**Files:**
- Create: `src/modules/assessment/domain/skillEvidence.ts`
- Test: `scripts/prove-skill-evidence.mjs`

**Interfaces:**
- Consumes: `awardedCriteriaOf` from `src/modules/assessment/domain/attemptAnswers.ts`.
- Produces:
  - `SkillEvidenceCriterion { skill_id?: string | null; skill_name?: string | null; label: string; marks?: number | null; allowance?: number | null; evidence?: string | null }`
  - `SkillContribution { question_title: string; criterion_label: string; awarded: number | null; allowance: number | null; evidence: string | null }`
  - `SkillEvidenceLine { skill_id: string; skill_name: string; awarded: number | null; allowance: number | null; percent: number | null; contributions: SkillContribution[] }`
  - `SkillEvidencePaper { title: string; criteria: readonly SkillEvidenceCriterion[] }`
  - `rollUpSkillEvidence(papers): SkillEvidenceLine[]`
  - `skillEvidenceCoverage(papers): string`
  - `skillEvidenceSentence(line, context): string`
  - `skillEvidencePapers(sources, masked): SkillEvidencePaper[]`

- [ ] **Step 1: Write the failing test**

Create [scripts/prove-skill-evidence.mjs](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/prove-skill-evidence.mjs):

```js
/* scripts/prove-skill-evidence.mjs
 * Run: node --test scripts/prove-skill-evidence.mjs
 *
 * A rubric percentage is a share of the marks a question offered. Totalling it
 * per skill is arithmetic over snapshots already stored on the responses, so the
 * proof is arithmetic: sums, not averages; tagged lines only; a masked paper
 * keeps its names and loses its figures; a zero-allowance criterion is 0%, not
 * NaN.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  rollUpSkillEvidence,
  skillEvidenceCoverage,
  skillEvidencePapers,
  skillEvidenceSentence,
} from "../src/modules/assessment/domain/skillEvidence.ts";

const criterion = (overrides = {}) => ({
  label: "Criterion",
  marks: 5,
  allowance: 10,
  evidence: null,
  ...overrides,
});

test("two questions' marks for one skill are added, not averaged", () => {
  const lines = rollUpSkillEvidence([
    {
      title: "Case one",
      criteria: [
        criterion({ label: "Diagnosis", marks: 6, allowance: 10, skill_id: "s-fin", skill_name: "Financial modelling" }),
      ],
    },
    {
      title: "Case two",
      criteria: [
        criterion({ label: "Model", marks: 4, allowance: 10, skill_id: "s-fin", skill_name: "Financial modelling" }),
      ],
    },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].awarded, 10);
  assert.equal(lines[0].allowance, 20);
  assert.equal(lines[0].percent, 50);
  assert.deepEqual(lines[0].contributions.map((c) => c.question_title), ["Case one", "Case two"]);
});

test("two criteria on one question can be evidence of the same skill", () => {
  const [line] = rollUpSkillEvidence([
    {
      title: "Spreadsheet model",
      criteria: [
        criterion({ label: "Inputs", marks: 4, allowance: 5, skill_id: "s-fin", skill_name: "Financial modelling" }),
        criterion({ label: "Sensitivity", marks: 5, allowance: 5, skill_id: "s-fin", skill_name: "Financial modelling" }),
      ],
    },
  ]);
  assert.equal(line.awarded, 9);
  assert.equal(line.allowance, 10);
  assert.equal(line.contributions.length, 2);
});

test("an untagged criterion contributes to no skill", () => {
  const lines = rollUpSkillEvidence([
    { title: "Case", criteria: [criterion({ label: "Structure", marks: 4, allowance: 4 })] },
  ]);
  assert.deepEqual(lines, []);
});

test("the first non-empty snapshot name is shown, and the id survives a rename", () => {
  const lines = rollUpSkillEvidence([
    {
      title: "A",
      criteria: [criterion({ skill_id: "s-fin", skill_name: "" }), criterion({ skill_id: "s-fin", skill_name: "Financial modelling" })],
    },
    {
      title: "B",
      criteria: [criterion({ skill_id: "s-fin", skill_name: "Modelling" })],
    },
  ]);
  assert.equal(lines[0].skill_name, "Financial modelling");
  assert.equal(lines[0].skill_id, "s-fin");
});

test("a skill with no stored name falls back to its id", () => {
  const [line] = rollUpSkillEvidence([
    { title: "A", criteria: [criterion({ skill_id: "s-fin" })] },
  ]);
  assert.equal(line.skill_name, "s-fin");
});

test("a masked contribution hides the skill's figures but keeps its name and count", () => {
  const [line] = rollUpSkillEvidence([
    {
      title: "A",
      criteria: [
        criterion({ skill_id: "s-fin", skill_name: "Financial modelling", marks: 6, allowance: 10 }),
        criterion({ skill_id: "s-fin", skill_name: "Financial modelling", marks: null, allowance: null }),
      ],
    },
  ]);
  assert.equal(line.awarded, null);
  assert.equal(line.allowance, null);
  assert.equal(line.percent, null);
  assert.equal(line.skill_name, "Financial modelling");
  assert.equal(line.contributions.length, 2);
});

test("a zero allowance is 0%, not a division by zero", () => {
  const [line] = rollUpSkillEvidence([
    { title: "A", criteria: [criterion({ skill_id: "s-fin", marks: 0, allowance: 0 })] },
  ]);
  assert.equal(line.percent, 0);
});

test("lines sort by skill name, then id", () => {
  const lines = rollUpSkillEvidence([
    { title: "A", criteria: [criterion({ skill_id: "b", skill_name: "Negotiation" })] },
    { title: "A", criteria: [criterion({ skill_id: "c", skill_name: "Analysis" })] },
    { title: "A", criteria: [criterion({ skill_id: "a", skill_name: "Analysis" })] },
  ]);
  assert.deepEqual(lines.map((line) => line.skill_id), ["a", "c", "b"]);
});

test("the coverage sentence names the tagged criteria and the questions they came from", () => {
  const sentence = skillEvidenceCoverage([
    { title: "A", criteria: [criterion({ skill_id: "s1" }), criterion({})] },
    { title: "B", criteria: [criterion({ skill_id: "s2" })] },
    { title: "C", criteria: [criterion({})] },
  ]);
  assert.match(sentence, /From 2 tagged criteria on 2 questions/);
  assert.match(sentence, /not a proficiency level/);
});

test("the applicant sentence puts the test figure beside the CV levels", () => {
  const [line] = rollUpSkillEvidence([
    {
      title: "Case",
      criteria: [
        criterion({ skill_id: "s-fin", skill_name: "Financial modelling", marks: 9, allowance: 11 }),
        criterion({ skill_id: "s-fin", skill_name: "Financial modelling", marks: 7, allowance: 9 }),
      ],
    },
  ]);
  assert.equal(
    skillEvidenceSentence(line, { required_level: 4, demonstrated_level: 3 }),
    "Financial modelling · required 4 · shown 3 · test evidence 80% (2 questions)"
  );
  assert.equal(
    skillEvidenceSentence({ ...line, percent: null }, { required_level: 4, demonstrated_level: 3 }),
    "Financial modelling · required 4 · shown 3 · test evidence Hidden (2 questions)"
  );
});

test("the applicant mapper masks the criteria it hands the roll-up", () => {
  const papers = skillEvidencePapers(
    [
      {
        question_title: "Case one",
        ai_evaluation: {
          criteria: [
            { label: "Diagnosis", marks: 6, allowance: 10, skill_id: "s-fin", skill_name: "Financial modelling" },
          ],
        },
      },
    ],
    true
  );
  assert.equal(papers[0].title, "Case one");
  assert.equal(papers[0].criteria[0].marks, null);
  const [line] = rollUpSkillEvidence(papers);
  assert.equal(line.percent, null);
  assert.equal(line.skill_name, "Financial modelling");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/prove-skill-evidence.mjs`
Expected: FAIL with `Cannot find module .../src/modules/assessment/domain/skillEvidence.ts`.

- [ ] **Step 3: Write the module**

Create [src/modules/assessment/domain/skillEvidence.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/assessment/domain/skillEvidence.ts):

```ts
/**
 * What a paper's rubric marks say about each catalogue skill.
 *
 * The input is snapshots: each response carries the criteria it was marked on,
 * including the skill tag that was on the criterion when the mark was given. The
 * output is arithmetic over those snapshots and nothing else — no catalogue
 * read, no `candidate_skills` write, and no conversion to a 1–5 level. A level is
 * a proficiency claim; a percentage here is a share of the marks the questions
 * actually offered.
 */

import { awardedCriteriaOf } from "./attemptAnswers.ts";

/** One criterion as the roll-up reads it — stored snapshot or test fixture. */
export interface SkillEvidenceCriterion {
  skill_id?: string | null;
  skill_name?: string | null;
  label: string;
  marks?: number | null;
  allowance?: number | null;
  evidence?: string | null;
}

/** One question-and-criterion that contributed to a skill's total. */
export interface SkillContribution {
  question_title: string;
  criterion_label: string;
  awarded: number | null;
  allowance: number | null;
  evidence: string | null;
}

export interface SkillEvidenceLine {
  skill_id: string;
  skill_name: string;
  /** Null when any contribution's marks are withheld or unreadable. */
  awarded: number | null;
  allowance: number | null;
  /** Whole number 0–100, or null while figures are withheld. */
  percent: number | null;
  contributions: SkillContribution[];
}

export interface SkillEvidencePaper {
  title: string;
  criteria: readonly SkillEvidenceCriterion[];
}

function taggedId(criterion: SkillEvidenceCriterion): string | null {
  return typeof criterion.skill_id === "string" && criterion.skill_id.trim()
    ? criterion.skill_id.trim()
    : null;
}

function snapshotName(criterion: SkillEvidenceCriterion): string {
  return typeof criterion.skill_name === "string" ? criterion.skill_name.trim() : "";
}

/**
 * Add one figure, or lose the total.
 *
 * A missing or non-numeric mark means the snapshot cannot be totalled honestly —
 * a masked reviewer's row is exactly this. Returning null instead of skipping it
 * keeps a partial sum from being printed as a skill's whole evidence.
 */
function add(total: number | null, value: number | null | undefined): number | null {
  if (total === null || typeof value !== "number" || !Number.isFinite(value)) return null;
  return total + value;
}

export function rollUpSkillEvidence(
  papers: readonly SkillEvidencePaper[]
): SkillEvidenceLine[] {
  interface Group {
    skill_id: string;
    skill_name: string;
    awarded: number | null;
    allowance: number | null;
    contributions: SkillContribution[];
  }

  const groups = new Map<string, Group>();
  for (const paper of papers) {
    for (const criterion of paper.criteria) {
      const skillId = taggedId(criterion);
      if (!skillId) continue;
      const group: Group = groups.get(skillId) ?? {
        skill_id: skillId,
        skill_name: "",
        awarded: 0,
        allowance: 0,
        contributions: [],
      };
      if (!group.skill_name) group.skill_name = snapshotName(criterion);
      group.awarded = add(group.awarded, criterion.marks);
      group.allowance = add(group.allowance, criterion.allowance);
      group.contributions.push({
        question_title: paper.title,
        criterion_label: criterion.label,
        awarded: typeof criterion.marks === "number" ? criterion.marks : null,
        allowance: typeof criterion.allowance === "number" ? criterion.allowance : null,
        evidence: typeof criterion.evidence === "string" && criterion.evidence.trim()
          ? criterion.evidence
          : null,
      });
      groups.set(skillId, group);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      skill_name: group.skill_name || group.skill_id,
      percent:
        group.awarded === null || group.allowance === null
          ? null
          : group.allowance > 0
            ? Math.round((group.awarded / group.allowance) * 100)
            : 0,
    }))
    .sort(
      (a, b) =>
        a.skill_name.localeCompare(b.skill_name, "en") ||
        a.skill_id.localeCompare(b.skill_id, "en")
    );
}

/** What the block covers, printed beside it so a partial paper never looks whole. */
export function skillEvidenceCoverage(papers: readonly SkillEvidencePaper[]): string {
  let criteria = 0;
  let questions = 0;
  for (const paper of papers) {
    const tagged = paper.criteria.filter((criterion) => taggedId(criterion) !== null).length;
    criteria += tagged;
    if (tagged > 0) questions += 1;
  }
  return `From ${criteria} tagged ${criteria === 1 ? "criterion" : "criteria"} on ${questions} ${
    questions === 1 ? "question" : "questions"
  }. A percentage is evidence from this paper, not a proficiency level.`;
}

/** The applicant line: the test figure is additive beside the CV's own levels. */
export interface SkillEvidenceContext {
  required_level?: number | null;
  demonstrated_level?: number | null;
}

export function skillEvidenceSentence(
  line: SkillEvidenceLine,
  context: SkillEvidenceContext = {}
): string {
  const parts = [line.skill_name];
  if (context.required_level !== null && context.required_level !== undefined) {
    parts.push(`required ${context.required_level}`);
  }
  if (context.demonstrated_level !== null && context.demonstrated_level !== undefined) {
    parts.push(`shown ${context.demonstrated_level}`);
  }
  const count = `${line.contributions.length} ${
    line.contributions.length === 1 ? "question" : "questions"
  }`;
  parts.push(
    line.percent === null
      ? `test evidence Hidden (${count})`
      : `test evidence ${line.percent}% (${count})`
  );
  return parts.join(" · ");
}

/** One row of the applicant's bounded read, turned into a paper the roll-up reads. */
export interface SkillEvidenceSource {
  question_title: string | null;
  ai_evaluation: { criteria?: unknown } | null;
}

export function skillEvidencePapers(
  sources: readonly SkillEvidenceSource[],
  masked: boolean
): SkillEvidencePaper[] {
  return sources.map((source) => ({
    title: source.question_title ?? "Assessment question",
    criteria: awardedCriteriaOf(source.ai_evaluation, masked),
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/prove-skill-evidence.mjs`
Expected: PASS, all twelve tests.

- [ ] **Step 5: Prove the roll-up never reads the catalogue or writes candidate skills**

Append to the same file:

```js
test("the module is arithmetic only: it imports no server read and no writer", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    new URL("../src/modules/assessment/domain/skillEvidence.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /server-only/);
  assert.doesNotMatch(source, /candidate_skills/);
  assert.doesNotMatch(source, /from "@\/modules\/jobs/);
  assert.doesNotMatch(source, /proficiency/);
});
```

Run: `node --test scripts/prove-skill-evidence.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/assessment/domain/skillEvidence.ts scripts/prove-skill-evidence.mjs
git commit -m "feat(assessments): total a paper's marks per catalogue skill

Each skill's line is a sum of the marks its criteria offered, keeping
every contributing question. The roll-up is pure and reads only the
snapshots already stored on the responses."
```

---

### Task 3: Resolve the tag against the catalogue at the write door

**Files:**
- Create: `src/modules/assessment/domain/skillTags.ts`
- Modify: `src/app/(admin)/assessments/question-actions.ts:336-342`
- Test: `scripts/prove-skill-evidence.mjs`

**Interfaces:**
- Consumes: `RubricCriterion`, a `Readable = Pick<RestClient, "from">`.
- Produces:
  - `SkillOption { id: string; name: string }`
  - `SkillTagResolution = { ok: true; criteria: RubricCriterion[] } | { ok: false; error: string }`
  - `resolveSkillTags(restClient, criteria): Promise<SkillTagResolution>`
  - `saveQuestion` resolves tags after `resolveRubricChange`, before the template read.

**Why a local read:** `getSkillsCatalogue` lives in a module that starts with `import "server-only"`, so importing it here would make this pure module unloadable in the Node proof. One narrow `skills` read (`id, name, is_active`) is the whole dependency.

- [ ] **Step 1: Write the failing test**

Append to [scripts/prove-skill-evidence.mjs](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/prove-skill-evidence.mjs):

First add the import to the top of the file, beside the existing `skillEvidence.ts` import:

```js
import { resolveSkillTags } from "../src/modules/assessment/domain/skillTags.ts";
```

Then append:

```js
function catalogueClient(rows, error = null) {
  const reads = [];
  return {
    reads,
    from(table) {
      reads.push(table);
      return {
        select() {
          return Promise.resolve({ data: error ? null : rows, error });
        },
      };
    },
  };
}

const rubric = (overrides = {}) => ({
  label: "Diagnoses the cause",
  weight: 100,
  ...overrides,
});

test("an untagged rubric resolves without reading the catalogue", async () => {
  const client = catalogueClient([]);
  const result = await resolveSkillTags(client, [rubric()]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.criteria, [{ label: "Diagnoses the cause", weight: 100 }]);
  assert.deepEqual(client.reads, []);
});

test("an active tag is stored with the catalogue's own spelling", async () => {
  const client = catalogueClient([
    { id: "s-fin", name: "Financial modelling", is_active: true },
  ]);
  const result = await resolveSkillTags(client, [
    rubric({ skill_id: "s-fin", skill_name: "Forged name" }),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.criteria[0].skill_id, "s-fin");
  assert.equal(result.criteria[0].skill_name, "Financial modelling");
  assert.deepEqual(client.reads, ["skills"]);
});

test("an unknown tag is refused and names the criterion", async () => {
  const result = await resolveSkillTags(catalogueClient([]), [
    rubric({ skill_id: "s-gone" }),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /Diagnoses the cause/);
  assert.match(result.error, /does not hold/);
});

test("a retired tag is refused and names the skill", async () => {
  const result = await resolveSkillTags(
    catalogueClient([{ id: "s-old", name: "Legacy tooling", is_active: false }]),
    [rubric({ skill_id: "s-old" })]
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Legacy tooling/);
  assert.match(result.error, /retired/);
});

test("a catalogue read failure refuses the save rather than storing an unchecked tag", async () => {
  const result = await resolveSkillTags(
    catalogueClient(null, { message: "boom" }),
    [rubric({ skill_id: "s-fin" })]
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /boom/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/prove-skill-evidence.mjs`
Expected: FAIL with `Cannot find module .../skillTags.ts`.

- [ ] **Step 3: Write the resolver**

Create [src/modules/assessment/domain/skillTags.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/assessment/domain/skillTags.ts):

```ts
/**
 * The write door's check on a criterion's skill tag.
 *
 * The browser picks an id; the catalogue owns the name. Resolving here means a
 * criterion cannot be labelled with a skill the catalogue does not hold, and a
 * retired skill cannot be attached to new work by a stale form or a chat model.
 * Only the id is accepted from the caller — a name sent with the draft is
 * dropped, not trusted.
 *
 * This module deliberately does not import `getSkillsCatalogue`: that module is
 * server-only, and the rule is unit-tested in plain Node. One narrow `skills`
 * read is the whole dependency.
 */

import type { RestClient } from "@/lib/rest/client";
import type { RubricCriterion } from "@/types";

type Readable = Pick<RestClient, "from">;

export interface SkillOption {
  id: string;
  name: string;
}

export type SkillTagResolution =
  | { ok: true; criteria: RubricCriterion[] }
  | { ok: false; error: string };

interface CatalogueRow {
  id: string;
  name: string;
  is_active: boolean;
}

function withoutTag(criterion: RubricCriterion): RubricCriterion {
  return {
    label: criterion.label,
    weight: criterion.weight,
    ...(criterion.description ? { description: criterion.description } : {}),
  };
}

export async function resolveSkillTags(
  restClient: Readable,
  criteria: readonly RubricCriterion[]
): Promise<SkillTagResolution> {
  const ids = criteria
    .map((criterion) => criterion.skill_id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  if (ids.length === 0) {
    return { ok: true, criteria: criteria.map(withoutTag) };
  }

  const { data, error } = await restClient.from("skills").select("id, name, is_active");
  if (error) {
    return {
      ok: false,
      error: `The skills catalogue could not be read, so this rubric's skill tags were not saved: ${error.message}.`,
    };
  }

  const byId = new Map(
    ((data ?? []) as CatalogueRow[]).map((row) => [row.id, row] as const)
  );

  const resolved: RubricCriterion[] = [];
  for (const criterion of criteria) {
    const skillId = criterion.skill_id?.trim();
    if (!skillId) {
      resolved.push(withoutTag(criterion));
      continue;
    }
    const row = byId.get(skillId);
    if (!row) {
      return {
        ok: false,
        error: `“${criterion.label}” is tagged with a skill this catalogue does not hold. Pick a skill from the list, or leave the criterion untagged.`,
      };
    }
    if (row.is_active !== true) {
      return {
        ok: false,
        error: `“${criterion.label}” is tagged with “${row.name}”, which has been retired from the skills catalogue. Pick an active skill, or leave the criterion untagged.`,
      };
    }
    resolved.push({
      label: criterion.label,
      weight: criterion.weight,
      ...(criterion.description ? { description: criterion.description } : {}),
      skill_id: row.id,
      skill_name: row.name,
    });
  }

  return { ok: true, criteria: resolved };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/prove-skill-evidence.mjs`
Expected: PASS.

- [ ] **Step 5: Wire the resolver into the save**

In [src/app/(admin)/assessments/question-actions.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/assessments/question-actions.ts), import `resolveSkillTags` beside the other domain imports, then replace lines 339–342 with:

```ts
  let rubric = resolveRubricChange(draft);
  if (rubric.kind === "refuse") return { ok: false, error: rubric.error };

  const restClient = await createServerRestClient();

  // A tag is a claim about a catalogue row, so it is resolved against the
  // catalogue before anything is written. An unknown or retired id is refused
  // with the criterion and the skill named; the stored name is always the
  // catalogue's own spelling, never the one a client sent.
  if (rubric.kind === "set") {
    const tagged = await resolveSkillTags(restClient, rubric.criteria);
    if (!tagged.ok) return { ok: false, error: tagged.error };
    rubric = { kind: "set", criteria: tagged.criteria };
  }
```

Leave the template read, row construction and insert/update below this block unchanged; `buildConfig(draft, judgment, rubric)` already stores whichever criteria arrive.

- [ ] **Step 6: Run the gates on the touched surface**

Run:
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
npm run lint; echo "lint exit=$?"
```
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/assessment/domain/skillTags.ts src/app/(admin)/assessments/question-actions.ts scripts/prove-skill-evidence.mjs
git commit -m "feat(assessments): resolve a criterion's skill against the catalogue

The browser sends an id, never a name. An unknown or retired id is
refused before the question is written, and the name stored beside the
mark is always the catalogue's spelling."
```

---

### Task 4: Offer the tag in the question editor on both desks

**Files:**
- Modify: `src/app/(admin)/assessments/QuestionEditorDrawer.tsx:108-151, 224-264, 393-422, 1150-1240`
- Modify: `src/app/(admin)/assessments/actions.ts` (new read)
- Modify: `src/app/(admin)/assessments/page.tsx:1-57, 68-109`
- Modify: `src/app/(admin)/assessments/AssessmentGrid.tsx:891-917, 1235-1245`
- Modify: `src/app/(admin)/questions/actions.ts:95-171`
- Modify: `src/app/(admin)/questions/BankBoard.tsx:674-686`
- Test: `scripts/prove-rubric-review-ui.mjs`

**Interfaces:**
- Consumes: `getSkillsCatalogue(restClient)` from `src/modules/jobs/application/openingSkillsRead.ts` (server action only); `SkillOption` from `skillTags.ts`.
- Produces:
  - `getSkillTagOptions(): Promise<SkillsCatalogue>`
  - `QuestionEditorDrawer` props `skillOptions?: SkillOption[]`, `skillsNote?: string | null`
  - `RubricRow` gains `skill_id: string; skill_name: string`
  - The submit payload sends `skill_id` (or `undefined`), never `skill_name`.
  - `BankData.skills: SkillsCatalogue`

- [ ] **Step 1: Write the failing UI test**

In [scripts/prove-rubric-review-ui.mjs](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/prove-rubric-review-ui.mjs), extend the editor harness props at lines 187–199 so the editor receives a catalogue by default:

```js
    props = {
      open: true,
      onClose: () => {},
      templateId: "suite-a",
      templateName: "Guest service",
      questions: [options.question ?? rubricQuestion()],
      editable: true,
      onChanged: () => { changed++; },
      openAtId: options.openAtId === undefined ? (options.question ?? rubricQuestion()).id : options.openAtId,
      situationalAvailable: true,
      situationalNote: null,
      skillOptions: options.skillOptions ?? [
        { id: "s-fin", name: "Financial modelling" },
        { id: "s-neg", name: "Negotiation" },
      ],
      skillsNote: options.skillsNote ?? null,
    };
```

Then append these tests near the editor tests:

```js
const skillSelect = (ui, index = 1) =>
  ui.find(
    (node) =>
      node.type === "select" &&
      node.props["aria-label"] === `Skill of criterion ${index}`
  );

test("a stored skill tag comes back selected in the editor", () => {
  const question = rubricQuestion({
    config: {
      rubric: [
        { label: "Diagnoses the cause", weight: 60, description: "Names the real driver before recommending anything", skill_id: "s-fin", skill_name: "Financial modelling" },
        { label: "Protects the guest", weight: 40 },
      ],
    },
  });
  const ui = harness("editor", { question });
  assert.equal(skillSelect(ui, 1).props.value, "s-fin");
  assert.equal(skillSelect(ui, 2).props.value, "");
  ui.unmount();
});

test("choosing a skill sends its id and never a name", async () => {
  const ui = harness("editor");
  const select = skillSelect(ui, 1);
  select.props.onChange({ target: { value: "s-neg" } });
  ui.render();
  ui.type("Name of criterion 1", "Negotiates the rebooking");
  ui.type("Weight of criterion 1", "60");
  ui.type("What a strong answer shows for criterion 1", "Keeps the guest whole");
  ui.type("Name of criterion 2", "Protects the rate");
  ui.type("Weight of criterion 2", "40");
  ui.submit();
  await ui.settle();
  const [payload] = ui.saves;
  assert.equal(payload.rubric[0].skill_id, "s-neg");
  assert.equal("skill_name" in payload.rubric[0], false);
  ui.unmount();
});

test("a retired tag still reads, and is marked as one the catalogue no longer offers", () => {
  const question = rubricQuestion({
    config: {
      rubric: [
        { label: "Diagnoses the cause", weight: 100, skill_id: "s-old", skill_name: "Legacy tooling" },
      ],
    },
  });
  const ui = harness("editor", { question });
  const select = skillSelect(ui, 1);
  assert.equal(select.props.value, "s-old");
  assert.match(ui.textOf(select), /Legacy tooling/);
  ui.unmount();
});

test("an empty catalogue says tagging is unavailable and offers no select", () => {
  const ui = harness("editor", {
    skillOptions: [],
    skillsNote: "No active skills are on file, so every criterion saves untagged.",
  });
  assert.equal(
    ui.nodes().some(
      (node) => node.type === "select" && node.props["aria-label"] === "Skill of criterion 1"
    ),
    false
  );
  assert.match(ui.text(), /No active skills are on file/);
  ui.unmount();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/prove-rubric-review-ui.mjs`
Expected: FAIL — no select exists, and the payload's rubric rows have no `skill_id`.

- [ ] **Step 3: Add the catalogue read for the assessments page**

In [src/app/(admin)/assessments/actions.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/assessments/actions.ts), import `getSkillsCatalogue` from `@/modules/jobs/application/openingSkillsRead` and add beside `getQuestionTypeAvailability` (line 217):

```ts
/**
 * The active skills the rubric editor may tag, read once per page render.
 *
 * The catalogue is an authoring vocabulary, not a score: a read failure leaves
 * every rubric saveable untagged. The editor receives the active list and the
 * sentence that explains an empty one.
 */
export async function getSkillTagOptions() {
  await requireStaff("/assessments");
  const restClient = await createServerRestClient();
  return getSkillsCatalogue(restClient);
}
```

- [ ] **Step 4: Thread the catalogue through the page and the grid**

In [src/app/(admin)/assessments/page.tsx](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/assessments/page.tsx):

1. Add `getSkillTagOptions` to the import from `./actions` (line 1).
2. Add `skills` to the `Promise.all` (line 36) as the ninth entry, and to the returned object and destructuring:

```ts
  const [
    templates,
    candidates,
    options,
    questionsByTemplate,
    links,
    timeZone,
    situational,
    followUps,
    skills,
  ] = await Promise.all([
    getTemplates(),
    getAssignableCandidates(),
    getMasterOptions(),
    getQuestionsForEditor(),
    getIssuedLinks(),
    getOrganisationTimeZone(),
    getQuestionTypeAvailability(),
    getFollowUpRules(),
    getSkillTagOptions(),
  ]);

  return {
    templates,
    candidates,
    options,
    questionsByTemplate,
    links,
    timeZone,
    situational,
    followUps,
    skills,
  };
```

3. Destructure `skills` in the component and pass:

```tsx
        skillOptions={skills.skills}
        skillsNote={skills.note}
```

In [src/app/(admin)/assessments/AssessmentGrid.tsx](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/assessments/AssessmentGrid.tsx):

1. Import `type SkillOption` from `@/modules/assessment/domain/skillTags`.
2. Add to the props type and destructuring:

```ts
  skillOptions,
  skillsNote,
}: {
  ...
  /** Active catalogue skills the rubric editor may tag; empty closes tagging. */
  skillOptions: SkillOption[];
  /** Why the list is empty, printed where the select would be. */
  skillsNote: string | null;
```

3. Pass to the editor mount (line 1235):

```tsx
          skillOptions={skillOptions}
          skillsNote={skillsNote}
```

- [ ] **Step 5: Add the select to the editor**

In [src/app/(admin)/assessments/QuestionEditorDrawer.tsx](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/assessments/QuestionEditorDrawer.tsx):

1. Import `type SkillOption` from `@/modules/assessment/domain/skillTags`.
2. Change `RubricRow` (line 127) to:

```ts
interface RubricRow {
  label: string;
  weight: string;
  description: string;
  /** The catalogue id, or "" for a criterion tied to no skill. */
  skill_id: string;
  /** The stored spelling, kept only so a retired tag can still be read. */
  skill_name: string;
}
```

3. Update `blankRubricRows` and `rubricRowsFrom`:

```ts
const blankRubricRows = (): RubricRow[] =>
  Array.from({ length: MIN_RUBRIC_CRITERIA }, () => ({
    label: "",
    weight: "",
    description: "",
    skill_id: "",
    skill_name: "",
  }));
```

```ts
  return rows.map((criterion) => ({
    label: criterion.label,
    weight: String(criterion.weight),
    description: criterion.description ?? "",
    skill_id: criterion.skill_id ?? "",
    skill_name: criterion.skill_name ?? "",
  }));
```

4. Add the two props with defaults:

```ts
  situationalAvailable = true,
  situationalNote = null,
  skillOptions = [],
  skillsNote = null,
}: {
  ...
  /** Active catalogue skills a rubric criterion may name. */
  skillOptions?: SkillOption[];
  /** Why the list is empty, printed beside the rubric rows. */
  skillsNote?: string | null;
```

5. Pass them where `RubricFieldset` is mounted (around line 806):

```tsx
                skillOptions={skillOptions}
                skillsNote={skillsNote}
```

6. Extend the submit payload's rubric map (line 414):

```ts
              rubric: editing.rubric.map((row) => ({
                label: row.label,
                weight: weightNumber(row.weight),
                description: row.description,
                skill_id: row.skill_id || undefined,
              })),
```

Do not send `skill_name`; the write door owns it.

7. Extend `RubricFieldset`:

```tsx
function RubricFieldset({
  rows,
  note,
  skillOptions,
  skillsNote,
  onChange,
}: {
  rows: RubricRow[];
  note: string;
  skillOptions: SkillOption[];
  skillsNote: string | null;
  onChange: (rows: RubricRow[]) => void;
}) {
```

and add beneath the `TextArea` for the description, inside each `<li>`:

```tsx
            {skillOptions.length > 0 ? (
              <select
                value={row.skill_id}
                onChange={(e) => write(index, { skill_id: e.target.value })}
                aria-label={`Skill of criterion ${index + 1}`}
                className="w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm text-brand-ink"
              >
                <option value="">Not tied to a skill</option>
                {row.skill_id &&
                  !skillOptions.some((skill) => skill.id === row.skill_id) && (
                    <option value={row.skill_id} disabled>
                      {row.skill_name || "Retired skill"}
                    </option>
                  )}
                {skillOptions.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] leading-relaxed text-brand-ink/45">
                {skillsNote ??
                  "Skill tagging is unavailable because no active skills are on file. Every criterion still saves untagged."}
              </p>
            )}
```

8. Change the add-row click to include the new fields:

```tsx
        onClick={() =>
          onChange([
            ...rows,
            { label: "", weight: "", description: "", skill_id: "", skill_name: "" },
          ])
        }
```

- [ ] **Step 6: Give the question bank the same catalogue**

In [src/app/(admin)/questions/actions.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/questions/actions.ts):

1. Import `getSkillsCatalogue` and `type SkillsCatalogue` from `@/modules/jobs/application/openingSkillsRead`.
2. Add to `BankData`:

```ts
  /** Active skills the suite editor may tag, and why the list may be empty. */
  skills: SkillsCatalogue;
```

3. Add `skills` to the `Promise.all` and destructuring:

```ts
    situational,
    skills,
  ] = await Promise.all([
    ...
    readQuestionTypeAvailability(restClient),
    getSkillsCatalogue(restClient),
  ]);
```

4. Return it:

```ts
    situational,
    skills,
```

In [src/app/(admin)/questions/BankBoard.tsx](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/questions/BankBoard.tsx), pass at the editor mount (line 674):

```tsx
          skillOptions={data.skills.skills}
          skillsNote={data.skills.note}
```

- [ ] **Step 7: Run the UI proof and the domain proofs**

Run:
```bash
node --test scripts/prove-rubric-review-ui.mjs
node --test scripts/prove-skill-evidence.mjs
```
Expected: PASS. If the editor test cannot find a select, confirm the fieldset receives `skillOptions` from the mount and that the harness's new default is present.

- [ ] **Step 8: Run the gates**

Run:
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
npm run lint; echo "lint exit=$?"
```
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(admin)/assessments/QuestionEditorDrawer.tsx" "src/app/(admin)/assessments/actions.ts" "src/app/(admin)/assessments/page.tsx" "src/app/(admin)/assessments/AssessmentGrid.tsx" "src/app/(admin)/questions/actions.ts" "src/app/(admin)/questions/BankBoard.tsx" scripts/prove-rubric-review-ui.mjs
git commit -m "feat(assessments): let a criterion name one catalogue skill

The editor offers the active catalogue and a deliberate untagged
option, keeps a retired stored tag readable, and sends only the id —
the write door resolves the spelling."
```

---

### Task 5: Print the roll-up on the assessment answers drawer

**Files:**
- Modify: `src/app/(admin)/assessments/IssuedLinksBoard.tsx:376-542`
- Test: `scripts/prove-rubric-review-ui.mjs`

**Interfaces:**
- Consumes: `rollUpSkillEvidence`, `skillEvidenceCoverage` from `skillEvidence.ts`; the paper already returned by `getAttemptAnswers`.
- Produces: a "Skill evidence" section between `answersScopeNote(paper)` and the answers list. No additional query.

- [ ] **Step 1: Write the failing render test**

Append to the answers-desk section of [scripts/prove-rubric-review-ui.mjs](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/prove-rubric-review-ui.mjs):

```js
test("a tagged paper totals its marks per skill and keeps the contributing questions", async () => {
  const tagged = [
    { ...MARKED[0], skill_id: "s-fin", skill_name: "Financial modelling" },
    { ...MARKED[1], skill_id: "s-fin", skill_name: "Financial modelling" },
  ];
  const ui = await desk(paper([answer({ criteria: tagged })]));
  assert.match(ui.text(), /Skill evidence/);
  assert.match(ui.text(), /Financial modelling/);
  assert.match(ui.text(), /16 of 20 marks/);
  assert.match(ui.text(), /80%/);
  assert.match(ui.text(), /2 contributing questions/);
  assert.match(ui.text(), /From 2 tagged criteria on 1 question/);
  ui.unmount();
});

test("a withheld reviewer sees the skill name and count but no figures", async () => {
  const tagged = WITHHELD.map((row) => ({
    ...row,
    skill_id: "s-fin",
    skill_name: "Financial modelling",
  }));
  const ui = await desk(paper([answer({ criteria: tagged })], { scores_masked: true }));
  assert.match(ui.text(), /Financial modelling/);
  assert.match(ui.text(), /Hidden/);
  assert.doesNotMatch(ui.text(), /80%/);
  assert.doesNotMatch(ui.text(), /16 of 20/);
  ui.unmount();
});

test("an untagged paper prints no skill block", async () => {
  const ui = await desk(paper([answer({ criteria: MARKED })]));
  assert.doesNotMatch(ui.text(), /Skill evidence/);
  ui.unmount();
});
```

If the `paper()` fixture does not already accept a second argument, thread one through; its current shape builds `scores_masked: false` and can be overridden with `{ ...paper([...]), scores_masked: true }` instead:

```js
const ui = await desk({ ...paper([answer({ criteria: tagged })]), scores_masked: true });
```

Use whichever the fixture supports without changing production code.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/prove-rubric-review-ui.mjs`
Expected: FAIL — `Skill evidence` is absent.

- [ ] **Step 3: Compute the roll-up from the loaded paper**

In [src/app/(admin)/assessments/IssuedLinksBoard.tsx](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/assessments/IssuedLinksBoard.tsx):

1. Import:

```tsx
import {
  rollUpSkillEvidence,
  skillEvidenceCoverage,
  type SkillEvidencePaper,
} from "@/modules/assessment/domain/skillEvidence";
```

2. In `AnswersDrawer`, after the `reloadKey` state (around line 386), add:

```tsx
  // The paper already carries every criterion it was marked on, so the skill
  // total costs no query. A masked paper's figures arrive null and stay hidden;
  // the skill names and the contributed-question count are not scores.
  const skillPapers = useMemo<SkillEvidencePaper[]>(
    () =>
      (paper?.answers ?? []).map((answer) => ({
        title: answer.title,
        criteria: answer.criteria,
      })),
    [paper]
  );
  const skillEvidence = useMemo(() => rollUpSkillEvidence(skillPapers), [skillPapers]);
  const skillCoverage = useMemo(() => skillEvidenceCoverage(skillPapers), [skillPapers]);
```

- [ ] **Step 4: Render the block**

Insert between the scope note (line 521) and the empty-suite branch (line 523):

```tsx
          {skillEvidence.length > 0 && (
            <section className="rounded-xl border border-brand-line px-4 py-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
                Skill evidence
              </h3>
              <ul className="mt-2 space-y-2">
                {skillEvidence.map((line) => (
                  <li key={line.skill_id} className="text-xs leading-relaxed">
                    <p className="font-semibold">
                      {line.skill_name}
                      {" · "}
                      {line.percent === null ? "Hidden" : `${line.percent}%`}
                      {line.awarded !== null && line.allowance !== null
                        ? ` (${line.awarded} of ${line.allowance} marks)`
                        : ""}
                    </p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-brand-ink/60">
                        {line.contributions.length} contributing{" "}
                        {line.contributions.length === 1 ? "question" : "questions"}
                      </summary>
                      <ul className="mt-1 space-y-1">
                        {line.contributions.map((contribution, index) => (
                          <li
                            key={`${contribution.question_title}:${contribution.criterion_label}:${index}`}
                            className="text-[11px] leading-relaxed text-brand-ink/65"
                          >
                            {contribution.question_title} — {contribution.criterion_label}
                            {contribution.awarded !== null && contribution.allowance !== null
                              ? ` · ${contribution.awarded} of ${contribution.allowance}`
                              : ""}
                            {contribution.evidence ? ` — “${contribution.evidence}”` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-brand-ink/55">
                {skillCoverage}
              </p>
            </section>
          )}
```

The block sits above the answers list, after the scope note, so a recruiter reads the total before the per-question verdicts.

- [ ] **Step 5: Run the render proof**

Run: `node --test scripts/prove-rubric-review-ui.mjs`
Expected: PASS, including the three new tests.

- [ ] **Step 6: Run the gates**

Run:
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
npm run lint; echo "lint exit=$?"
```
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/assessments/IssuedLinksBoard.tsx" scripts/prove-rubric-review-ui.mjs
git commit -m "feat(assessments): show a paper's marks totalled per skill

The answers drawer already holds every criterion snapshot, so the block
costs no query. A masked reviewer keeps the names and counts and loses
only the figures."
```

---

### Task 6: Add test evidence to the expanded applicant

**Files:**
- Modify: `src/app/(admin)/jobs/applicant-actions.ts:52-65, 151-195`
- Modify: `src/app/(admin)/jobs/JobApplicantsDrawer.tsx:1-40, 395-460`
- Test: `scripts/prove-opening-skills-ui.mjs` (render), `scripts/prove-skill-evidence.mjs` (mapping is already proven)

**Interfaces:**
- Consumes: `scoresAreMaskedForCurrentUser()` (already imported in this module), `skillEvidencePapers`, `rollUpSkillEvidence`, `skillEvidenceCoverage`, `skillEvidenceSentence`.
- Produces:
  - `ApplicantSubmission.skill_evidence: SkillEvidenceLine[]`
  - `ApplicantSubmission.skill_evidence_coverage: string | null`
  - `ApplicantSubmission.skill_evidence_note: string | null`
  - One bounded read: `candidate_responses` limited to 501, sliced to 500.
  - The meets/below/no-evidence verdict is unchanged.

- [ ] **Step 1: Write the failing drawer test**

In [scripts/prove-opening-skills-ui.mjs](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/prove-opening-skills-ui.mjs), extend the applicant fixture's submission with:

```js
skill_evidence: [
  {
    skill_id: "s-fin",
    skill_name: "Financial modelling",
    awarded: 16,
    allowance: 20,
    percent: 80,
    contributions: [
      { question_title: "Case one", criterion_label: "Diagnosis", awarded: 12, allowance: 16, evidence: "names the driver" },
      { question_title: "Case two", criterion_label: "Model", awarded: 4, allowance: 4, evidence: null },
    ],
  },
],
skill_evidence_coverage: "From 2 tagged criteria on 2 questions. A percentage is evidence from this paper, not a proficiency level.",
skill_evidence_note: null,
```

Then append:

```js
test("the expanded applicant shows test evidence beside the CV level", () => {
  const ui = drawer();
  assert.match(ui.text(), /From this applicant’s tests/);
  assert.match(ui.text(), /Financial modelling · required 4 · shown 3 · test evidence 80% \(2 questions\)/);
  assert.match(ui.text(), /not a proficiency level/);
  // The CV verdict is still the CV verdict.
  assert.match(ui.text(), /meets|below|no evidence/);
  ui.unmount();
});

test("a masked applicant line hides the percentage and keeps the skill", () => {
  const ui = drawer({
    submission: {
      ...submission,
      skill_evidence: [
        {
          skill_id: "s-fin",
          skill_name: "Financial modelling",
          awarded: null,
          allowance: null,
          percent: null,
          contributions: [
            { question_title: "Case one", criterion_label: "Diagnosis", awarded: null, allowance: null, evidence: null },
            { question_title: "Case two", criterion_label: "Model", awarded: null, allowance: null, evidence: null },
          ],
        },
      ],
    },
  });
  assert.match(ui.text(), /Financial modelling · required 4 · shown 3 · test evidence Hidden \(2 questions\)/);
  assert.doesNotMatch(ui.text(), /80%/);
  ui.unmount();
});

test("a capped read says the figure covers what it read", () => {
  const ui = drawer({
    submission: {
      ...submission,
      skill_evidence_note: "Skill evidence covers the 500 most recent graded responses; this applicant has more.",
    },
  });
  assert.match(ui.text(), /500 most recent graded responses/);
  ui.unmount();
});
```

Adapt `drawer`/`submission` to the file's existing helper names; the assertions are the contract.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/prove-opening-skills-ui.mjs`
Expected: FAIL — the section and sentence are absent.

- [ ] **Step 3: Read the evidence once for the expanded applicant**

In [src/app/(admin)/jobs/applicant-actions.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/jobs/applicant-actions.ts):

1. Add imports:

```ts
import {
  rollUpSkillEvidence,
  skillEvidenceCoverage,
  skillEvidencePapers,
  type SkillEvidenceLine,
  type SkillEvidenceSource,
} from "@/modules/assessment/domain/skillEvidence";
```

2. Extend `ApplicantSubmission`:

```ts
  /** Marks this application's graded tests earned per catalogue skill. */
  skill_evidence: SkillEvidenceLine[];
  /** What the roll-up covers, in one sentence. Null when it covers nothing. */
  skill_evidence_coverage: string | null;
  /** Set when the 500-response bound was reached or the read itself failed. */
  skill_evidence_note: string | null;
```

3. Add a join reader beside `attemptTemplate`:

```ts
/** The question title from a `candidate_responses` join, singular or wrapped. */
function joinedQuestionTitle(row: Record<string, unknown>): string | null {
  const joined = row.assessment_questions;
  const question = Array.isArray(joined) ? joined[0] : joined;
  if (question && typeof question === "object" && "title" in question) {
    const title = (question as { title?: unknown }).title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  return null;
}
```

4. In `getApplicantSubmission`, after the CV links are resolved and before the return, add:

```ts
  // One bounded read, only when the recruiter opens this applicant. `limit(501)`
  // is how the read can tell 500 from "more than 500" without a count query;
  // the extra row is never mapped or printed.
  const masked = await scoresAreMaskedForCurrentUser();
  const { data: graded, error: evidenceError } = await restClient
    .from("candidate_responses")
    .select(
      "ai_evaluation, assessment_questions!inner(title), candidate_attempts!inner(application_id)"
    )
    .eq("candidate_attempts.application_id", applicationId)
    .limit(501);

  const capped = (graded?.length ?? 0) > 500;
  const sources: SkillEvidenceSource[] = (capped ? (graded ?? []).slice(0, 500) : graded ?? []).map(
    (row) => ({
      question_title: joinedQuestionTitle(row as Record<string, unknown>),
      ai_evaluation:
        (row as { ai_evaluation?: { criteria?: unknown } | null }).ai_evaluation ?? null,
    })
  );
  const skillEvidence = rollUpSkillEvidence(skillEvidencePapers(sources, masked));

  const evidenceNote = evidenceError
    ? "Skill evidence could not be read on this occasion; the CV and screening summary are unaffected."
    : capped
      ? "Skill evidence covers the 500 most recent graded responses; this applicant has more."
      : null;
```

5. Add to the returned submission:

```ts
      skill_evidence: skillEvidence,
      skill_evidence_coverage:
        skillEvidence.length > 0
          ? skillEvidenceCoverage(skillEvidencePapers(sources, masked))
          : null,
      skill_evidence_note: evidenceNote,
```

The CV path is untouched: an evidence failure sets a note and never returns `ok: false`.

- [ ] **Step 4: Render the evidence lines**

In [src/app/(admin)/jobs/JobApplicantsDrawer.tsx](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/app/(admin)/jobs/JobApplicantsDrawer.tsx):

1. Import:

```tsx
import {
  skillEvidenceSentence,
  type SkillEvidenceLine,
} from "@/modules/assessment/domain/skillEvidence";
```

2. Inside `ApplicantDetail`, beside the existing `decision`/`wrap` constants, add:

```tsx
  const matchOf = (line: SkillEvidenceLine) =>
    skillLines.find((match) => match.skill_id === line.skill_id) ?? null;
```

3. Insert between the requisition section (ends line 408) and the CV section (line 410):

```tsx
      {submission.skill_evidence.length > 0 && (
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-gold-dark">
            From this applicant’s tests
          </h4>
          <ul className="mt-2 space-y-1.5">
            {submission.skill_evidence.map((line) => {
              const match = matchOf(line);
              return (
                <li
                  key={line.skill_id}
                  className="text-xs leading-relaxed text-brand-ink/75"
                >
                  {skillEvidenceSentence(line, {
                    required_level: match?.required_level ?? null,
                    demonstrated_level: match?.demonstrated_level ?? null,
                  })}
                </li>
              );
            })}
          </ul>
          {submission.skill_evidence_coverage && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-brand-ink/50">
              {submission.skill_evidence_coverage}
            </p>
          )}
          {submission.skill_evidence_note && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
              {submission.skill_evidence_note}
            </p>
          )}
        </section>
      )}
```

Do not merge this line into `RequiredSkillLines` or change the `meets` / `below` / `no_evidence` verdict: the test sentence is separate evidence, and a skill with test marks but no CV row is still no-evidence about the CV.

- [ ] **Step 5: Run the drawer proof**

Run: `node --test scripts/prove-opening-skills-ui.mjs`
Expected: PASS, including the three new tests.

- [ ] **Step 6: Run the gates**

Run:
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
npm run lint; echo "lint exit=$?"
```
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/jobs/applicant-actions.ts" "src/app/(admin)/jobs/JobApplicantsDrawer.tsx" scripts/prove-opening-skills-ui.mjs
git commit -m "feat(jobs): put an applicant's test evidence beside their CV

The expanded submission reads at most 501 graded responses for one
application and totals their tagged criteria. The CV verdict is not
touched; the test line is additive and says what it covers."
```

---

### Task 7: Assistant parity, Guide copy, and the proofs that pin them

**Files:**
- Modify: `src/modules/assistant/domain/registry/shared.ts:657-663`
- Modify: `src/modules/assistant/domain/registry/authoring.ts:96, 116`
- Modify: `src/modules/shell/domain/pageGuide.ts:252-308`
- Test: `scripts/prove-scoring-rubric.mjs`, `scripts/prove-guide-figures.mjs`

**Interfaces:**
- Consumes: `RubricDraftRow.skill_id`.
- Produces: the assistant's `save_question` passes `skill_id` through untouched; its rubric argument copy names the tag; the Guide describes the tag and the roll-up.

- [ ] **Step 1: Write the failing tests**

Append to the assistant section of [scripts/prove-scoring-rubric.mjs](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/prove-scoring-rubric.mjs):

```js
test("the chat passes a criterion's skill id through to the write door", async () => {
  const h = registryHarness();
  const result = await h.saveQuestion({
    rubric: [
      { label: "Diagnoses the cause", weight: 40, skill_id: "s-fin" },
      { label: "Structure", weight: 60 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(h.saved[0].rubric[0].skill_id, "s-fin");
  assert.equal("skill_name" in h.saved[0].rubric[0], false);
});

test("the argument copy names the optional skill tag", () => {
  const words = registryHarness().questionArgs.rubric;
  assert.match(words, /skill_id/);
  assert.match(words, /catalogue/i);
});
```

In [scripts/prove-guide-figures.mjs](file:///D:/Nextjs%20Projects/sharm_dreams_group/scripts/prove-guide-figures.mjs), the `/assessments` pins already cover the weight total. No new numeric pin is required; the Guide test is the existing prose check plus a new assertion in `prove-scoring-rubric.mjs`:

```js
test("the Guide says a percentage is not a proficiency level", () => {
  const guide = read("src/modules/shell/domain/pageGuide.ts");
  assert.match(guide, /not a proficiency level|never a 1–5 level/);
  assert.match(guide, /skill tag|tied to a skill|names one skill/i);
});
```

(`read` is the file helper already defined at the top of the proof.)

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
node --test scripts/prove-scoring-rubric.mjs
```
Expected: the two assistant tests FAIL; the Guide test FAILS.

- [ ] **Step 3: Pass the tag through the assistant**

In [src/modules/assistant/domain/registry/shared.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/assistant/domain/registry/shared.ts), change `rubricDrafts` (line 657):

```ts
function rubricDrafts(args: ToolArgs): RubricDraftRow[] {
  return objArray(args, "rubric").map((row) => ({
    label: textField(row, "label"),
    weight: numberField(row.weight),
    description: textField(row, "description"),
    // The id only: the write door resolves the catalogue's spelling, so a chat
    // model cannot name a skill the catalogue does not hold.
    skill_id: textField(row, "skill_id"),
  }));
}
```

In [src/modules/assistant/domain/registry/authoring.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/assistant/domain/registry/authoring.ts), change the `save_question` rubric argument (line 116) to:

```ts
      rubric:
        "object[] — CASE_STUDY and VIDEO_PITCH only: the marking scheme, [{\"label\":\"Diagnoses the cause\",\"weight\":40,\"description\":\"Names the driver before proposing anything\",\"skill_id\":\"optional catalogue skill id\"}, …]. Two to six criteria, and their weights are shares of the question's marks adding to 100. A criterion may name one skill from the skills catalogue by id; the write door checks the id and stores the catalogue's own spelling. An untagged criterion contributes to no skill's report. Leave the rubric out to keep the scheme already stored; send [] to retire it.",
```

Extend the tool `description` with one sentence:

```ts
      "... A criterion may name one skill from the catalogue; the assessment report then totals the marks each skill earned across the paper.",
```

- [ ] **Step 4: Describe both halves in the Guide**

In [src/modules/shell/domain/pageGuide.ts](file:///D:/Nextjs%20Projects/sharm_dreams_group/src/modules/shell/domain/pageGuide.ts), inside the `/assessments` entry:

1. Add to `use` after the marking-scheme sentence (line 268):

```ts
      "A criterion may name one skill from the catalogue, or stay untagged. The tag is stored with the mark, so the answers drawer can total the marks each skill earned across the paper — summed, never averaged, and never turned into a 1–5 level.",
```

2. Add to `edges` after the scheme-snapshot edge (line 296):

```ts
      "Skill evidence counts only tagged criteria: an untagged criterion is evidence of something, but not of a named skill. A tag added now does not reinterpret a mark already given — regrading writes a new snapshot — and the percentage is a share of the marks the questions offered, not a proficiency level.",
      "An expanded applicant's test-evidence line sits beside the CV's required and shown levels and changes neither: a skill with test marks but no CV row is still no-evidence about the CV. The read covers at most the 500 most recent graded responses and says so when it stopped at that bound.",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
node --test scripts/prove-scoring-rubric.mjs
node --test scripts/prove-guide-figures.mjs
```
Expected: PASS.

- [ ] **Step 6: Run the gates**

Run:
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
npm run lint; echo "lint exit=$?"
```
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/assistant/domain/registry/shared.ts src/modules/assistant/domain/registry/authoring.ts src/modules/shell/domain/pageGuide.ts scripts/prove-scoring-rubric.mjs
git commit -m "feat(assistant): let a chat-written rubric carry a skill tag

The chat passes the catalogue id through the same write door, and the
Guide states what the roll-up counts and what it refuses to claim."
```

---

### Task 8: Run the full slice gate and confirm the no-migration promise

**Files:**
- No source changes unless a gate fails.
- Test: every standalone proof touched or named by this slice.

**Interfaces:**
- Consumes: the completed slice.
- Produces: evidence that all proofs pass with migrations 032–038 unapplied.

- [ ] **Step 1: Confirm Slice 1 added no migration**

Run:
```bash
git status --short
git diff --name-only HEAD~7..HEAD -- db/migrations
```
Expected: no path under `db/migrations` in the modified set. If one appears, stop — the spec forbids it.

- [ ] **Step 2: Run the domain and UI proofs**

Run:
```bash
node --test scripts/prove-skill-evidence.mjs
node --test scripts/prove-scoring-rubric.mjs
node --test scripts/prove-rubric-review-ui.mjs
node --test scripts/prove-opening-skills-ui.mjs
node --test scripts/prove-guide-figures.mjs
```
Expected: all PASS.

- [ ] **Step 3: Run the gates**

Run:
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
npm run lint; echo "lint exit=$?"
```
Expected: both exit 0.

- [ ] **Step 4: Report, do not commit a fix blanket**

If everything passes, report the claims table: each acceptance criterion 1–6 mapped to the proof that covers it, plus the files changed. Do not apply any migration and do not write `candidate_skills`. If a gate fails, fix the cause and create a new commit for the fix rather than amending.

---

## Self-Review

- **Spec coverage:** tag fields (Task 1), `readRubricDraft` id-only + write-door resolution (Tasks 1 and 3), aggregation rules (Task 2), attempt-report block with masking (Task 5), expanded applicant with bounded read and cap disclosure (Task 6), editor select and empty-catalogue behaviour (Task 4), assistant passthrough and Guide (Task 7), no migration (Task 8).
- **Acceptance criteria:** 1 → Tasks 3–4; 2 → Task 1; 3 → Task 5; 4 → Tasks 5–6; 5 → Task 6; 6 → Task 8.
- **Placeholders:** none. Every step names a file, a command, or code.
- **Type consistency:** `SkillEvidenceCriterion.marks` is nullable on purpose; `AnswerCriterion` is structurally assignable; `SkillOption` is defined once in `skillTags.ts` and imported by both editors.
- **Known trap:** the `paper()` helper in `prove-rubric-review-ui.mjs` may not take a second argument; the plan says to spread and override instead of changing production code.
