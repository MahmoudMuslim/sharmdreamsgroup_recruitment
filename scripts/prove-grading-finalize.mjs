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
 *   3. the doors — the submit route and the console's retry both reach the
 *      same function, so the fix is not stranded behind one entry point.
 *
 * (2) and (3) are text assertions, deliberately: the engine imports
 * `server-only` and writes through REST, so it cannot be imported by a plain
 * Node process. They catch the files being edited apart.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { attemptTotalsFrom } from "../src/modules/assessment/domain/attemptTotals.ts";

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
    "await finalizeAttemptTotals(attemptId, trail);\n    return { graded: 0, failed: 0 };"
  )
);

const trailAt = engine.indexOf("const trail = await gradingTrail(restClient, attemptId);");
const aiAt = engine.indexOf("const { aiEnabled } = await getAiAutomationSettings();");
const offFinalizeAt = engine.indexOf(
  "await finalizeAttemptTotals(attemptId, trail);\n    return { graded: 0, failed: 0 };"
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
  (engine.match(/await finalizeAttemptTotals\(attemptId, trail\);/g) ?? []).length === 2,
  String((engine.match(/await finalizeAttemptTotals\(attemptId, trail\);/g) ?? []).length)
);
check(
  "the AI-on path still grades before it finalizes",
  engine.indexOf("const result = await gradePendingResponses(restClient, attemptId, trail);") <
    engine.lastIndexOf("await finalizeAttemptTotals(attemptId, trail);")
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
// 3. Both doors reach the engine
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
