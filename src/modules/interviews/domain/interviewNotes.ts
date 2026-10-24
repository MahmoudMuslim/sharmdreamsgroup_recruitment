/**
 * What an interviewer wrote down about a panel, and the rules about keeping it.
 *
 * Pure by design — no database, no `server-only` — because three surfaces need the
 * same cap and the same refusal words: the agenda's notes desk, the candidate's
 * booking panel (which is where a generated guide is saved from) and the
 * assistant's tools. A limit copied three times is a note the screen accepts and
 * the writer rejects.
 *
 * A note is bounded by the scorecard's own feedback figure, `4000`: the two boxes
 * exist to hold the same first-hand account, and matching caps is what lets
 * "insert my notes" into the feedback box be an offer that always fits rather than
 * one that quietly truncates.
 *
 * A blank note clears the row. Refusing it would trap an interviewer who read back
 * what they typed and decided it was wrong to keep — the record they should leave
 * is an empty one, and the trail says who cleared it.
 */

/** The one cap the note body and the scorecard's feedback both hold to. */
export const NOTES_BODY_LIMIT = 4000;

/** How much of a note one chat read hands back, the scorecard clip's own figure. */
export const NOTES_CHAT_CLIP = 800;

export type NoteBodyRead =
  | { ok: true; body: string | null }
  | { ok: false; error: string };

/**
 * The note as it may be stored: trimmed, bounded, or cleared.
 *
 * Blank arrives as null rather than an empty string so the writer can tell "this
 * row holds nothing" apart from "nobody answered". Non-text is refused instead of
 * passed to `String()`, which would turn an object posted at the door into a note
 * about `[object Object]`.
 */
export function readNoteBody(value: unknown): NoteBodyRead {
  if (value === null || value === undefined) return { ok: true, body: null };
  if (typeof value !== "string") return { ok: false, error: "The note must be text." };

  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, body: null };
  if (trimmed.length > NOTES_BODY_LIMIT) {
    return { ok: false, error: `The note is longer than ${NOTES_BODY_LIMIT} characters.` };
  }
  return { ok: true, body: trimmed };
}

/**
 * The sentence a door says when this panel cannot be noted on, or null when it can.
 *
 * Kept here because the agenda, the booking panel and the chat all refuse the same
 * two statuses, and a cancelled panel described three different ways is a recruiter
 * left guessing which one actually stopped them.
 */
export function noteWriteRefusal(status: unknown): string | null {
  if (status === "CANCELLED") return "This panel was cancelled, so there is nothing to note.";
  if (status === "NO_SHOW") return "This panel was a no-show, so there is nothing to note.";
  return null;
}

/**
 * Whether the agenda may offer this panel's notes desk yet.
 *
 * Stricter than `noteWriteRefusal` on purpose. The writer must still accept a panel
 * that has not been sat, because the same row holds the generated guide and that is
 * written before the interview; the desk asks what happened in the room, and a panel
 * that has not happened has nothing to answer with. A box offered anyway becomes an
 * expectation filed as an account of a conversation.
 *
 * `readAt` is the agenda's own instant — the one the range rails cut with, so a row
 * cannot be "yesterday" in the header and "not yet held" in the desk.
 */
export function canOpenNotesDesk(
  status: unknown,
  scheduledAt: string | null | undefined,
  readAt: string
): boolean {
  if (noteWriteRefusal(status)) return false;
  if (status === "COMPLETED") return true;
  const when = Date.parse(String(scheduledAt ?? ""));
  return Number.isFinite(when) && when <= Date.parse(readAt);
}

export interface GuideQuestionInput {
  question?: string | null;
  rationale?: string | null;
  skill_probed?: string | null;
}

export type GuideAppendRead =
  | { ok: true; body: string }
  | { ok: false; error: string };

/**
 * The heading a saved guide carries, kept in the note rather than in a column.
 *
 * The questions below it came from a model reading the CV's gaps. A note whose
 * provenance nobody can recover turns into an argument later about whose judgement
 * it was, and the row has no other place to say it.
 */
const GUIDE_HEADING =
  "Interview guide drafted by the model from this CV's gaps — edit it into your own words; " +
  "nothing below is a judgement until you write one.";

