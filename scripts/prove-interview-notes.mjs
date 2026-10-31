/* scripts/prove-interview-notes.mjs
 * Run: node --test scripts/prove-interview-notes.mjs
 *
 * A note is what an interviewer heard, in their own words, and it is the one
 * interview artefact this portal has never kept. These are the rules the desk, the
 * booking panel and the chat all share, proved against the pure domain module —
 * no database, no session, no provider.
 *
 *   1. what may be saved: text only, trimmed, bounded by the same 4000 characters
 *      the scorecard already holds, and a blank is a deliberate clear rather than
 *      a refusal;
 *   2. what a saved guide says about itself: the questions come from a model, so
 *      the block that lands in a person's notes carries the heading that says so.
 *      A note whose provenance nobody can read is the seed of a later argument
 *      about whose judgement it was;
 *   3. what a panel may be noted on at all: a cancelled panel and a no-show are
 *      refused in the same words at every door, because nothing happened to record;
 *   4. what an offer may do to a draft: inserting your notes into the scorecard's
 *      feedback box is an offer, so it never overwrites words already typed.
 *
 * Authorship is NOT proved here. The domain module has no author parameter to
 * forge — the session's profile id is bound in the action and repeated by the RLS
 * policy, and prove-interview-notes-actions.mjs covers that boundary.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERVIEW_NOTES_MIGRATION,
  NOTES_BODY_LIMIT,
  NOTES_CHAT_CLIP,
  NOTES_SCHEMA_NOTE,
  NOTES_WRITE_REFUSAL,
  appendInterviewGuide,
  canOpenNotesDesk,
  clipNoteBody,
  noteWriteRefusal,
  notesFor,
  prefillFeedbackFromNotes,
  readNoteBody,
} from "../src/modules/interviews/domain/interviewNotes.ts";

const GUIDE = [
  { question: "Why did you leave the last role?", rationale: "Tests tenure intent", skill_probed: "Team leadership" },
  { question: "Walk me through a budget you owned." },
];

// ---------------------------------------------------------------------------
// 1. What may be saved.
// ---------------------------------------------------------------------------
test("a note is stored trimmed", () => {
  const result = readNoteBody("  the candidate described a migration they led  \n");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.body, "the candidate described a migration they led");
});

test("a blank note clears the row instead of refusing", () => {
  for (const blank of ["", "   ", "\n\n", null, undefined]) {
    const result = readNoteBody(blank);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.body, null, `expected ${JSON.stringify(blank)} to clear`);
  }
});

test("a note at the limit is accepted, one character over is not", () => {
  assert.equal(readNoteBody("a".repeat(NOTES_BODY_LIMIT)).ok, true);
  const over = readNoteBody("a".repeat(NOTES_BODY_LIMIT + 1));
  assert.equal(over.ok, false);
  assert.match(over.error, new RegExp(String(NOTES_BODY_LIMIT)));
});

test("the cap is the same figure the scorecard's feedback already holds", () => {
  assert.equal(NOTES_BODY_LIMIT, 4000);
});

test("a note that is not text is refused rather than stringified", () => {
  for (const value of [42, { body: "text" }, ["a", "b"], true]) {
    const result = readNoteBody(value);
    assert.equal(result.ok, false);
    assert.match(result.error, /text/);
  }
});

// ---------------------------------------------------------------------------
// 2. What a saved guide says about itself.
// ---------------------------------------------------------------------------
test("saving a guide into empty notes produces the note body", () => {
  const result = appendInterviewGuide(null, GUIDE);
  assert.equal(result.ok, true, result.error);
  assert.match(result.body, /Why did you leave the last role\?/);
  assert.match(result.body, /Walk me through a budget you owned\./);
});

test("the saved guide is labelled as the model's draft, in the note itself", () => {
  const result = appendInterviewGuide(null, GUIDE);
  assert.equal(result.ok, true, result.error);
  assert.match(result.body, /model/i);
  assert.match(result.body, /draft/i);
});

test("a guide question keeps its rationale and the skill it probes", () => {
  const result = appendInterviewGuide(null, GUIDE);
  assert.equal(result.ok, true, result.error);
  assert.match(result.body, /Tests tenure intent/);
  assert.match(result.body, /Team leadership/);
});

test("a saved guide appends under the interviewer's own words, which stay first", () => {
  const result = appendInterviewGuide("I asked about the migration first.", GUIDE);
  assert.equal(result.ok, true, result.error);
  assert.ok(
    result.body.indexOf("I asked about the migration first.") <
      result.body.indexOf("Why did you leave the last role?"),
    result.body
  );
});

test("a guide that would not fit is refused with the room that is left", () => {
  const result = appendInterviewGuide("x".repeat(NOTES_BODY_LIMIT - 20), GUIDE);
  assert.equal(result.ok, false);
  assert.match(result.error, /20/);
});

test("an empty guide is refused instead of filing a heading with nothing in it", () => {
  for (const empty of [[], null, undefined]) {
    const result = appendInterviewGuide("existing note", empty);
    assert.equal(result.ok, false);
    assert.match(result.error, /no questions/i);
  }
});

// ---------------------------------------------------------------------------
// 3. What a panel may be noted on.
// ---------------------------------------------------------------------------
test("a cancelled panel has nothing to note", () => {
  assert.match(String(noteWriteRefusal("CANCELLED")), /cancelled/i);
});

test("a no-show panel has nothing to note", () => {
  assert.match(String(noteWriteRefusal("NO_SHOW")), /no-show/i);
});

test("a booked or completed panel accepts notes", () => {
  assert.equal(noteWriteRefusal("SCHEDULED"), null);
  assert.equal(noteWriteRefusal("COMPLETED"), null);
});

// ---------------------------------------------------------------------------
// 4. What an offer may do to a draft.
// ---------------------------------------------------------------------------
test("inserting notes fills a feedback box that is still empty", () => {
  const result = prefillFeedbackFromNotes("  ", "Technical 4: led the migration cleanly.");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.feedback, "Technical 4: led the migration cleanly.");
});

test("inserting notes refuses to overwrite words already typed", () => {
  const result = prefillFeedbackFromNotes("my own draft", "the note body");
  assert.equal(result.ok, false);
  assert.match(result.error, /already/i);
});

test("inserting notes with nothing to insert says so", () => {
  const result = prefillFeedbackFromNotes("", null);
  assert.equal(result.ok, false);
  assert.match(result.error, /no notes/i);
});

// ---------------------------------------------------------------------------
// 5. What a bounded read admits to.
// ---------------------------------------------------------------------------
test("a short note is handed to the chat whole and marked unclipped", () => {
  const result = clipNoteBody("answered pricing questions directly");
  assert.equal(result.clipped, false);
  assert.equal(result.text, "answered pricing questions directly");
});

test("a long note is clipped and the clip is admitted", () => {
  const result = clipNoteBody("n".repeat(NOTES_CHAT_CLIP + 500));
  assert.equal(result.clipped, true);
  assert.equal(result.text.length, NOTES_CHAT_CLIP);
});

// ---------------------------------------------------------------------------
// 6. Reading one panel's notes.
// ---------------------------------------------------------------------------
test("a panel's notes are its own, in the order they were saved", () => {
  const layer = {
    notes: [
      { interviewId: "i-1", authorProfileId: "a", body: "first", updatedAt: "2026-10-20" },
      { interviewId: "i-2", authorProfileId: "b", body: "other panel", updatedAt: "2026-10-21" },
      { interviewId: "i-1", authorProfileId: "c", body: "second", updatedAt: "2026-10-22" },
    ],
    available: true,
    note: null,
  };
  assert.deepEqual(
    notesFor(layer, "i-1").map((note) => note.body),
    ["first", "second"]
  );
});

test("a panel nobody noted has no notes, which is not a claim about the panel", () => {
  assert.deepEqual(notesFor({ notes: [], available: true, note: null }, "i-9"), []);
});

// ---------------------------------------------------------------------------
// 7. What the portal says on a database where 038 never ran.
// ---------------------------------------------------------------------------
test("both unapplied-schema sentences name the migration file", () => {
  assert.match(NOTES_SCHEMA_NOTE, new RegExp(INTERVIEW_NOTES_MIGRATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(NOTES_WRITE_REFUSAL, new RegExp(INTERVIEW_NOTES_MIGRATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("the migration file named is the one this slice authors", () => {
  assert.equal(INTERVIEW_NOTES_MIGRATION, "db/migrations/038_interview_notes.sql");
});

test("the write refusal tells the reader to save again, not that the feature is missing", () => {
  assert.match(NOTES_WRITE_REFUSAL, /again/i);
});

// ---------------------------------------------------------------------------
// 8. When the desk on the agenda row may be opened.
//
// This gate is deliberately stricter than the writer's. `saveInterviewNotes` refuses
// only a cancelled or no-show panel, because the same row has to hold the generated
// guide, which is written before the panel happens. The desk asks a different
// question — "what actually happened in that room?" — and a panel that has not been
// sat has nothing to answer it with, so a box there would invite an expectation
// filed as an account.
// ---------------------------------------------------------------------------
const readAt = "2026-06-01T12:00:00.000Z";

test("a panel that has been sat opens the desk", () => {
  assert.equal(canOpenNotesDesk("COMPLETED", "2026-05-30T09:00:00.000Z", readAt), true);
  assert.equal(canOpenNotesDesk("SCHEDULED", "2026-06-01T09:00:00.000Z", readAt), true);
});

test("a panel that has not happened yet keeps the desk shut", () => {
  assert.equal(canOpenNotesDesk("SCHEDULED", "2026-06-04T09:00:00.000Z", readAt), false);
});

test("the desk never opens on a panel where nothing was said", () => {
  for (const status of ["CANCELLED", "NO_SHOW"]) {
    assert.equal(canOpenNotesDesk(status, "2026-05-30T09:00:00.000Z", readAt), false);
  }
});
