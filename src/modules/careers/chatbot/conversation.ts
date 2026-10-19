/**
 * The conversation a candidate has had with the careers assistant.
 *
 * The widget keeps its own turns in React state and sends them back on every
 * request — the server holds nothing between turns, so closing the panel, or
 * reloading the page, is the end of the model's memory. That is a deliberate
 * limit: a public, unauthenticated transcript is not something to leave sitting
 * in a cache, and the only copy that outlives the tab is the one the visitor
 * chooses to hand over.
 */

export interface ChatTurn {
  role: "candidate" | "assistant";
  content: string;
}

/** How many turns one request may carry. Older ones are simply not sent. */
export const MAX_TURNS = 12;

/** A candidate question longer than this is a paste, not a question. */
export const MAX_TURN_CHARS = 800;

/**
 * How long one of the assistant's own answers may be.
 *
 * The widget sends its transcript back, so this is the number a returning
 * request is checked against for assistant turns. It lives here rather than in
 * the answer module because the two have to agree: a reply the model was allowed
 * to give, and a turn the next request refuses to read, would mean an
 * unanswerable conversation and a lead nobody can leave.
 */
export const MAX_REPLY_CHARS = 1200;

/** Turns the model actually sees, counted from the newest end. */
const MODEL_WINDOW = 8;

/**
 * The array a public request is allowed to be, or null.
 *
 * Everything about it is hostile-by-default: the shape comes from a browser, so
 * roles, lengths and count are all checked rather than assumed, and a single
 * malformed entry rejects the whole request instead of being quietly dropped —
 * a silently trimmed history would answer a different question than the one
 * that was asked.
 *
 * `requireQuestion` is the question-and-answer endpoint's extra rule: the last
 * turn must be the candidate's, because that is what is being asked. The lead
 * endpoint saves whatever exchange happened, and the normal one ends with the
 * assistant's answer.
 */
export function parseTurns(
  value: unknown,
  { requireQuestion = true }: { requireQuestion?: boolean } = {}
): ChatTurn[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TURNS) return null;

  const turns: ChatTurn[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "candidate" && role !== "assistant") return null;
    if (typeof content !== "string") return null;

    const text = content.trim();
    // Each role is measured against the ceiling that produced it. A candidate
    // paste is refused; the assistant's own long answer is not a forgery, and
    // rejecting it would strand the conversation it belongs to.
    if (!text || text.length > (role === "candidate" ? MAX_TURN_CHARS : MAX_REPLY_CHARS)) {
      return null;
    }
    turns.push({ role, content: text });
  }

  // An assistant turn at the end would mean the caller is replaying an answer
  // and asking for another.
  if (requireQuestion && turns[turns.length - 1].role !== "candidate") return null;

  return turns;
}

/** The window handed to the model: the newest turns, oldest first. */
export function modelWindow(turns: ChatTurn[]): ChatTurn[] {
  return turns.slice(-MODEL_WINDOW);
}

/**
 * The transcript a recruiter reads, as plain text.
 *
 * Notes on a prospect are a text column read in a drawer, so the transcript is
 * written the way a person would paste it into a file: who said what, newest
 * last, and cut from the front so the exchange that led to the details survives.
 */
export function renderTranscript(turns: ChatTurn[], maxChars = 3200): string {
  const lines = turns.map(
    (turn) => `${turn.role === "candidate" ? "Candidate" : "Assistant"}: ${turn.content}`
  );

  const header = "Careers assistant conversation, oldest first:";
  let body = lines.join("\n\n");

  if (body.length > maxChars) body = body.slice(body.length - maxChars);

  // Cutting mid-line leaves a fragment that reads as if the candidate said it.
  const firstBreak = body.indexOf("\n");
  if (firstBreak > 0) body = body.slice(firstBreak + 1);

  return `${header}\n\n${body}`;
}