function formatGuide(questions: readonly GuideQuestionInput[]): string {
  const lines = [GUIDE_HEADING];
  questions.forEach((item, index) => {
    lines.push(`${index + 1}. ${String(item?.question ?? "").trim()}`);
    const skill = String(item?.skill_probed ?? "").trim();
    if (skill) lines.push(`   Probes: ${skill}`);
    const rationale = String(item?.rationale ?? "").trim();
    if (rationale) lines.push(`   Why: ${rationale}`);
  });
  return lines.join("\n");
}

/**
 * The interviewer's own note, with the generated guide filed underneath it.
 *
 * Their words stay first: the guide is what they meant to ask, the note is what
 * actually happened. A block that would push the row past the cap is refused with
 * the room that is left, so the reader can cut something deliberately instead of
 * finding out from a truncated save.
 */
export function appendInterviewGuide(
  currentBody: string | null | undefined,
  questions: readonly GuideQuestionInput[] | null | undefined
): GuideAppendRead {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, error: "The model returned no questions, so there is no guide to save." };
  }

  const own = String(currentBody ?? "").trim();
  const block = formatGuide(questions);
  const body = own.length > 0 ? `${own}\n\n${block}` : block;

  if (body.length > NOTES_BODY_LIMIT) {
    const room = Math.max(0, NOTES_BODY_LIMIT - own.length);
    return {
      ok: false,
      error:
        `The guide does not fit: your notes have ${room} characters left and this block needs ` +
        `${block.length - (own.length > 0 ? 2 : 0)}. Save the questions you actually asked instead.`,
    };
  }
  return { ok: true, body };
}

export type FeedbackPrefill =
  | { ok: true; feedback: string }
  | { ok: false; error: string };

/**
 * The scorecard's feedback box, filled from the author's own note.
 *
 * An offer, never a default: a draft that already has words is refused, because
 * overwriting them would replace a judgement someone was in the middle of making
 * with an older one. The marks stay blank for the reason already recorded in
 * `interviewScorecard.ts` — a prefilled middle is a rating nobody chose.
 */
export function prefillFeedbackFromNotes(
  feedback: unknown,
  noteBody: string | null | undefined
): FeedbackPrefill {
  const draft = typeof feedback === "string" ? feedback.trim() : "";
  if (draft.length > 0) {
    return {
      ok: false,
      error: "Your feedback already has words. Clear them first to insert your notes.",
    };
  }

  const body = typeof noteBody === "string" ? noteBody.trim() : "";
  if (body.length === 0) {
    return { ok: false, error: "You have no notes on this panel to insert." };
  }
  return { ok: true, feedback: body };
}

export interface ClippedNote {
  text: string;
  /** True when the body was cut, so the caller can say so instead of hiding it. */
  clipped: boolean;
}

/** A note as far as one chat read carries it, admitting when it stopped. */
export function clipNoteBody(body: string, limit: number = NOTES_CHAT_CLIP): ClippedNote {
  if (body.length <= limit) return { text: body, clipped: false };
  return { text: body.slice(0, limit), clipped: true };
}

/** One interviewer's account of one panel. */
export interface InterviewNote {
  /** The panel, and the author — that pair is the row's key, so there is no id. */
  interviewId: string;
  authorProfileId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** The notes the page is about to draw, and whether this database can hold them. */
export interface InterviewNotesLayer {
  notes: InterviewNote[];
  /** False when the notes table could not be read — 038 unapplied, usually. */
  available: boolean;
  /** Why the table is unavailable, in the words the screen prints. */
  note: string | null;
}

/** One panel's notes, in the order they were saved. */
export function notesFor(layer: InterviewNotesLayer, interviewId: string): InterviewNote[] {
  return layer.notes.filter((note) => note.interviewId === interviewId);
}

/**
 * The one sentence every door says while 038 has not been applied.
 *
 * Naming the file is the actionable half: "notes are not supported" reads like a
 * decision the portal made, when the truth is that this database predates it.
 */
export const INTERVIEW_NOTES_MIGRATION = "db/migrations/038_interview_notes.sql";

export const NOTES_SCHEMA_NOTE =
  `Interview notes have not been created on this database yet. Apply ${INTERVIEW_NOTES_MIGRATION} — ` +
  "until it runs, a panel keeps no written account of what was said.";

export const NOTES_WRITE_REFUSAL =
  `Interview notes have not been created on this database yet. Apply ${INTERVIEW_NOTES_MIGRATION}, ` +
  "then save these notes again.";
