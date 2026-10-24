/* scripts/prove-opening-skills.mjs
 * Run: node --test scripts/prove-opening-skills.mjs
 *
 * A requisition's skill list is the anchor every candidate comparison is measured
 * from, so the four rules below decide what a recruiter can save, what the form
 * may hand it, and what a drawer is allowed to say. They are proved here against
 * the pure domain module — no database, no session, no provider.
 *
 *   1. what may be saved: 1..5 whole levels, catalogue ids only, one row per
 *      skill, a closed list of how each row arrived, and a bounded list;
 *   2. what may be suggested: a name found in a requirement line only because the
 *      catalogue's own spelling is there — the matcher adds no synonyms, so a
 *      suggestion is a quote a recruiter can check, not a guess;
 *   3. what may be said about a candidate: `candidate_skills` holds what screening
 *      recorded, and a missing row means nobody looked. That is printed as no
 *      evidence, never as a gap — the same reason the pipeline counts stopped
 *      being called a conversion rate.
 *   4. what the form may do to the list on the way to the writer: the same cap and
 *      the same sources, so a click cannot produce a list the save would refuse.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REQUIRED_SKILLS,
  OPENING_SKILLS_MIGRATION,
  OPENING_SKILLS_SCHEMA_NOTE,
  OPENING_SKILLS_WRITE_REFUSAL,
  applySkillSuggestions,
  matchRequiredSkills,
  readRequiredSkills,
  sameRequiredSkills,
  skillMatchSentence,
  skillMatchSummary,
  suggestSkillsFromRequirements,
  toggleRequiredSkill,
} from "../src/modules/jobs/domain/openingSkills.ts";

const CATALOGUE = [
  { id: "s-excel", name: "Excel (advanced)" },
  { id: "s-npv", name: "NPV / IRR analysis" },
  { id: "s-ats", name: "ATS / HRIS tooling" },
  { id: "s-leadership", name: "Team leadership" },
  { id: "s-revenue", name: "Revenue management" },
];

// ---------------------------------------------------------------------------
// 1. What may be saved.
// ---------------------------------------------------------------------------
test("a valid list keeps its order, its levels and its stated source", () => {
  const result = readRequiredSkills(
    [
      { skill_id: "s-leadership", required_level: 4, source: "RECRUITER" },
      { skill_id: "s-excel", required_level: 2, source: "CATALOGUE_MATCH" },
    ],
    CATALOGUE
  );
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.skills, [
    { skill_id: "s-leadership", required_level: 4, source: "RECRUITER" },
    { skill_id: "s-excel", required_level: 2, source: "CATALOGUE_MATCH" },
  ]);
});

test("an empty list is a deliberate blank, not a refusal", () => {
  const result = readRequiredSkills([], CATALOGUE);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.skills, []);
});

test("a level outside 1..5 is refused with the scale spelled out", () => {
  for (const level of [0, 6, -1]) {
    const result = readRequiredSkills([{ skill_id: "s-excel", required_level: level }], CATALOGUE);
    assert.equal(result.ok, false);
    assert.match(result.error, /1 to 5/);
  }
});

test("a fractional or non-numeric level is refused, not rounded", () => {
  for (const level of ["3", 3.5, null, {}]) {
    const result = readRequiredSkills([{ skill_id: "s-excel", required_level: level }], CATALOGUE);
    assert.equal(result.ok, false, `accepted ${JSON.stringify(level)}`);
    assert.match(result.error, /whole number/);
  }
});

test("the column default is what an omitted level means", () => {
  const result = readRequiredSkills([{ skill_id: "s-excel" }], CATALOGUE);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.skills[0].required_level, 3);
});

test("a skill that is not in the catalogue cannot be required", () => {
  const result = readRequiredSkills([{ skill_id: "s-kubernetes", required_level: 5 }], CATALOGUE);
  assert.equal(result.ok, false);
  assert.match(result.error, /s-kubernetes/);
  assert.match(result.error, /catalogue/i);
});

test("the same skill twice is refused rather than silently collapsed", () => {
  const result = readRequiredSkills(
    [
      { skill_id: "s-excel", required_level: 2 },
      { skill_id: "s-excel", required_level: 5 },
    ],
    CATALOGUE
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /once/i);
});

test("a source outside the two the portal writes is refused", () => {
  const result = readRequiredSkills(
    [{ skill_id: "s-excel", required_level: 3, source: "MODEL" }],
    CATALOGUE
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /RECRUITER/);
  assert.match(result.error, /CATALOGUE_MATCH/);
});

test("a list longer than the cap is refused by name of the cap", () => {
  const rows = Array.from({ length: MAX_REQUIRED_SKILLS + 1 }, (_, i) => ({
    skill_id: `s-${i}`,
    required_level: 3,
  }));
  const catalogue = rows.map((row) => ({ id: row.skill_id, name: row.skill_id }));
  const result = readRequiredSkills(rows, catalogue);
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(String(MAX_REQUIRED_SKILLS)));
});

test("the submitted rows are not mutated by reading them", () => {
  const rows = [{ skill_id: "s-excel", required_level: "4", source: "RECRUITER" }];
  readRequiredSkills(rows, CATALOGUE);
  assert.deepEqual(rows, [{ skill_id: "s-excel", required_level: "4", source: "RECRUITER" }]);
});

// ---------------------------------------------------------------------------
// 2. What may be suggested.
// ---------------------------------------------------------------------------
test("a requirement line that names a catalogue skill suggests exactly it", () => {
  const suggestions = suggestSkillsFromRequirements(
    ["Must be strong in Excel (advanced) modelling", "Owns revenue management for the marina"],
    CATALOGUE
  );
  assert.deepEqual(
    suggestions.map((s) => s.skill_id),
    ["s-excel", "s-revenue"]
  );
  assert.equal(suggestions[0].line, "Must be strong in Excel (advanced) modelling");
});

test("punctuation in a catalogue name is read as the catalogue wrote it", () => {
  // "NPV / IRR analysis" is one skill whose two halves are both how recruiters
  // spell it; "Excel (advanced)" is Excel with a qualifier, so the qualifier
  // never has to be typed for the skill to be found.
  assert.deepEqual(
    suggestSkillsFromRequirements(["Deep NPV and IRR analysis experience"], CATALOGUE).map((s) => s.skill_id),
    ["s-npv"]
  );
  assert.deepEqual(
    suggestSkillsFromRequirements(["Advanced Excel work"], CATALOGUE).map((s) => s.skill_id),
    ["s-excel"]
  );
});

test("a word inside a longer word is not a match", () => {
  // "ats" is a catalogue alias. "formats", "bytes" and "units" all contain it.
  assert.deepEqual(suggestSkillsFromRequirements(["Manages room formats and byte-level tickets"], CATALOGUE), []);
});

test("the matcher adds no synonyms", () => {
  // Nothing in the catalogue is named, so nothing is offered — a suggestion the
  // recruiter cannot quote back is a guess wearing a button.
  assert.deepEqual(suggestSkillsFromRequirements(["Excellent communicator and leader"], CATALOGUE), []);
});

test("a skill named on two lines is suggested once, from the first", () => {
  const suggestions = suggestSkillsFromRequirements(
    ["Team leadership of the front desk", "Proven team leadership"],
    CATALOGUE
  );
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].line, "Team leadership of the front desk");
});

// ---------------------------------------------------------------------------
// 3. What may be said about a candidate.
// ---------------------------------------------------------------------------
const REQUIRED = [
  { skill_id: "s-excel", required_level: 4, source: "RECRUITER" },
  { skill_id: "s-npv", required_level: 3, source: "RECRUITER" },
  { skill_id: "s-leadership", required_level: 5, source: "CATALOGUE_MATCH" },
];

test("required skills are compared in the requisition's own order", () => {
  const lines = matchRequiredSkills(
    REQUIRED,
    [
      { skill_id: "s-leadership", proficiency: 5 },
      { skill_id: "s-npv", proficiency: 1 },
    ],
    CATALOGUE
  );
  assert.deepEqual(
    lines.map((line) => [line.name, line.demonstrated_level, line.evidence]),
    [
      ["Excel (advanced)", null, "no_evidence"],
      ["NPV / IRR analysis", 1, "below"],
      ["Team leadership", 5, "meets"],
    ]
  );
});

test("a demonstrated level exactly at the requirement is a meet, not a shortfall", () => {
  const lines = matchRequiredSkills(REQUIRED, [{ skill_id: "s-excel", proficiency: 4 }], CATALOGUE);
  assert.equal(lines[0].evidence, "meets");
});

test("a proficiency recorded outside 1..5 is not treated as evidence", () => {
  const lines = matchRequiredSkills(REQUIRED, [{ skill_id: "s-excel", proficiency: 9 }], CATALOGUE);
  assert.equal(lines[0].demonstrated_level, null);
  assert.equal(lines[0].evidence, "no_evidence");
});

test("the summary counts the three states and nothing else", () => {
  const lines = matchRequiredSkills(
    REQUIRED,
    [
      { skill_id: "s-leadership", proficiency: 5 },
      { skill_id: "s-npv", proficiency: 1 },
    ],
    CATALOGUE
  );
  assert.deepEqual(skillMatchSummary(lines), { required: 3, meets: 1, below: 1, unevidenced: 1 });
});

test("a candidate with no recorded skills is described as unevidenced, never as missing them", () => {
  const lines = matchRequiredSkills(REQUIRED, [], CATALOGUE);
  const sentence = skillMatchSentence(lines);
  assert.match(sentence, /no skill evidence recorded/i);
  assert.doesNotMatch(sentence, /gap/i);
  assert.doesNotMatch(sentence, /missing/i);
  assert.match(sentence, /3 required skills/i);
});

test("the sentence counts what it printed", () => {
  const lines = matchRequiredSkills(
    REQUIRED,
    [
      { skill_id: "s-leadership", proficiency: 5 },
      { skill_id: "s-npv", proficiency: 1 },
    ],
    CATALOGUE
  );
  assert.equal(skillMatchSentence(lines), "Meets 1 of 3, below 1, no evidence for 1.");
});

test("an opening that requires nothing says nothing", () => {
  assert.equal(skillMatchSentence(matchRequiredSkills([], [], CATALOGUE)), "");
});

// ---------------------------------------------------------------------------
// 4. What the form may do to the list.
//
// The picker's two moves and its one comparison live here rather than in the
// component, for the reason the module's header gives: the form, the drawer and
// the assistant all read the same rules, and a cap the button ignores while the
// writer obeys is how a recruiter ends up with a list that cannot be saved.
// ---------------------------------------------------------------------------
test("checking a skill adds it at the column's own default", () => {
  const result = toggleRequiredSkill([], "s-excel");
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.skills, [
    { skill_id: "s-excel", required_level: 3, source: "RECRUITER" },
  ]);
});

test("unchecking the same skill is how it comes off again", () => {
  const before = [
    { skill_id: "s-excel", required_level: 5, source: "RECRUITER" },
    { skill_id: "s-npv", required_level: 3, source: "CATALOGUE_MATCH" },
  ];
  const result = toggleRequiredSkill(before, "s-excel");
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.skills, [
    { skill_id: "s-npv", required_level: 3, source: "CATALOGUE_MATCH" },
  ]);
});

test("a thirteenth pick is refused with the cap in its own words", () => {
  const before = CATALOGUE.concat(
    Array.from({ length: MAX_REQUIRED_SKILLS - CATALOGUE.length }, (_, i) => ({
      id: `s-more-${i}`,
      name: `Skill ${i}`,
    }))
  ).map((skill) => ({ skill_id: skill.id, required_level: 3, source: "RECRUITER" }));
  assert.equal(before.length, MAX_REQUIRED_SKILLS);
  const result = toggleRequiredSkill(before, "s-kubernetes");
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(String(MAX_REQUIRED_SKILLS)));
});

test("removing is never refused for a list that is already full", () => {
  const rows = Array.from({ length: MAX_REQUIRED_SKILLS }, (_, i) => ({
    skill_id: `s-${i}`,
    required_level: 4,
    source: "RECRUITER",
  }));
  const result = toggleRequiredSkill(rows, "s-0");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.skills.length, MAX_REQUIRED_SKILLS - 1);
});

test("a suggestion arrives as the matcher's own source, not as a recruiter's choice", () => {
  const result = applySkillSuggestions([], [
    { skill_id: "s-excel", name: "Excel (advanced)", line: "Advanced Excel work" },
  ]);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.skills, [
    { skill_id: "s-excel", required_level: 3, source: "CATALOGUE_MATCH" },
  ]);
});

test("the suggestion button cannot overwrite a level a recruiter set", () => {
  const before = [{ skill_id: "s-excel", required_level: 5, source: "RECRUITER" }];
  const result = applySkillSuggestions(before, [
    { skill_id: "s-excel", name: "Excel (advanced)", line: "Advanced Excel work" },
    { skill_id: "s-npv", name: "NPV / IRR analysis", line: "Owns the NPV model" },
  ]);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.skills, [
    { skill_id: "s-excel", required_level: 5, source: "RECRUITER" },
    { skill_id: "s-npv", required_level: 3, source: "CATALOGUE_MATCH" },
  ]);
});

test("a suggestion that would run past the cap adds nothing", () => {
  const rows = Array.from({ length: MAX_REQUIRED_SKILLS - 1 }, (_, i) => ({
    skill_id: `s-${i}`,
    required_level: 3,
    source: "RECRUITER",
  }));
  const result = applySkillSuggestions(rows, [
    { skill_id: "s-excel", name: "Excel (advanced)", line: "Advanced Excel work" },
    { skill_id: "s-npv", name: "NPV / IRR analysis", line: "Owns the NPV model" },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(String(MAX_REQUIRED_SKILLS)));
});

test("an unchanged list compares as unchanged, whatever order the two reads returned", () => {
  const a = [
    { skill_id: "s-excel", required_level: 4, source: "RECRUITER" },
    { skill_id: "s-npv", required_level: 3, source: "CATALOGUE_MATCH" },
  ];
  const b = [a[1], a[0]];
  assert.equal(sameRequiredSkills(a, b), true);
  assert.equal(sameRequiredSkills([], []), true);
  assert.equal(sameRequiredSkills(a, []), false);
});

test("a level or a source that moved is a change worth writing", () => {
  const a = [{ skill_id: "s-excel", required_level: 4, source: "RECRUITER" }];
  assert.equal(
    sameRequiredSkills(a, [{ skill_id: "s-excel", required_level: 5, source: "RECRUITER" }]),
    false
  );
  assert.equal(
    sameRequiredSkills(a, [{ skill_id: "s-excel", required_level: 4, source: "CATALOGUE_MATCH" }]),
    false
  );
});

// ---------------------------------------------------------------------------
// 5. The copy that names the file, and only this file.
// ---------------------------------------------------------------------------
test("the refusal copy names migration 037 and the table it adds", () => {
  assert.equal(OPENING_SKILLS_MIGRATION, "db/migrations/037_opening_skills.sql");
  assert.match(OPENING_SKILLS_SCHEMA_NOTE, /037_opening_skills\.sql/);
  assert.match(OPENING_SKILLS_SCHEMA_NOTE, /job_opening_skills/);
  assert.match(OPENING_SKILLS_WRITE_REFUSAL, /037_opening_skills\.sql/);
});
