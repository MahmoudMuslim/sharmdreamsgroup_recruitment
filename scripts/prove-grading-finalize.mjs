/* scripts/prove-grading-finalize.mjs
 * Run: node --experimental-strip-types scripts/prove-grading-finalize.mjs
 *
 * A paper the submit route marks itself — quizzes, situational judgment scenes
 * and gate questions — needs no model. The grading engine used to return
 * before finalizing when AI was switched off, so a fully marked paper stayed
 * SUBMITTED forever on such a deployment and a suite's second-test rule, which
 * fires on the crossing into GRADED, never ran.
 *
 * What can be pinned without a database:
 *
 *   1. the arithmetic — when a stored set of marks is a finished paper, and
 *      what it totals, now that the answer lives in a pure domain module;
 *   2. the engine's order — the AI switch no longer stands in front of the
 *      finalize step, and the AI-on path still grades before it finalizes;
 *   3. the desk — the report's run and the assistant's tool reach the engine
 *      when nothing is left to score, and only a submitted paper may be closed;
 *   4. the sweep — which submitted papers the scheduled pass visits, now that
 *      it closes fully marked papers and leaves parked answers alone;
 *   5. the doors — the submit route and the console's retry both reach the
 *      same function, so the fix is not stranded behind one entry point.
 *
 * (2)–(5) are text assertions, deliberately: the engine imports
 * `server-only` and writes through REST, so it cannot be imported by a plain
 * Node process. They catch the files being edited apart.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { attemptTotalsFrom } from "../src/modules/assessment/domain/attemptTotals.ts";
import { sweepCandidates } from "../src/modules/assessment/domain/sweepSelection.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Line endings differ by checkout (CRLF on Windows), and two assertions here
// span lines; compare the text with one normal form.
const read = (rel) =>
  readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const engine = read("src/modules/assessment/application/gradeAttempt.ts");
const submitRoute = read("src/app/api/attempt/[token]/submit/route.ts");
const consoleActions = read("src/app/(admin)/candidates/assessment-actions.ts");

// ---------------------------------------------------------------------------
// 1. What a set of stored marks adds up to
// ---------------------------------------------------------------------------
const finished = attemptTotalsFrom([
  { score: 10, max_score: 10 },
  { score: 3, max_score: 5 },
  { score: 0, max_score: 5 },
]);
check(
  "every marked response is a finished paper",
  finished.complete === true && finished.unscored === 0,
  JSON.stringify(finished)
);
check(
  "the marks are summed as stored",
  finished.total === 13 && finished.max === 20,
  `${finished.total} of ${finished.max}`
);
check("the response count is the row count", finished.responses === 3);

const waiting = attemptTotalsFrom([
  { score: 10, max_score: 10 },
  { score: null, max_score: 10 },
]);
check("one unmarked response keeps the paper open", waiting.complete === false);
check("the unmarked response is counted", waiting.unscored === 1);
check(
  "an unmarked response contributes no marks yet",
  waiting.total === 10 && waiting.max === 20,
  `${waiting.total} of ${waiting.max}`
);

const parked = attemptTotalsFrom([{ score: null, max_score: 20 }]);
check("a paper parked for review is not finished", parked.complete === false);
check("a parked paper still knows its possible marks", parked.max === 20);

check("no responses is not a finished paper", attemptTotalsFrom([]).complete === false);
check(
  "no responses totals zero rather than failing",
  same(attemptTotalsFrom([]), {
    total: 0,
    max: 0,
    responses: 0,
    unscored: 0,
    complete: false,
  }),
  JSON.stringify(attemptTotalsFrom([]))
);

const noMax = attemptTotalsFrom([{ score: 5, max_score: null }]);
check(
  "a missing maximum is read as zero rather than NaN",
  noMax.max === 0 && Number.isFinite(noMax.total) && noMax.total === 5,
  JSON.stringify(noMax)
);
check("a marked response with no maximum still finishes", noMax.complete === true);

const zeroOfZero = attemptTotalsFrom([{ score: 0, max_score: 0 }]);
check(
  "a zero-mark response is marked, not unmarked",
  zeroOfZero.complete === true && zeroOfZero.unscored === 0,
  JSON.stringify(zeroOfZero)
);

// ---------------------------------------------------------------------------
// 2. The engine's order and its finalize step
// ---------------------------------------------------------------------------
check(
  "the engine reads totals through the domain module",
  engine.includes("const totals = attemptTotalsFrom(responses);")
);
check(
  "the attempt status follows the domain's completeness",
  engine.includes('status: totals.complete ? "GRADED" : "SUBMITTED",')
);
check(
  "the engine still names the AI switch",
  engine.includes("const { aiEnabled } = await getAiAutomationSettings();")
);
check(
  "the AI-off branch is the one that finalizes",
  engine.includes(
    "await finalizeAttemptTotals(attemptId, trail, false);\n    return { graded: 0, failed: 0 };"
  )
);

const trailAt = engine.indexOf("const trail = await gradingTrail(restClient, attemptId);");
const aiAt = engine.indexOf("const { aiEnabled } = await getAiAutomationSettings();");
const offFinalizeAt = engine.indexOf(
  "await finalizeAttemptTotals(attemptId, trail, false);\n    return { graded: 0, failed: 0 };"
);
check(
  "the trail is read before the AI switch is asked",
  trailAt >= 0 && aiAt >= 0 && trailAt < aiAt,
  `${trailAt} < ${aiAt}`
);
check(
  "the AI-off finalize sits inside the switch, after it",
  offFinalizeAt >= 0 && offFinalizeAt > aiAt,
  `${aiAt} < ${offFinalizeAt}`
);
check(
  "the engine finalizes on both paths",
  (engine.match(/await finalizeAttemptTotals\(attemptId, trail, (?:false|graded > 0)\);/g) ?? [])
    .length === 2,
  String(
    (engine.match(/await finalizeAttemptTotals\(attemptId, trail, (?:false|graded > 0)\);/g) ?? [])
      .length
  )
);
check(
  "the AI-on path still grades before it finalizes",
  engine.indexOf("const result = await gradePendingResponses(restClient, attemptId, trail, skipParked);") >= 0 &&
    engine.indexOf("const result = await gradePendingResponses(restClient, attemptId, trail, skipParked);") <
      engine.lastIndexOf("await finalizeAttemptTotals(attemptId, trail, graded > 0);")
);
check(
  "only a run that sent an answer to a model credits the AI",
  engine.includes("function closingActor(") &&
    engine.includes('actorLabel: "Grading engine"') &&
    engine.includes("await finalizeAttemptTotals(attemptId, trail, graded > 0);")
);
check(
  "the file says an AI-off deployment still finishes a self-marked paper",
  engine.includes("The finalize step runs even when AI is switched off")
);
check(
  "the crossing still records the trail row and routes the follow-up",
  engine.includes('action: "attempt_graded"') &&
    engine.includes("await routeFollowUp(attemptId);")
);

// ---------------------------------------------------------------------------
// 3. The desk that closes a paper every answer of which is marked
// ---------------------------------------------------------------------------
const integrityPanel = read("src/app/(admin)/candidates/IntegrityPanel.tsx");
const gradingTool = read("src/modules/assistant/domain/registry/grading.ts");
const gradingRead = read("src/modules/assistant/domain/registry/credentials.ts");

check(
  "the retry action no longer stops at 'nothing to do'",
  !consoleActions.includes("Nothing for the engine to do")
);

const zeroOpenAt = consoleActions.indexOf("if (openBefore === 0) {");
const aiSwitchAt = consoleActions.indexOf(
  "const { aiEnabled } = await getAiAutomationSettings();",
  zeroOpenAt
);
check(
  "with nothing left to score the action still reaches the engine",
  zeroOpenAt >= 0 &&
    aiSwitchAt > zeroOpenAt &&
    consoleActions
      .slice(zeroOpenAt, aiSwitchAt)
      .includes("await gradeAttemptResponses(attemptId, { passes: 1 });")
);
check(
  "only a submitted paper may be closed",
  zeroOpenAt >= 0 &&
    consoleActions.slice(zeroOpenAt, aiSwitchAt).includes('if (found.status !== "SUBMITTED")')
);
check(
  "the action reports whether the paper crossed",
  consoleActions.includes("finalized: true,") &&
    consoleActions.includes('if (after?.status !== "GRADED")')
);
check(
  "the report shows Finish grading on a fully marked submitted paper",
  integrityPanel.includes(': grades.status === "SUBMITTED"') &&
    integrityPanel.includes('"Finish grading"')
);
check(
  "the report says the paper crossed when it did",
  integrityPanel.includes("the test is now graded.")
);
check(
  "the assistant tool says it closes a fully marked paper",
  gradingTool.includes("closes a paper whose answers all carry a mark")
);
check(
  "the grading read tells the model the retry can close too",
  gradingRead.includes("or to close a paper every answer of which already carries a mark")
);

// ---------------------------------------------------------------------------
// 4. The scheduled sweep
// ---------------------------------------------------------------------------
const markedPaper = [{ id: "marked", candidate_responses: [{ score: 4 }] }];
const openPaper = [{ id: "open", candidate_responses: [{ score: null }] }];
const parkedPaper = [
  {
    id: "parked",
    candidate_responses: [{ score: null, ai_evaluation: { parked: true } }],
  },
];
const mixedPaper = [
  {
    id: "mixed",
    candidate_responses: [
      { score: null, ai_evaluation: { parked: true } },
      { score: null, ai_evaluation: { parked: false } },
    ],
  },
];
const answerless = [
  { id: "no-answers", candidate_responses: [] },
  { id: "no-rows", candidate_responses: null },
];
const twice = [
  { id: "twice", candidate_responses: [{ score: 1 }] },
  { id: "twice", candidate_responses: [{ score: 2 }] },
];

check(
  "a fully marked paper is swept with no AI, so its status can be closed",
  same(sweepCandidates(markedPaper, false), ["marked"])
);
check(
  "an open paper is swept while a model is ready",
  same(sweepCandidates(openPaper, true), ["open"])
);
check(
  "an open paper is left alone when no model is ready",
  same(sweepCandidates(openPaper, false), [])
);
check(
  "a parked answer is not retried by the sweep",
  same(sweepCandidates(parkedPaper, true), [])
);
check(
  "a paper with a retriable answer beside a parked one is still swept",
  same(sweepCandidates(mixedPaper, true), ["mixed"])
);
check(
  "a paper with no stored answers is never swept",
  same(sweepCandidates(answerless, true), [])
);
check(
  "an attempt embedded twice is swept once",
  same(sweepCandidates(twice, true), ["twice"])
);

check(
  "the sweep no longer stops outright when AI is off",
  !engine.includes("if (!aiEnabled || !hasAiProvider()) return { swept: 0, graded: 0, failed: 0 };") &&
    engine.includes("const aiReady = aiEnabled && hasAiProvider();")
);
check(
  "the sweep asks for every submitted paper, not only ones with a blank mark",
  engine.includes("select(\"id, candidate_responses!inner(score, ai_evaluation)\")") &&
    !engine.includes('.is("candidate_responses.score", null)')
);
check(
  "the sweep selects through the domain rule",
  engine.includes("sweepCandidates(") && engine.includes("SweepCandidate")
);
check(
  "the sweep leaves parked answers to a person",
  engine.includes("await gradeAttemptResponses(attemptId, { skipParked: true });") &&
    engine.includes("row.ai_evaluation?.parked === true")
);
check(
  "only a blocker no retry can clear is marked parked",
  engine.includes(
    "await writeManualNote(restClient, response.id, outcome.reason, trail, question.title, true);"
  ) &&
    engine.includes(
      "await writeManualNote(restClient, response.id, error.message, trail, question.title, true);"
    ) &&
    engine.includes(
      "await writeManualNote(restClient, response.id, error.message, trail, question.title, false);"
    )
);
check(
  "the sweep says how many papers it closed, not only how many marks it wrote",
  engine.includes("now graded") && engine.includes("graded, failed, closed")
);

// ---------------------------------------------------------------------------
// 5. Both doors reach the engine
// ---------------------------------------------------------------------------
check(
  "the submit route defers grading rather than blocking the candidate",
  submitRoute.includes("after(async () => {") &&
    submitRoute.includes("await gradeAttemptResponses(attempt.id);")
);
check(
  "the submit route names a failed background pass instead of swallowing it",
  submitRoute.includes("Background attempt grading failed:")
);
check(
  "the console's retry calls the same engine",
  consoleActions.includes("await gradeAttemptResponses(attemptId, { passes: 1 });")
);

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
const failed = results.filter((result) => !result.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed${
    failed.length ? ` — ${failed.length} FAILED` : ""
  }`
);
if (failed.length) {
  for (const result of failed)
    console.log(`FAIL ${result.name}${result.detail ? `  [${result.detail}]` : ""}`);
  process.exitCode = 1;
}
