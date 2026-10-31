/* scripts/prove-candidate-shortlist.mjs
 * Run: node --test scripts/prove-candidate-shortlist.mjs
 *
 * A shortlist is a number attached to a person, so the rules below exist to keep
 * it from becoming more than the signals behind it can carry. They are proved
 * against the pure domain module — no database, no session, no provider.
 *
 *   1. what may be ranked on: only the five signals the portal already stores for
 *      one application — the AI screening score, the requisition's skill evidence,
 *      the viability gate, the newest graded paper, the interview panel average.
 *      The module reads none of them itself; a caller hands them over.
 *   2. no evidence is never a zero. A CV nobody screened is a fact about the
 *      paperwork, exactly like the applicants drawer's "no evidence" line, so a
 *      missing component drops out of the score and its weight redistributes.
 *   3. a number the caller may not read cannot rank anyone. Scores are masked for
 *      a reviewer before the sort in the reports reader; the same rule runs here,
 *      and the line says the component was withheld rather than quiet about it.
 *   4. a failed gate question sorts a person below everyone who passed, and keeps
 *      them on the page. A row the database holds has to be visible to be refused.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  APPLICANT_ORDERS,
  DEFAULT_APPLICANT_ORDER,
  ORDER_PARAM,
  RANKED_ORDER,
  applicantOrderFromParams,
  rankedApplicantsHref,
} from "../src/modules/jobs/domain/applicantOrder.ts";
import {
  SHORTLIST_COMPONENTS,
  SHORTLIST_LIMIT,
  SHORTLIST_WEIGHTS,
  isRankable,
  rankApplicants,
  shortlistBasisNote,
  shortlistReason,
} from "../src/modules/jobs/domain/shortlist.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

/** The smallest row that still carries a signal, so each test changes one thing. */
function applicant(over = {}) {
  return {
    applicationId: "a-1",
    name: "Rana Hassan",
    stage: "NEW",
    aiScore: null,
    skills: null,
    gate: null,
    test: null,
    interview: null,
    ...over,
  };
}

const NO_MASKING = { scoresHidden: false };

// ————————————————————————————————————————————————————————————————————————————
// the vocabulary
// ————————————————————————————————————————————————————————————————————————————

