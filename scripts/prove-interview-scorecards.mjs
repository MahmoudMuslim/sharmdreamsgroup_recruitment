/* scripts/prove-interview-scorecards.mjs
 * Run: node --experimental-strip-types scripts/prove-interview-scorecards.mjs
 *
 * #258 lets an interviewer record a scorecard — four marks from 1 to 5 and an
 * optional written note — and files each panel under one of four rounds. Most of
 * the feature needs a database, and `db/migrations/032_interview_scorecards.sql`
 * is authored and NOT applied, so no scorecard row can be written here. What can
 * be pinned without one:
 *
 *   1. the 1..5 rule and the written note — the same reader the action and the
 *      chat run, including the values it must refuse;
 *   2. the four rounds and the words a card prints for them;
 *   3. the averages — computed at read time, never stored;
 *   4. the authored DDL — column, table, constraints, RLS, cache reload;
 *   5. the wiring — the agenda's desk, the booking form's probe, the shared
 *      select that must NOT gain `round`, the assistant's two tools and the
 *      live watch that keeps the table out of the agenda's hashed area.
 *
 * (4) and (5) are text assertions, deliberately: the SQL is reviewed, never run
 * here, and the screens need a browser. They catch the file being edited apart,
 * not a runtime that was misconfigured. Whether 032 is applied to any given
 * database is a fact about that database, checked separately.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INTERVIEW_ROUNDS,
  INTERVIEW_ROUND_LABELS,
  ROUND_WRITE_REFUSAL,
  SCORECARD_CRITERIA,
  SCORECARD_FEEDBACK_LIMIT,
  SCORECARD_MIGRATION,
  SCORECARD_SCHEMA_NOTE,
  SCORECARD_WRITE_REFUSAL,
  averageLabel,
  isInterviewRound,
  isMissingSchemaError,
  panelAverage,
  readScorecardFeedback,
  readScorecardRatings,
  roundLabel,
  scorecardAverage,
  scorecardSummary,
  scorecardsFor,
} from "../src/modules/interviews/domain/interviewScorecard.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "ok   " : "FAIL "} ${name}${detail ? `  [${detail}]` : ""}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 1. The four rounds, in the words the screens and the chat share
// ---------------------------------------------------------------------------
check(
  "the rounds are the four the hiring spec names, in order",
  same(INTERVIEW_ROUNDS, ["SCREENING", "TECHNICAL", "HIRING_MANAGER", "CULTURE_FIT"]),
  INTERVIEW_ROUNDS.join(", ")
);
check(
  "each round has one label",
  same(INTERVIEW_ROUND_LABELS, {
    SCREENING: "Screening",
    TECHNICAL: "Technical",
    HIRING_MANAGER: "Hiring manager",
    CULTURE_FIT: "Culture fit",
  }),
  JSON.stringify(INTERVIEW_ROUND_LABELS)
);

for (const round of INTERVIEW_ROUNDS) {
  check(`isInterviewRound(${round}) is true`, isInterviewRound(round) === true);
  check(
    `roundLabel(${round}) is its label`,
    roundLabel(round) === INTERVIEW_ROUND_LABELS[round],
    roundLabel(round)
  );
}
for (const [value, label] of [
  ["screening", "lowercase echo"],
  [" Hiring Manager", "padded value"],
  ["HIRING MANAGER", "a space instead of the underscore"],
  ["", "blank"],
  [null, "null"],
  [undefined, "undefined"],
  [3, "a number"],
]) {
  check(`isInterviewRound refuses ${label}`, isInterviewRound(value) === false);
  check(`roundLabel refuses ${label}`, roundLabel(value) === null);
}

// ---------------------------------------------------------------------------
// 2. The four ratings — 1..5, whole numbers, every criterion present
// ---------------------------------------------------------------------------
check(
  "the criteria are the four the spec names, in order",
  same(
    SCORECARD_CRITERIA.map((criterion) => criterion.key),
    ["technical", "communication", "problemSolving", "culture"]
  ),
  SCORECARD_CRITERIA.map((criterion) => criterion.key).join(", ")
);
check(
  "the criteria carry the labels a card prints",
  same(
    SCORECARD_CRITERIA.map((criterion) => criterion.label),
    ["Technical", "Communication", "Problem solving", "Culture"]
  ),
  SCORECARD_CRITERIA.map((criterion) => criterion.label).join(", ")
);

const good = readScorecardRatings({
  technical: 4,
  communication: 3,
  problemSolving: 5,
  culture: 1,
});
check("four marks are accepted", good.ok === true, good.ok ? "" : good.error);
check(
  "the marks keep their values",
  good.ok &&
    good.ratings.technical === 4 &&
    good.ratings.communication === 3 &&
    good.ratings.problemSolving === 5 &&
    good.ratings.culture === 1
);

// An HTML form posts text, and the action judges the value, not the transport.
const fromForm = readScorecardRatings({
  technical: "5",
  communication: "1",
  problemSolving: "4",
  culture: "3",
});
check(
  "numeric strings are accepted and converted",
  fromForm.ok &&
    fromForm.ratings.technical === 5 &&
    fromForm.ratings.communication === 1 &&
    fromForm.ratings.problemSolving === 4 &&
    fromForm.ratings.culture === 3,
  fromForm.ok ? JSON.stringify(fromForm.ratings) : fromForm.error
);

for (const [mark, label] of [
  [0, "zero"],
  [6, "six"],
  [1.5, "one and a half"],
  [3.5, "three and a half"],
  ["x", "a letter"],
  ["  ", "whitespace only"],
  [null, "null"],
  [undefined, "a missing mark"],
]) {
  const refused = readScorecardRatings({
    technical: mark,
    communication: 3,
    problemSolving: 3,
    culture: 3,
  });
  check(`a technical mark of ${label} is refused`, refused.ok === false);
  check(
    `the ${label} refusal names the criterion and the scale`,
    refused.ok === false &&
      /^Technical must be a whole number from 1 to 5\.$/.test(refused.error),
    refused.ok ? "" : refused.error
  );
}

for (const field of ["communication", "problemSolving", "culture"]) {
  const refused = readScorecardRatings({
    technical: 3,
    communication: 3,
    problemSolving: 3,
    culture: 3,
    [field]: 9,
  });
  const label = SCORECARD_CRITERIA.find((criterion) => criterion.key === field).label;
  check(
    `a bad ${field} is named as ${label}`,
    refused.ok === false && refused.error.startsWith(`${label} must be`),
    refused.ok ? "" : refused.error
  );
}

for (const mark of [1, 5]) {
  const boundary = readScorecardRatings({
    technical: mark,
    communication: mark,
    problemSolving: mark,
    culture: mark,
  });
  check(`a mark of ${mark} is inside the scale`, boundary.ok === true, boundary.ok ? "" : boundary.error);
}
check("the feedback limit is 4,000 characters", SCORECARD_FEEDBACK_LIMIT === 4000, String(SCORECARD_FEEDBACK_LIMIT));

// ---------------------------------------------------------------------------
// 3. The written note — optional, trimmed, bounded
// ---------------------------------------------------------------------------
for (const [value, label] of [
  [undefined, "undefined"],
  [null, "null"],
  ["", "an empty string"],
  ["   ", "whitespace only"],
  ["\n\t", "newlines and tabs"],
]) {
  const blank = readScorecardFeedback(value);
  check(`${label} becomes no feedback`, blank.ok && blank.feedback === null, blank.ok ? "" : blank.error);
}
const padded = readScorecardFeedback("  Strong on the desk, weak on nights.  ");
check(
  "the note is trimmed but kept",
  padded.ok && padded.feedback === "Strong on the desk, weak on nights.",
  padded.ok ? padded.feedback : padded.error
);
const exact = readScorecardFeedback("x".repeat(SCORECARD_FEEDBACK_LIMIT));
check("a note at the limit is accepted", exact.ok === true, exact.ok ? "" : exact.error);
const over = readScorecardFeedback("x".repeat(SCORECARD_FEEDBACK_LIMIT + 1));
check("a note past the limit is refused", over.ok === false);
check(
  "the over-limit refusal names the limit",
  over.ok === false && /longer than/.test(over.error) && /characters/.test(over.error),
  over.ok ? "" : over.error
);
const notText = readScorecardFeedback(42);
check("a non-text note is refused", notText.ok === false, notText.ok ? "" : notText.error);

// ---------------------------------------------------------------------------
// 4. Averages are read-time, so disagreement survives
// ---------------------------------------------------------------------------
const flatFours = { technical: 4, communication: 4, problemSolving: 4, culture: 4 };
const spread = { technical: 5, communication: 2, problemSolving: 3, culture: 4 };
check("four marks of 4 average to 4", scorecardAverage(flatFours) === 4);
check("5, 2, 3, 4 averages to 3.5", scorecardAverage(spread) === 3.5, String(scorecardAverage(spread)));
check("no marks average to null", scorecardAverage(null) === null);
check("averageLabel(3.5) is one decimal", averageLabel(3.5) === "3.5", averageLabel(3.5));
check("averageLabel(4) is one decimal", averageLabel(4) === "4.0", averageLabel(4));
check("averageLabel(null) is an em dash", averageLabel(null) === "—", averageLabel(null));
check(
  "the summary names every criterion and the average",
  scorecardSummary(spread) ===
    "Technical 5 · Communication 2 · Problem solving 3 · Culture 4 · average 3.5",
  scorecardSummary(spread)
);

// ---------------------------------------------------------------------------
// 5. A layer: per-panel filtering, panel average, found ids
// ---------------------------------------------------------------------------
const card = (id, interviewId, technical, communication, problemSolving, culture) => ({
  id,
  interviewId,
  authorProfileId: `p-${id}`,
  authorName: `Interviewer ${id}`,
  technical,
  communication,
  problemSolving,
  culture,
  feedback: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
});
const layer = {
  rounds: { "i-1": "TECHNICAL" },
  scorecards: [card("s1", "i-1", 4, 4, 4, 4), card("s2", "i-1", 5, 5, 5, 5), card("s3", "i-2", 1, 1, 1, 1)],
  foundIds: ["i-1", "i-2"],
  roundsAvailable: true,
  scorecardsAvailable: true,
  note: null,
};
check("scorecardsFor keeps one panel's cards", scorecardsFor(layer, "i-1").length === 2);
check("scorecardsFor names the right panel", scorecardsFor(layer, "i-2").map((c) => c.id).join(",") === "s3");
check("scorecardsFor knows a panel with none", scorecardsFor(layer, "i-9").length === 0);
check("an unscored panel averages to null", panelAverage([]) === null);
check("two cards of 4 and 5 average to 4.5", panelAverage(scorecardsFor(layer, "i-1")) === 4.5, String(panelAverage(scorecardsFor(layer, "i-1"))));
check("one card averages to its own score", panelAverage(scorecardsFor(layer, "i-2")) === 1);
check("a panel with no round is absent from the map", !("i-2" in layer.rounds));
check("a real panel is in foundIds", layer.foundIds.includes("i-1"));
check("an id that does not exist is not in foundIds", !layer.foundIds.includes("i-9"));

// ---------------------------------------------------------------------------
// 6. The missing-schema verdict — a failed request is not "apply the migration"
// ---------------------------------------------------------------------------
for (const code of ["42P01", "PGRST205", "PGRST204", "42703"]) {
  check(`isMissingSchemaError(${code}) is true`, isMissingSchemaError({ code, message: "" }) === true);
}
check(
  "a 'does not exist' message is a missing-schema answer",
  isMissingSchemaError({ code: null, message: 'relation "interview_scorecards" does not exist' }) === true
);
check(
  "a 'schema cache' message is a missing-schema answer",
  isMissingSchemaError({ code: null, message: "Could not find the table in the schema cache" }) === true
);
for (const [error, label] of [
  [null, "null"],
  [undefined, "undefined"],
  [{ code: "", message: "fetch failed" }, "a transport failure"],
  [{ code: "42501", message: "permission denied" }, "a privilege refusal"],
  [{ code: "23505", message: "duplicate key" }, "a constraint violation"],
]) {
  check(`isMissingSchemaError refuses ${label}`, isMissingSchemaError(error) === false);
}

check(
  "the shared note names 032",
  SCORECARD_SCHEMA_NOTE.includes(SCORECARD_MIGRATION),
  SCORECARD_SCHEMA_NOTE
);
check(
  "the shared note says what is missing, not only which file",
  /no round/.test(SCORECARD_SCHEMA_NOTE) && /no scorecard can be saved/.test(SCORECARD_SCHEMA_NOTE),
  SCORECARD_SCHEMA_NOTE
);
check(
  "the write refusal names 032 and the retry",
  SCORECARD_WRITE_REFUSAL.includes(SCORECARD_MIGRATION) &&
    /save this scorecard again/.test(SCORECARD_WRITE_REFUSAL),
  SCORECARD_WRITE_REFUSAL
);
check(
  "the round refusal names 032 and the picker",
  ROUND_WRITE_REFUSAL.includes(SCORECARD_MIGRATION) &&
    /pick the round again/.test(ROUND_WRITE_REFUSAL),
  ROUND_WRITE_REFUSAL
);
check(
  "no shared sentence leaks a null",
  [SCORECARD_SCHEMA_NOTE, SCORECARD_WRITE_REFUSAL, ROUND_WRITE_REFUSAL].every(
    (sentence) => !/\bnull\b/.test(sentence)
  ),
  SCORECARD_SCHEMA_NOTE
);

// ---------------------------------------------------------------------------
// 7. The authored migration (not executed here)
// ---------------------------------------------------------------------------
const migration = read("db/migrations/032_interview_scorecards.sql");
for (const [label, needle] of [
  ["adds the round idempotently", "add column if not exists round text;"],
  ["keeps the round nullable", "round is null"],
  ["checks the round against the four ids", "array['SCREENING', 'TECHNICAL', 'HIRING_MANAGER', 'CULTURE_FIT']"],
  ["creates the table idempotently", "create table if not exists public.interview_scorecards ("],
  ["stores four technical marks", "technical smallint not null"],
  ["stores four communication marks", "communication smallint not null"],
  ["stores four problem-solving marks", "problem_solving smallint not null"],
  ["stores four culture marks", "culture smallint not null"],
  ["bounds every mark to 1..5", "constraint interview_scorecards_ratings_check"],
  ["checks technical inside the scale", "technical between 1 and 5"],
  ["checks culture inside the scale", "culture between 1 and 5"],
  ["bounds the note", "char_length(feedback) <= 4000"],
  ["keeps one scorecard per author per panel", "unique (interview_id, author_profile_id)"],
  ["takes scorecards with a deleted panel", "references interview_schedules (id) on delete cascade"],
  ["keeps the words when an author leaves", "references user_profiles (id) on delete set null"],
  ["stamps edits", "CREATE TRIGGER trg_interview_scorecards_updated"],
  ["indexes the panel lookup", "interview_scorecards_interview_idx"],
  ["enables row level security", "alter table if exists public.interview_scorecards enable row level security"],
  ["lets staff read", 'create policy "interview_scorecards_staff_read"'],
  ["gates inserts on authorship", 'create policy "interview_scorecards_own_add"'],
  ["gates updates on authorship", 'create policy "interview_scorecards_own_change"'],
  ["checks the session profile on write", "author_profile_id = current_user_profile_id()"],
  ["revokes anon", "revoke all on table public.interview_scorecards from anon"],
  ["reloads the REST schema", "notify pgrst, 'reload schema';"],
  ["says it is not applied", "This migration is NOT applied to any database yet."],
]) {
  check(`032 ${label}`, migration.includes(needle), needle);
}
check("032 does not seed rows", !/insert into public\.interview_scorecards/i.test(migration));
check(
  "032 defaults no round onto historical panels",
  !/add column if not exists round text[^;]*default/i.test(migration)
);

// ---------------------------------------------------------------------------
// 8. The reader probes both halves separately, and the shared select stays clean
// ---------------------------------------------------------------------------
function sourceHas(label, rel, needles) {
  const text = read(rel);
  const missing = needles.filter((needle) => !text.includes(needle));
  check(label, missing.length === 0, missing.length ? `missing ${missing.map((n) => JSON.stringify(n)).join(", ")}` : "");
}

sourceHas("the reader reads the round in its own query", "src/modules/interviews/infrastructure/scorecardReader.ts", [
  'select("id, round")',
  'select(SCORECARD_SELECT)',
  '.in("interview_id", ids)',
  "roundsQuery.limit(1)",
  "cardsQuery.limit(1)",
]);
sourceHas("the reader accepts no round as an absent entry", "src/modules/interviews/infrastructure/scorecardReader.ts", [
  "isInterviewRound(row.round)",
  "roundsAvailable: !roundRows.error",
  "scorecardsAvailable: !cardRows.error",
  "foundIds = roundRows.error ? []",
]);
sourceHas("the scorecard select names every column a card needs", "src/modules/interviews/infrastructure/scorecardReader.ts", [
  "interview_id",
  "author_profile_id",
  "technical",
  "communication",
  "problem_solving",
  "culture",
  "feedback",
  "created_at",
  "updated_at",
  "user_profiles ( full_name )",
]);

const interviewSelect = read("src/app/(admin)/candidates/interviews-model.ts").match(
  /export const INTERVIEW_SELECT =\s*"([^"]+)"/
);
check("the shared interview select is still found", Boolean(interviewSelect));
check(
  "the shared select does not gain round",
  interviewSelect !== null && !interviewSelect[1].includes("round"),
  interviewSelect ? interviewSelect[1] : ""
);

// ---------------------------------------------------------------------------
// 9. The write path — ownership from the session, refusals with reasons
// ---------------------------------------------------------------------------
sourceHas("the scorecard action reads ratings and feedback through the domain", "src/app/(admin)/interviews/scorecard-actions.ts", [
  "readScorecardRatings(input as unknown as Record<string, unknown>)",
  "readScorecardFeedback(input.feedback)",
]);
sourceHas("the scorecard action binds the author to the session", "src/app/(admin)/interviews/scorecard-actions.ts", [
  "author_profile_id: user.profileId",
  '.eq("author_profile_id", user.profileId)',
]);
sourceHas("the scorecard action refuses a panel with no conversation", "src/app/(admin)/interviews/scorecard-actions.ts", [
  '"This panel was cancelled, so there is nothing to score."',
  '"This panel was a no-show, so there is nothing to score."',
]);
sourceHas("a second save is an edit, and a race is named", "src/app/(admin)/interviews/scorecard-actions.ts", [
  ".update({",
  'error.code === "23505"',
  "You already have a scorecard for this panel.",
]);
sourceHas("the scorecard action names 032 when the table is missing", "src/app/(admin)/interviews/scorecard-actions.ts", [
  "SCORECARD_WRITE_REFUSAL",
  "isMissingSchemaError(readError)",
  "isMissingSchemaError(error)",
]);
sourceHas("the scorecard action writes the trail and refreshes both screens", "src/app/(admin)/interviews/scorecard-actions.ts", [
  'action: "interview_scorecard"',
  "scorecardSummary(ratings.ratings)",
  'revalidatePath("/interviews")',
  'revalidatePath("/candidates")',
]);
sourceHas("the round probe lives behind the staff door", "src/app/(admin)/interviews/scorecard-actions.ts", [
  'await requireStaff("/candidates")',
  'select("id, round")',
]);
sourceHas("the booking action judges and guards the round", "src/app/(admin)/candidates/interview-actions.ts", [
  "isInterviewRound(roundId)",
  "ROUND_WRITE_REFUSAL",
  "patch.round = nextRound",
]);

// ---------------------------------------------------------------------------
// 10. Wiring — the agenda desk, the booking form, the page
// ---------------------------------------------------------------------------
sourceHas("the agenda re-reads the layer after every move", "src/app/(admin)/interviews/InterviewAgenda.tsx", [
  "setLayer(await getInterviewScorecardLayer(fresh.map((row) => row.id)))",
]);
sourceHas("the agenda sends a round only when the column exists", "src/app/(admin)/interviews/InterviewAgenda.tsx", [
  "...(layer.roundsAvailable ? { round: round || null } : {})",
]);
sourceHas("the agenda shows the round on the card", "src/app/(admin)/interviews/InterviewAgenda.tsx", [
  "const panelRound = roundLabel(layer.rounds[row.id])",
  "${panelRound} round",
]);
sourceHas("the agenda prints the schema note and hides the round picker", "src/app/(admin)/interviews/InterviewAgenda.tsx", [
  "{layer.note && <p",
  "{layer.roundsAvailable && (",
  "agenda-round-${row.id}",
]);
sourceHas("the agenda offers the desk only after the slot", "src/app/(admin)/interviews/InterviewAgenda.tsx", [
  "{layer.scorecardsAvailable &&",
  'row.status === "COMPLETED"',
  'row.status === "SCHEDULED" && !inFuture',
  "<ScorecardDesk",
]);
sourceHas("the booking panel probes for the round lazily", "src/app/(admin)/candidates/InterviewPanel.tsx", [
  "await getInterviewRoundSupport()",
  "setRound(\"SCREENING\")",
  "roundSupport?.available ? { round: round || null }",
]);
sourceHas("the booking panel offers the round on create only", "src/app/(admin)/candidates/InterviewPanel.tsx", [
  "{!editingId && roundSupport?.available && (",
  "{!editingId && roundSupport && !roundSupport.available && roundSupport.note && (",
]);
sourceHas("the page reads the layer beside the agenda", "src/app/(admin)/interviews/page.tsx", [
  "getInterviewScorecardLayer(interviews.map((row) => row.id))",
  "viewerId={user.profileId}",
  "scorecardLayer={scorecardLayer}",
]);

// ---------------------------------------------------------------------------
// 11. The assistant — one read tool, one write tool, the write behind approval
// ---------------------------------------------------------------------------
sourceHas("the assistant registers both scorecard tools", "src/modules/assistant/domain/registry/interviews.ts", [
  'name: "read_interview_scorecards"',
  'name: "save_interview_scorecard"',
  "layer.foundIds.includes(interviewId)",
  "rounds_available: layer.roundsAvailable",
  "scorecards_available: layer.scorecardsAvailable",
  "panel_average: panelAverage(",
]);
sourceHas("the booking tools accept the four rounds", "src/modules/assistant/domain/registry/interviews.ts", [
  "optionalChoice(args, \"round\", INTERVIEW_ROUNDS)",
  "...(round !== null ? { round } : {})",
]);
sourceHas("list_interviews enriches rows with the layer", "src/modules/assistant/domain/registry/credentials.ts", [
  "const layer = await getInterviewScorecardLayer(listed.map((row) => row.id))",
  "roundLabel(layer.rounds[row.id])",
  "panel_average: panelAverage(cards)",
  "schema_note: layer.note",
]);
sourceHas("the read tool is on the fail-safe read list", "src/modules/assistant/domain/tools.ts", [
  '"read_interview_scorecards"',
]);
check(
  "the scorecard write waits for a human approval",
  !read("src/modules/assistant/domain/tools.ts").includes('"save_interview_scorecard"')
);
sourceHas("the assistant exports the new reads and write", "src/modules/assistant/application/sources.ts", [
  "getInterviewScorecardLayer",
  "saveInterviewScorecard",
  "INTERVIEW_ROUNDS",
]);
sourceHas("the registry shared barrel exports the new names", "src/modules/assistant/domain/registry/shared.ts", [
  "export { getInterviewScorecardLayer };",
  "export { saveInterviewScorecard };",
  "export { panelAverage };",
]);

// ---------------------------------------------------------------------------
// 12. The live watch and the Guide
// ---------------------------------------------------------------------------
sourceHas("scorecards are watched on their own table and stamp", "src/modules/live/domain/watch.ts", [
  'area: "interview scorecards"',
  'table: "interview_scorecards"',
  'stamp: "updated_at"',
  'paths: ["/interviews"]',
]);
check(
  "the agenda's hashed watch does not gain the round column",
  !read("src/modules/live/domain/watch.ts").includes(
    'columns: ["id", "application_id", "scheduled_at", "status", "meeting_link", "round"]'
  )
);
sourceHas("the Guide names 032 and the unseen candidate", "src/modules/shell/domain/pageGuide.ts", [
  "db/migrations/032_interview_scorecards.sql",
  "The candidate never does.",
  "A cancelled panel and a no-show have nothing to score.",
]);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("failed: " + failed.map((result) => result.name).join("; "));
  process.exit(1);
}
