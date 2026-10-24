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
import { resolveSkillTags } from "../src/modules/assessment/domain/skillTags.ts";

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
  assert.equal(lines[0].contributions.length, 2);
  assert.equal(lines[0].questionCount, 2);
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
  // Two criteria, one question: the report must not read "2 questions".
  assert.equal(line.questionCount, 1);
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
  assert.equal(line.questionCount, 1);
  assert.equal(
    skillEvidenceSentence(line, { required_level: 4, demonstrated_level: 3 }),
    "Financial modelling · required 4 · shown 3 · test evidence 80% (1 question)"
  );
  assert.equal(
    skillEvidenceSentence(
      { ...line, percent: null },
      { required_level: 4, demonstrated_level: 3, figures_withheld: true }
    ),
    "Financial modelling · required 4 · shown 3 · test evidence Hidden (1 question)"
  );
});

test("a skill's questions are counted, not its criteria", () => {
  const [line] = rollUpSkillEvidence([
    {
      title: "Case one",
      criteria: [
        criterion({ skill_id: "s-fin", skill_name: "Financial modelling" }),
        criterion({ skill_id: "s-fin", skill_name: "Financial modelling" }),
      ],
    },
    {
      title: "Case two",
      criteria: [criterion({ skill_id: "s-fin", skill_name: "Financial modelling" })],
    },
  ]);
  assert.equal(line.contributions.length, 3);
  assert.equal(line.questionCount, 2);
  assert.match(skillEvidenceSentence(line), /\(2 questions\)$/);
});

test("a retake of one question is one question, and an unidentifiable paper is its own", () => {
  const paper = (key, title) => ({
    ...(key ? { key } : {}),
    title,
    criteria: [criterion({ skill_id: "s-fin", skill_name: "Financial modelling" })],
  });

  const [retake] = rollUpSkillEvidence([paper("q-1", "Case one"), paper("q-1", "Case one")]);
  assert.equal(retake.contributions.length, 2);
  assert.equal(retake.questionCount, 1);
  // A retake is one question but two sittings, and the line must say so.
  assert.equal(retake.sittingCount, 2);
  assert.match(skillEvidenceSentence(retake), /\(1 question across 2 sittings\)$/);

  const [distinct] = rollUpSkillEvidence([paper("q-1", "Case one"), paper("q-2", "Case two")]);
  assert.equal(distinct.questionCount, 2);
  assert.equal(distinct.sittingCount, 2);
  assert.match(skillEvidenceSentence(distinct), /\(2 questions\)$/);

  // Two papers we cannot identify must not be folded into one question.
  const [keyless] = rollUpSkillEvidence([paper(null, "Case one"), paper(null, "Case one")]);
  assert.equal(keyless.questionCount, 2);
});

test("a retake's sum says which sittings of the question it covers", () => {
  const papers = [
    {
      key: "q-1",
      title: "Case one",
      criteria: [criterion({ skill_id: "s-fin", skill_name: "Financial modelling", marks: 14, allowance: 20 })],
    },
    {
      key: "q-1",
      title: "Case one",
      criteria: [criterion({ skill_id: "s-fin", skill_name: "Financial modelling", marks: 20, allowance: 20 })],
    },
  ];
  const [line] = rollUpSkillEvidence(papers);
  assert.equal(line.awarded, 34);
  assert.equal(line.allowance, 40);
  assert.equal(line.percent, 85);
  assert.equal(line.questionCount, 1);
  assert.equal(line.sittingCount, 2);
  assert.equal(
    skillEvidenceSentence(line),
    "Financial modelling · test evidence 85% (1 question across 2 sittings)"
  );
  assert.match(skillEvidenceCoverage(papers), /From 2 tagged criteria on 1 question across 2 sittings/);
});

test("a withheld figure wins over a percentage that is still present", () => {
  const [line] = rollUpSkillEvidence([
    {
      title: "Case",
      criteria: [
        criterion({ skill_id: "s-fin", skill_name: "Financial modelling", marks: 17, allowance: 20 }),
      ],
    },
  ]);
  assert.equal(line.percent, 85);
  assert.equal(
    skillEvidenceSentence(line, { figures_withheld: true }),
    "Financial modelling · test evidence Hidden (1 question)"
  );
});

test("a null percentage says no mark on file unless the figures are withheld", () => {
  const [line] = rollUpSkillEvidence([
    {
      title: "Case",
      criteria: [
        criterion({ skill_id: "s-fin", skill_name: "Financial modelling", marks: null, allowance: null }),
      ],
    },
  ]);
  assert.equal(line.percent, null);
  const unreadable = skillEvidenceSentence(line, { figures_withheld: false });
  assert.match(unreadable, /test evidence no mark on file \(1 question\)/);
  assert.doesNotMatch(unreadable, /Hidden/);
  assert.equal(
    skillEvidenceSentence(line, { figures_withheld: true }),
    "Financial modelling · test evidence Hidden (1 question)"
  );
});

test("the coverage sentence counts a retake once, the way a line does, and names its sittings", () => {
  const papers = [
    { key: "q-1", title: "Case one", criteria: [criterion({ skill_id: "s1" }), criterion({ skill_id: "s2" })] },
    { key: "q-1", title: "Case one", criteria: [criterion({ skill_id: "s1" })] },
  ];
  assert.match(skillEvidenceCoverage(papers), /From 3 tagged criteria on 1 question across 2 sittings/);
  const [first] = rollUpSkillEvidence(papers);
  assert.equal(first.skill_id, "s1");
  assert.equal(first.questionCount, 1);
  assert.equal(first.sittingCount, 2);
});

test("the applicant mapper carries the question id into the paper's key", () => {
  const papers = skillEvidencePapers(
    [
      {
        question_id: "q-7",
        question_title: "Case one",
        ai_evaluation: {
          criteria: [
            { label: "Diagnosis", marks: 6, allowance: 10, skill_id: "s-fin", skill_name: "Financial modelling" },
          ],
        },
      },
    ],
    false
  );
  assert.equal(papers[0].key, "q-7");
  assert.equal(papers[0].title, "Case one");
  const [line] = rollUpSkillEvidence(papers);
  assert.equal(line.questionCount, 1);
});

test("the applicant mapper masks the criteria it hands the roll-up", () => {
  const papers = skillEvidencePapers(
    [
      {
        question_id: "q-1",
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

test("the module is arithmetic only: it imports no server read and no writer", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    new URL("../src/modules/assessment/domain/skillEvidence.ts", import.meta.url),
    "utf8"
  );
  // The module's own doc comment and coverage sentence name both banned words
  // on purpose ("no candidate_skills write", "not a proficiency level"), so the
  // scan drops comments and printed copy and reads only the code.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const identifiers = code.replace(/`[\s\S]*?`/g, '""').replace(/"[^"]*"/g, '""');
  assert.doesNotMatch(code, /server-only/);
  assert.doesNotMatch(code, /candidate_skills/);
  assert.doesNotMatch(code, /from "@\/modules\/jobs/);
  assert.doesNotMatch(identifiers, /proficiency/);
});

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