test("the components are a closed list, and each has a weight", () => {
  assert.deepEqual([...SHORTLIST_COMPONENTS], ["ai", "skills", "test", "interview"]);
  assert.deepEqual(Object.keys(SHORTLIST_WEIGHTS).sort(), ["ai", "interview", "skills", "test"]);
  const total = SHORTLIST_COMPONENTS.reduce((sum, key) => sum + SHORTLIST_WEIGHTS[key], 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights must sum to 1, got ${total}`);
  for (const key of SHORTLIST_COMPONENTS) {
    assert.ok(SHORTLIST_WEIGHTS[key] > 0, `${key} must carry some weight`);
  }
});

test("the read is bounded, and the bound is a number the surface can quote", () => {
  assert.equal(typeof SHORTLIST_LIMIT, "number");
  assert.ok(SHORTLIST_LIMIT >= 50, "a shortlist under 50 applicants is not a shortlist");
});

// ————————————————————————————————————————————————————————————————————————————
// rule 2 — no evidence is never a zero
// ————————————————————————————————————————————————————————————————————————————

test("one visible component is scored on that component alone", () => {
  const [line] = rankApplicants([applicant({ aiScore: 72 })], NO_MASKING);
  assert.equal(line.score, 72, "the AI score is already a percentage, so it passes through");
  assert.deepEqual(line.basis, ["ai"]);
  assert.deepEqual(line.missing, ["skills", "test", "interview"]);
});

test("a missing component does not drag anyone down", () => {
  const ranked = new Map(
    rankApplicants(
      [
        applicant({ applicationId: "only-ai", aiScore: 72 }),
        applicant({
          applicationId: "ai-plus-empty",
          aiScore: 72,
          // an opening with no required skills is not a person with no skills
          skills: { required: 0, meets: 0, below: 0, unevidenced: 0 },
        }),
      ],
      NO_MASKING
    ).map((line) => [line.applicationId, line])
  );
  assert.equal(ranked.get("only-ai").score, ranked.get("ai-plus-empty").score);
  assert.deepEqual(ranked.get("ai-plus-empty").basis, ["ai"]);
});

test("weights redistribute over what is present, so the scale stays 0..100", () => {
  // ai (0.35) and a half-marked paper (0.20) are the only evidence, so their
  // weights divide 0.55 between them: (0.35*100 + 0.20*50) / 0.55 = 81.8.
  // A flat average would silently treat a test result as worth as much as the
  // screening score, which is not what the weights say.
  const [half] = rankApplicants(
    [applicant({ aiScore: 100, test: { score: 50, max: 100, graded: true } })],
    NO_MASKING
  );
  assert.deepEqual(half.basis, ["ai", "test"]);
  assert.equal(half.score, 82);
});

test("every component missing leaves no score at all, not a zero", () => {
  const [line] = rankApplicants([applicant()], NO_MASKING);
  assert.equal(line.score, null, "an applicant with nothing readable is not a 0% match");
  assert.deepEqual(line.basis, []);
});

test("nobody has any evidence, so the list is not rankable and says so", () => {
  const lines = rankApplicants([applicant({ applicationId: "a" }), applicant({ applicationId: "b" })], NO_MASKING);
  assert.equal(isRankable(lines), false);
  assert.match(shortlistBasisNote(lines), /cannot be ranked/i);
});

// ————————————————————————————————————————————————————————————————————————————
// each component's own arithmetic
// ————————————————————————————————————————————————————————————————————————————

test("skill evidence is the share of the requisition's list that is met", () => {
  const [line] = rankApplicants(
    [applicant({ skills: { required: 4, meets: 3, below: 1, unevidenced: 0 } })],
    NO_MASKING
  );
  assert.deepEqual(line.basis, ["skills"]);
  assert.equal(line.score, 75, "3 of 4 required skills met");
});

test("a skill the requisition asks for that nobody recorded is not a gap", () => {
  const [line] = rankApplicants(
    [applicant({ skills: { required: 4, meets: 0, below: 0, unevidenced: 4 } })],
    NO_MASKING
  );
  assert.equal(line.score, null, "four unevidenced asks are no evidence, not a score of nil");
  assert.ok(line.missing.includes("skills"));
});

test("a test answer is scored as a fraction of what the paper was worth", () => {
  const [line] = rankApplicants(
    [applicant({ test: { score: 30, max: 120, graded: true } })],
    NO_MASKING
  );
  assert.equal(line.score, 25);
});

test("an unmarked or impossible paper is not a signal", () => {
  for (const test_ of [
    { score: 0, max: 100, graded: false },
    { score: null, max: 100, graded: true },
    { score: 50, max: 0, graded: true },
    null,
  ]) {
    const [line] = rankApplicants([applicant({ test: test_ })], NO_MASKING);
    assert.equal(line.score, null, `${JSON.stringify(test_)} must contribute nothing`);
  }
});

test("the panel average lands on the 1..5 scale the scorecard is written on", () => {
  const [worst] = rankApplicants([applicant({ interview: { average: 1, panel: 2 } })], NO_MASKING);
  const [best] = rankApplicants([applicant({ interview: { average: 5, panel: 2 } })], NO_MASKING);
  assert.equal(worst.score, 0, "a panel that rated 1 of 5 is a real bottom, not missing data");
  assert.equal(best.score, 100);
  const [none] = rankApplicants([applicant({ interview: { average: null, panel: 0 } })], NO_MASKING);
  assert.equal(none.score, null, "no scorecards filed is no evidence");
});

test("an AI score outside its own range is clamped, never trusted", () => {
  const [high] = rankApplicants([applicant({ aiScore: 148 })], NO_MASKING);
  const [low] = rankApplicants([applicant({ aiScore: -6 })], NO_MASKING);
  assert.equal(high.score, 100);
  assert.equal(low.score, 0);
});

// ————————————————————————————————————————————————————————————————————————————
// rule 3 — a number the caller may not read cannot rank anyone
// —————————————————————————————————————————————————————————————————————————──

test("masked scores leave the AI, the paper and the panel out of the ranking", () => {
  const [line] = rankApplicants(
    [
      applicant({
        aiScore: 90,
        test: { score: 100, max: 100, graded: true },
        interview: { average: 5, panel: 3 },
        skills: { required: 2, meets: 1, below: 1, unevidenced: 0 },
      }),
    ],
    { scoresHidden: true }
  );
  assert.deepEqual(line.basis, ["skills"], "only the skill evidence survives masking");
  assert.deepEqual(line.hidden, ["ai", "test", "interview"]);
  assert.equal(line.score, 50);
});

test("a masked caller is told the ranking is narrower, in the header", () => {
  const lines = rankApplicants(
    [applicant({ applicationId: "a", aiScore: 90, skills: { required: 2, meets: 1, below: 1, unevidenced: 0 } })],
    { scoresHidden: true }
  );
  assert.match(shortlistBasisNote(lines), /withheld from your account/i);
});

test("masking is decided by the caller, and never by the data being absent", () => {
  const [shown] = rankApplicants([applicant({ aiScore: 90 })], NO_MASKING);
  const [hidden] = rankApplicants([applicant({ aiScore: 90 })], { scoresHidden: true });
  assert.deepEqual(shown.hidden, []);
  assert.deepEqual(
    hidden.missing,
    ["skills"],
    "a withheld component is never also missing — the two lists stay disjoint"
  );
  assert.equal(shown.score, 90);
  assert.equal(hidden.score, null);
});

// ———————————————————————————————————————————————————————————————————————————─
// rule 4 — the gate
// —————————————————————————————————————————————————————————————————————————──

test("a failed gate question sorts below everyone who passed, and stays on the page", () => {
  const lines = rankApplicants(
    [
      applicant({ applicationId: "failed-gate", aiScore: 95, gate: { passed: 1, failed: 1 } }),
      applicant({ applicationId: "passed-gate", aiScore: 20, gate: { passed: 2, failed: 0 } }),
    ],
    NO_MASKING
  );
  assert.deepEqual(lines.map((line) => line.applicationId), ["passed-gate", "failed-gate"]);
  assert.equal(lines[1].gateFailed, true);
  assert.equal(lines[1].score, 95, "the ranking number is not rewritten to hide the refusal");
});

test("a gate nobody asked is no gate failure", () => {
  for (const gate of [null, { passed: 0, failed: 0 }]) {
    const [line] = rankApplicants([applicant({ gate })], NO_MASKING);
    assert.equal(line.gateFailed, false, `${JSON.stringify(gate)} must not disqualify anyone`);
  }
});

test("the gate is a marker, not one of the weighted components", () => {
  const [line] = rankApplicants([applicant({ aiScore: 60, gate: { passed: 3, failed: 1 } })], NO_MASKING);
  assert.deepEqual(line.basis, ["ai"], "passing three gates is not a fourth score");
  assert.equal(line.score, 60);
});

// —————————————————————————————————————————————————──────────────────────────
// the printed line
// —————————————————————————————————————————————————————————————————————————──

test("the reason names the components used and how many were never there", () => {
  const [line] = rankApplicants(
    [applicant({ applicationId: "a", aiScore: 80, skills: { required: 5, meets: 4, below: 1, unevidenced: 0 } })],
    NO_MASKING
  );
  const printed = shortlistReason(line);
  assert.match(printed, /AI screening/);
  assert.match(printed, /skills/);
  assert.match(printed, /no evidence for 2 of them|2 without evidence/i);
});

test("an unranksble line prints what is missing instead of a bare dash", () => {
  const [line] = rankApplicants([applicant({})], NO_MASKING);
  assert.match(shortlistReason(line), /nothing recorded/i);
});

// —————————————————————————————————————————————————————————————————──────────
// ordering, deterministically
// —————————————————————————————————───────────────────────────────────────────

test("ties put the better-evidenced applicant first, then the name, then the id", () => {
  const lines = rankApplicants(
    [
      applicant({ applicationId: "z-thin", name: "Yara", aiScore: 60 }),
      applicant({ applicationId: "a-wide", name: "Amir", aiScore: 60, test: { score: 60, max: 100, graded: true } }),
      applicant({ applicationId: "m-thin", name: "Maya", aiScore: 60 }),
    ],
    NO_MASKING
  );
  assert.deepEqual(lines.map((line) => line.applicationId), ["a-wide", "m-thin", "z-thin"]);
});

test("the same rows in a different arrival order come out the same way round", () => {
  const rows = [
    applicant({ applicationId: "a", name: "Aya", aiScore: 40 }),
    applicant({ applicationId: "b", name: "Boba", aiScore: 90 }),
    applicant({ applicationId: "c", name: "Cem", aiScore: 40, skills: { required: 1, meets: 1, below: 0, unevidenced: 0 } }),
  ];
  const forward = rankApplicants(rows, NO_MASKING).map((line) => line.applicationId);
  const backward = rankApplicants([...rows].reverse(), NO_MASKING).map((line) => line.applicationId);
  assert.deepEqual(forward, backward);
});

test("a score is printed whole, because half a match is not a thing", () => {
  const [line] = rankApplicants(
    [applicant({ aiScore: 73, test: { score: 41, max: 97, graded: true } })],
    NO_MASKING
  );
  assert.equal(Number.isInteger(line.score), true, `expected an integer, got ${line.score}`);
});

// ————————————————————————————————————————————————————————————————————————————
// the reader's own arithmetic: a raw applications row -> the signals above
//
// The action that fetches rows cannot be proved without a database, but the
// mapping it cannot get wrong can: which column becomes which component, and what
// a masked account is allowed to carry across the wire.
// ———————————————————————————————————————————————————————————————————————————─

const { shortlistSignals } = await import("../src/modules/jobs/domain/shortlist.ts");

/** The smallest row the REST embed returns for one applicant. */
function rawRow(over = {}) {
  return {
    id: "app-1",
    full_name: "Rana Hassan",
    stage: "NEW",
    ai_match_score: null,
    candidate_skills: [],
    candidate_attempts: [],
    gate_answers: null,
    interview_schedules: [],
    ...over,
  };
}

test("a graded paper is the test component, and a submitted one is not", () => {
  const graded = shortlistSignals(
    rawRow({ candidate_attempts: [{ status: "GRADED", total_score: 40, max_score: 80 }] }),
    []
  );
  assert.deepEqual(graded.test, { score: 40, max: 80, graded: true });

  const pending = shortlistSignals(
    rawRow({ candidate_attempts: [{ status: "SUBMITTED", total_score: null, max_score: 80 }] }),
    []
  );
  assert.equal(pending.test.graded, false, "an answer nobody marked is not a score");
});

test("the newest graded paper wins, not the first row the embed returned", () => {
  const signals = shortlistSignals(
    rawRow({
      candidate_attempts: [
        { status: "SUBMITTED", total_score: null, max_score: 80, created_at: "2026-01-01" },
        { status: "GRADED", total_score: 70, max_score: 80, created_at: "2026-03-03" },
        { status: "GRADED", total_score: 20, max_score: 80, created_at: "2026-02-02" },
      ],
    }),
    []
  );
  assert.deepEqual(signals.test, { score: 70, max: 80, graded: true });
});

test("a paper worth no marks cannot be a fraction of anything", () => {
  const signals = shortlistSignals(
    rawRow({ candidate_attempts: [{ status: "GRADED", total_score: 30, max_score: 0 }] }),
    []
  );
  assert.equal(signals.test.max, 0);
  const [line] = rankApplicants([signals], NO_MASKING);
  assert.ok(!line.basis.includes("test"), "0 max is no evidence, not an infinite percentage");
});

test("gate answers count as passed and failed, and no answers is no gate", () => {
  const failed = shortlistSignals(
    rawRow({
      gate_answers: [
        { question: "Shift work?", answer: "Yes", passed: true },
        { question: "Notice period?", answer: "6 months", passed: false },
      ],
    }),
    []
  );
  assert.deepEqual(failed.gate, { passed: 1, failed: 1 });

  for (const value of [null, undefined, "[]", "{}"]) {
    assert.equal(shortlistSignals(rawRow({ gate_answers: value }), []).gate, null);
  }
});

test("a gate answer that is not the shape the column writes is skipped, not guessed", () => {
  const signals = shortlistSignals(
    rawRow({ gate_answers: [{ question: "broken" }, { question: "ok", answer: "y", passed: true }] }),
    []
  );
  assert.deepEqual(signals.gate, { passed: 1, failed: 0 });
});

test("the requisition's skill list decides the denominator, not the applicant's rows", () => {
  const required = [
    { skill_id: "s-excel", required_level: 3, source: "RECRUITER" },
    { skill_id: "s-sql", required_level: 2, source: "RECRUITER" },
  ];
  const signals = shortlistSignals(
    rawRow({ candidate_skills: [{ skill_id: "s-excel", proficiency: 4 }] }),
    required
  );
  assert.deepEqual(signals.skills, { required: 2, meets: 1, below: 0, unevidenced: 1 });
});

test("a skill the applicant shows above the level asked for still counts as met", () => {
  const signals = shortlistSignals(
    rawRow({ candidate_skills: [{ skill_id: "s-sql", proficiency: 5 }] }),
    [{ skill_id: "s-sql", required_level: 2, source: "RECRUITER" }]
  );
  assert.equal(signals.skills.meets, 1);
});

test("an opening that asks for no skills leaves the skills component out", () => {
  const signals = shortlistSignals(rawRow({ candidate_skills: [{ skill_id: "s-x", proficiency: 3 }] }), []);
  assert.equal(signals.skills, null, "no requisition list is not a list of zero length");
});

test("panel averages come from every schedule the applicant has, and no cards is no signal", () => {
  const signals = shortlistSignals(
    rawRow({
      interview_schedules: [
        {
          id: "i-1",
          interview_scorecards: [
            { technical: 5, communication: 4, problem_solving: 5, culture: 4 },
            { technical: 3, communication: 3, problem_solving: 3, culture: 3 },
          ],
        },
      ],
    }),
    []
  );
  assert.equal(signals.interview.panel, 2, "two scorecards filed");
  assert.ok(signals.interview.average !== null);

  const empty = shortlistSignals(rawRow({ interview_schedules: [{ id: "i-1", interview_scorecards: [] }] }), []);
  assert.equal(empty.interview.average, null);
  assert.equal(empty.interview.panel, 0);
});

test("a database without the scorecard embed reads as no panel, not as a crash", () => {
  for (const value of [undefined, null, "not-an-array"]) {
    const signals = shortlistSignals(rawRow({ interview_schedules: value }), []);
    assert.deepEqual(signals.interview, { average: null, panel: 0 });
  }
});

test("a masked account never carries the figures across the wire", () => {
  const signals = shortlistSignals(
    rawRow({
      ai_match_score: 88,
      candidate_attempts: [{ status: "GRADED", total_score: 70, max_score: 80 }],
      interview_schedules: [
        { id: "i-1", interview_scorecards: [{ technical: 5, communication: 5, problem_solving: 5, culture: 5 }] },
      ],
      candidate_skills: [{ skill_id: "s-sql", proficiency: 2 }],
    }),
    [{ skill_id: "s-sql", required_level: 4, source: "RECRUITER" }]
  );
  const hidden = shortlistSignals(
    rawRow({
      ai_match_score: 88,
      candidate_attempts: [{ status: "GRADED", total_score: 70, max_score: 80 }],
      interview_schedules: [
        { id: "i-1", interview_scorecards: [{ technical: 5, communication: 5, problem_solving: 5, culture: 5 }] },
      ],
      candidate_skills: [{ skill_id: "s-sql", proficiency: 2 }],
    }),
    [{ skill_id: "s-sql", required_level: 4, source: "RECRUITER" }],
    { scoresHidden: true }
  );
  assert.equal(signals.aiScore, 88);
  assert.equal(hidden.aiScore, null, "the screening number is not sent to a masked account");
  assert.equal(hidden.test, null);
  assert.equal(hidden.interview.average, null);
  assert.deepEqual(
    hidden.skills,
    { required: 1, meets: 0, below: 1, unevidenced: 0 },
    "skill evidence is a count of names, so it survives masking — as it does in the drawer"
  );
});

test("what the row says about the person is never invented", () => {
  const signals = shortlistSignals(rawRow({ full_name: null, stage: null, id: "app-9" }), []);
  assert.equal(signals.name, "");
  assert.equal(signals.stage, "NEW", "a stage the row does not carry is the stage the column defaults to");
  assert.equal(signals.applicationId, "app-9");
});

// ————————————————————————————————————————————————————————————————————————————
// the address that asks for the order
// ————————————————————————————————————————————————————————————————————————————

test("the order vocabulary is the two the drawer offers, and only those", () => {
  assert.deepEqual([...APPLICANT_ORDERS], ["newest", "ranked"]);
  assert.equal(DEFAULT_APPLICANT_ORDER, "newest", "the read's own order needs no second request");
  assert.equal(RANKED_ORDER, "ranked");
  assert.equal(ORDER_PARAM, "order");
});

test("an address asks for an order in one spelling, and a bad token falls back", () => {
  assert.equal(applicantOrderFromParams(null), "newest");
  assert.equal(applicantOrderFromParams(new URLSearchParams("")), "newest");
  assert.equal(applicantOrderFromParams(new URLSearchParams("order=newest")), "newest");
  assert.equal(applicantOrderFromParams(new URLSearchParams("order=ranked")), "ranked");
  assert.equal(applicantOrderFromParams(new URLSearchParams("order=sort")), "newest");
  assert.equal(applicantOrderFromParams(new URLSearchParams("order=")), "newest");
  // The server hands `searchParams` a repeated key as an array; the first one wins,
  // which is the same rule as the URL's own first value.
  assert.equal(applicantOrderFromParams({ order: ["ranked", "newest"] }), "ranked");
  assert.equal(applicantOrderFromParams({ order: undefined }), "newest");
});

test("the ranked address opens that opening, and reads back as the order it wrote", () => {
  assert.equal(rankedApplicantsHref("job-7"), "/jobs?job=job-7&order=ranked");
  const odd = rankedApplicantsHref("job 7/ü&x");
  assert.equal(odd, `/jobs?job=${encodeURIComponent("job 7/ü&x")}&order=ranked`);
  // Writer and reader are the same spelling: a link the chat builds is a link the
  // grid understands, or the click lands on newest-first while the answer said ranked.
  assert.equal(applicantOrderFromParams(new URLSearchParams(odd.split("?")[1])), "ranked");
});

test("the grid reads the order the address names, and seeds the drawer with it", () => {
  const browser = read("src/app/(admin)/jobs/JobsBrowser.tsx");
  assert.match(browser, /applicantOrderFromParams\(params\)/);
  assert.match(
    browser,
    /order === RANKED_ORDER \? \(jobs\.find\(\(job\) => job\.id === focusId\) \?\? null\) : null/,
    "a ranked link opens the drawer; a plain ?job= link only rings the card"
  );
  assert.match(browser, /initialOrder=\{order\}/);
});

test("the drawer's first order is the one the address asked for", () => {
  const drawer = read("src/app/(admin)/jobs/JobApplicantsDrawer.tsx");
  assert.match(drawer, /initialOrder = DEFAULT_APPLICANT_ORDER/);
  assert.match(drawer, /useState<ApplicantOrder>\(initialOrder\)/);
  assert.doesNotMatch(
    drawer,
    /useState<ApplicantOrder>\("newest"\)/,
    "a drawer opened from a ranked link must not open on the other list"
  );
});

test("the chat's ranking link carries the order it promised", () => {
  const links = read("src/modules/assistant/domain/links.ts");
  assert.match(links, /rankedApplicantsHref/);
  assert.match(links, /case "rank_candidates"/);
});
